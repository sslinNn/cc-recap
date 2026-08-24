// Turns the normalized corpus into the numbers the report renders.

import { costOf, modelLabel, DEFAULT_PRICES } from "./pricing.mjs";
import {
  minePhrases, isIntention, russianShare, emojiCount, vocabulary, rageScore, rageMeter,
} from "./text.mjs";

const DAY = 86400000;
const pct = (part, whole) => (whole ? (100 * part) / whole : 0);
const dayKey = (ts) => new Date(ts).toLocaleDateString("sv-SE"); // local YYYY-MM-DD

/** Longest run of consecutive active days. */
function longestStreak(dayKeys) {
  const days = [...dayKeys].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of days) {
    const date = new Date(key + "T12:00:00").getTime();
    run = prev !== null && Math.round((date - prev) / DAY) === 1 ? run + 1 : 1;
    prev = date;
    best = Math.max(best, run);
  }
  return best;
}

/** First real program of a shell invocation; heredoc bodies and env prefixes excluded. */
export function shellProgram(command) {
  if (typeof command !== "string") return null;
  const head = command.split(/<<[-~]?/)[0];
  let segment = head.split(/\|\||&&|[|;\n]/)[0].trim();
  segment = segment.replace(/^[({\s]+/, "");
  const tokens = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && (/^\w+=/.test(tokens[i]) || tokens[i] === "sudo" || tokens[i] === "command")) i += 1;
  const program = tokens[i];
  if (!program || /^[-"'$]/.test(program)) return null;
  return program.split("/").pop();
}

const topN = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function bump(map, key, by = 1) {
  if (key == null) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

export function analyze(corpus, { prices = DEFAULT_PRICES } = {}) {
  const { turns, prompts, toolUses, toolResults, edits, assistantTexts, sessions } = corpus;

  // ---- Money and volume ---------------------------------------------------
  const money = { billed: 0, uncached: 0 };
  const volume = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 };
  const byModel = new Map();

  for (const turn of turns) {
    const { billed, uncached } = costOf(turn, prices);
    money.billed += billed;
    money.uncached += uncached;
    volume.input += turn.input;
    volume.output += turn.output;
    volume.cacheRead += turn.cacheRead;
    volume.cacheWrite += turn.cacheWrite;
    volume.thinking += turn.thinking;

    const label = modelLabel(turn.model);
    const entry = byModel.get(label) ?? { label, turns: 0, cost: 0 };
    entry.turns += 1;
    entry.cost += billed;
    byModel.set(label, entry);

    const session = sessions.get(turn.sessionId);
    if (session) session.cost += billed;
  }
  volume.total = volume.input + volume.output + volume.cacheRead + volume.cacheWrite;

  // ---- Rhythm -------------------------------------------------------------
  const events = [
    ...turns.map((t) => t.ts),
    ...prompts.map((p) => p.ts),
    ...toolResults.map((r) => r.ts),
  ];
  const hours = new Array(24).fill(0);
  const days = new Array(7).fill(0);
  const activeDays = new Set();
  for (const ts of events) {
    const date = new Date(ts);
    hours[date.getHours()] += 1;
    days[date.getDay()] += 1;
    activeDays.add(dayKey(ts));
  }
  const sessionList = [...sessions.values()].filter((s) => s.turns > 0 || s.prompts > 0);
  const longest = sessionList.reduce(
    (best, s) => ((s.end - s.start) > (best ? best.end - best.start : -1) ? s : best),
    null,
  );
  const activeHours = hours.map((n, h) => (n ? h : -1)).filter((h) => h >= 0);

  // ---- Work ---------------------------------------------------------------
  const work = { added: 0, removed: 0 };
  const fileTypes = new Map();
  for (const edit of edits) {
    work.added += edit.added;
    work.removed += edit.removed;
    const ext = (edit.path.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
    if (ext) bump(fileTypes, ext);
  }
  work.net = work.added - work.removed;
  work.ratio = work.net > 0 ? work.added / work.net : null;

  // ---- Tools --------------------------------------------------------------
  const tools = new Map();
  const shell = new Map();
  for (const use of toolUses) {
    bump(tools, use.name);
    if (use.name === "Bash") bump(shell, shellProgram(use.input?.command));
  }
  const toolErrors = toolResults.filter((r) => r.isError).length;

  // ---- Behaviour ----------------------------------------------------------
  const agentTexts = assistantTexts.map((a) => a.text);
  const userTexts = prompts.map((p) => p.text);
  const phrases = minePhrases(agentTexts);
  const victoryClaims = phrases.find(([name]) => name === "Declared victory")?.[1] ?? 0;
  const permissionAsks = phrases.find(([name]) => name === "Asked permission")?.[1] ?? 0;

  // An intention counts as acted on when a tool call follows inside the same session,
  // before the human speaks again.
  const bySession = new Map();
  for (const turn of turns) {
    if (!bySession.has(turn.sessionId)) bySession.set(turn.sessionId, []);
    bySession.get(turn.sessionId).push(turn);
  }
  for (const list of bySession.values()) list.sort((a, b) => a.ts - b.ts);
  const nextPrompt = new Map();
  for (const prompt of prompts) {
    const list = nextPrompt.get(prompt.sessionId) ?? [];
    list.push(prompt.ts);
    nextPrompt.set(prompt.sessionId, list);
  }
  let stated = 0;
  let acted = 0;
  for (const { ts, sessionId, text } of assistantTexts) {
    if (!isIntention(text)) continue;
    stated += 1;
    const list = bySession.get(sessionId) ?? [];
    const deadline = (nextPrompt.get(sessionId) ?? []).find((p) => p > ts) ?? Infinity;
    if (list.some((t) => t.ts >= ts && t.ts < deadline && t.toolCalls > 0)) acted += 1;
  }

  const askUserQuestions = toolUses.filter((u) => u.name === "AskUserQuestion").length;
  const trailingQuestions = agentTexts.filter((t) => /\?\s*$/.test(t.trim())).length;

  // ---- Vocabulary and rage -------------------------------------------------
  const vocab = vocabulary(userTexts, agentTexts);
  const scored = prompts
    .map((p) => ({ ...p, ...rageScore(p.text) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  const rageTotal = scored.reduce((sum, p) => sum + p.score, 0);
  const rage = {
    meter: rageMeter(rageTotal, prompts.length),
    total: rageTotal,
    profanity: scored.reduce((n, p) => n + p.hits.profanity, 0),
    insults: scored.reduce((n, p) => n + p.hits.insult, 0),
    annoyance: scored.reduce((n, p) => n + p.hits.annoyance, 0),
    atAgent: scored.filter((p) => p.atAgent).length,
    shouting: scored.filter((p) => p.caps).length,
    worst: scored[0] ?? null,
  };

  // ---- Ledger --------------------------------------------------------------
  const projects = new Map();
  for (const session of sessionList) {
    const entry = projects.get(session.project) ?? { name: session.project, sessions: 0, cost: 0 };
    entry.sessions += 1;
    entry.cost += session.cost;
    projects.set(session.project, entry);
  }
  const permissionModes = new Map();
  for (const prompt of prompts) bump(permissionModes, prompt.permissionMode ?? "default");
  const permissive = [...permissionModes.entries()]
    .filter(([mode]) => mode === "bypassPermissions" || mode === "acceptEdits" || mode === "auto")
    .reduce((n, [, count]) => n + count, 0);

  const typed = prompts.filter((p) => p.typed).length;
  const bashShare = pct(tools.get("Bash") ?? 0, toolUses.length);

  const report = {
    period: { from: corpus.from, to: corpus.to },
    scale: {
      sessions: sessionList.length,
      instructions: prompts.length,
      typed,
      scriptedShare: pct(prompts.length - typed, prompts.length),
      actions: turns.length,
      events: events.length,
    },
    money: {
      ...money,
      saved: money.uncached - money.billed,
      savedShare: pct(money.uncached - money.billed, money.uncached),
      billedShare: pct(money.billed, money.uncached),
      perInstruction: prompts.length ? money.billed / prompts.length : 0,
      perSurvivingLine: work.net > 0 ? money.billed / work.net : null,
    },
    models: [...byModel.values()].sort((a, b) => b.cost - a.cost),
    volume: {
      ...volume,
      cacheShare: pct(volume.cacheRead, volume.total),
      thinkingShare: pct(volume.thinking, volume.output),
      agentChars: agentTexts.reduce((n, t) => n + t.length, 0),
      userChars: userTexts.reduce((n, t) => n + t.length, 0),
      longestMessage: Math.max(0, ...userTexts.map((t) => t.length)),
      questions: askUserQuestions + trailingQuestions,
    },
    rhythm: {
      hours,
      days,
      activeDays: activeDays.size,
      periodDays: Math.max(1, Math.round((corpus.to - corpus.from) / DAY)),
      streak: longestStreak(activeDays),
      peakHour: hours.indexOf(Math.max(...hours)),
      firstHour: activeHours[0] ?? null,
      lastHour: activeHours[activeHours.length - 1] ?? null,
      nightEvents: hours.slice(0, 6).reduce((a, b) => a + b, 0),
      longest: longest
        ? { minutes: Math.round((longest.end - longest.start) / 60000), events: longest.events }
        : null,
    },
    work: { ...work, errors: toolErrors, victoryClaims },
    tools: topN(tools, 8),
    shell: topN(shell, 6),
    behaviour: {
      phrases,
      stated,
      acted,
      actedShare: pct(acted, stated),
      russianShare: 100 * russianShare(agentTexts),
      emoji: emojiCount(agentTexts),
      permissionAsks,
      bashShare,
    },
    vocabulary: vocab,
    rage,
    ledger: {
      projects: [...projects.values()].sort((a, b) => b.cost - a.cost),
      fileTypes: topN(fileTypes, 6),
      permissionModes: [...permissionModes.entries()].sort((a, b) => b[1] - a[1]),
      permissiveShare: pct(permissive, prompts.length),
    },
  };

  report.archetype = archetypeOf(report);
  return report;
}

/** A label and a verdict, both assembled from figures that are actually in the report. */
function archetypeOf(r) {
  const night = pct(r.rhythm.nightEvents, r.scale.events);
  const permissive = r.ledger.permissiveShare;
  const traits = [];

  let name = "The Operator";
  if (r.behaviour.bashShare > 40 && permissive > 30) name = "Ghost in the Shell";
  else if (night > 20) name = "The Night Shift";
  else if (r.rage.meter > 40) name = "The Interrogator";
  else if (r.work.ratio && r.work.ratio > 6) name = "The Rewriter";
  else if (r.behaviour.bashShare < 15) name = "The Librarian";

  if (r.behaviour.bashShare > 40) traits.push("Bash-first");
  if (permissive > 30) traits.push("permissions off");
  if (r.rhythm.lastHour !== null && r.rhythm.lastHour < 20 && !r.rhythm.nightEvents) {
    traits.push(`home by ${r.rhythm.lastHour + 1}`);
  }
  if (night > 20) traits.push("nocturnal");
  if (r.work.ratio && r.work.ratio > 6) traits.push(`${r.work.ratio.toFixed(1)} lines written per 1 kept`);

  const scripted = r.scale.scriptedShare;
  const tail =
    scripted > 20
      ? ` ${Math.round(scripted)}% of your instructions weren't even typed by you — a script wrote them.`
      : "";
  return { name, verdict: (traits.join(", ") || "Steady and unremarkable") + "." + tail };
}
