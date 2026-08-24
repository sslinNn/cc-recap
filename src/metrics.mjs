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

/** The archetype is the part people screenshot, so it is scored rather than
    chained: every candidate that applies proposes a weight, and the heaviest
    one wins. Each verdict quotes the figure that earned it — no claim on the
    card is unbacked by a number in the report below it. */
function archetypeOf(r) {
  const asPct = (n) => Math.round(n) + "%";
  const asNum = (n) => Math.round(n).toLocaleString("en-US");
  const asMoney = (n) => "$" + n.toFixed(2);
  const nightShare = pct(r.rhythm.nightEvents, r.scale.events);
  const permissive = r.ledger.permissiveShare;
  const perSession = r.scale.sessions ? r.scale.instructions / r.scale.sessions : 0;
  const perDay = r.rhythm.activeDays ? r.money.billed / r.rhythm.activeDays : 0;
  const ratio = r.work.ratio;

  const candidates = [
    {
      when: r.behaviour.bashShare > 40 && permissive > 30,
      weight: r.behaviour.bashShare + permissive,
      name: "Ghost in the Shell",
      verdict: `${asPct(r.behaviour.bashShare)} of your tool calls were raw shell, and ${asPct(permissive)} of them ran without asking. You are not using an assistant, you are using a terminal that talks back.`,
    },
    {
      when: r.scale.scriptedShare > 20,
      weight: 60 + r.scale.scriptedShare,
      name: "The Puppeteer",
      verdict: `${asPct(r.scale.scriptedShare)} of your instructions were never typed by a human — a script wrote them. You stopped prompting and started scheduling.`,
    },
    {
      when: nightShare > 20,
      weight: 40 + nightShare * 1.5,
      name: "The Night Shift",
      verdict: `${asNum(r.rhythm.nightEvents)} events between midnight and six. Whatever you are building, it is being built while the rest of your timezone sleeps.`,
    },
    {
      when: r.rage.meter > 40,
      weight: 35 + r.rage.meter,
      name: "The Interrogator",
      verdict: `${asNum(r.rage.profanity + r.rage.insults)} messages crossed from instruction into interrogation. The work got done. Nobody enjoyed it.`,
    },
    {
      when: ratio !== null && ratio > 6,
      weight: 30 + ratio * 3,
      name: "The Rewriter",
      verdict: `${asNum(r.work.added)} lines written, ${asNum(r.work.net)} survived — ${ratio.toFixed(1)} drafts for every line that stayed. You do not write code, you converge on it.`,
    },
    {
      when: permissive > 60,
      weight: 25 + permissive,
      name: "The Rubber Stamp",
      verdict: `${asPct(permissive)} of your work went through with the confirmation step turned off. You have read exactly none of the diffs and you know it.`,
    },
    {
      when: perSession > 25,
      weight: 20 + perSession,
      name: "The Backseat Driver",
      verdict: `${perSession.toFixed(0)} instructions per session on average. You did not delegate a task, you narrated one keystroke at a time.`,
    },
    {
      when: perDay > 50,
      weight: 20 + perDay / 4,
      name: "The Whale",
      verdict: `${asMoney(perDay)} of tokens a day, ${asMoney(r.money.billed)} across ${asNum(r.rhythm.activeDays)} active days. The cache saved you ${asMoney(r.money.saved)} and you still spent this.`,
    },
    {
      when: r.rhythm.streak >= 5,
      weight: 15 + r.rhythm.streak * 2,
      name: "The Streak",
      verdict: `${asNum(r.rhythm.streak)} days in a row without missing one. This is not a tool you reach for, it is a habit you maintain.`,
    },
    {
      when: r.behaviour.bashShare < 15 && r.scale.instructions > 0,
      weight: 12,
      name: "The Librarian",
      verdict: `Barely any shell — ${asPct(r.behaviour.bashShare)} of tool calls. You read, you ask, you edit in place, and you never let it loose on the machine.`,
    },
    {
      when: true,
      weight: 0,
      name: "The Operator",
      verdict: `${asNum(r.scale.instructions)} instructions, ${asNum(r.scale.actions)} actions, ${asNum(r.rhythm.activeDays)} days. No extremes in either direction — you just used the thing.`,
    },
  ];

  const winner = candidates
    .filter((c) => c.when)
    .sort((a, b) => b.weight - a.weight)[0];

  return { name: winner.name, verdict: winner.verdict };
}
