// Renders the report as one self-contained HTML page. Design carried over from the
// original AI Wrapped artifact; every figure comes from src/metrics.mjs.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { maskProfanity } from "./text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "style.css"), "utf8");

const esc = (value) =>
  String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const num = (n) => Math.round(n).toLocaleString("en-US");
const money = (n) => "$" + n.toFixed(2);
const pct = (n, digits = 0) => n.toFixed(digits) + "%";

/** 148,812,004 -> 148.8M — the axis reads better than the exact figure. */
function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

const dateLabel = (ts) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const hourLabel = (h) => String(h).padStart(2, "0") + ":00";

/**
 * One shared scale, thin marks, the value printed at the end of every bar. A row
 * may carry its own signal class as a fourth element when the rows mean
 * different things — cached traffic is not the same kind of thing as output.
 */
function bars(rows, cls, format = num) {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return rows
    .map(([name, value, tip, rowCls], i) => {
      const signal = rowCls ?? cls;
      return `
        <div class="bar-row" data-tip="${esc(tip ?? `${name} — ${num(value)}`)}">
          <span class="bar-key">${esc(name)}</span>
          <span class="bar-track"><span class="bar-fill${signal ? " " + signal : ""}" style="--fill:${((100 * value) / max).toFixed(2)}%;--delay:${(i * 0.05).toFixed(2)}s"></span></span>
          <span class="bar-val num">${esc(format(value))}</span>
        </div>`;
    })
    .join("");
}

function pairRow(label, total, left, right, leftTip, rightTip, colors = ["burn", "churn"]) {
  const sum = left + right || 1;
  const l = (100 * left) / sum;
  return `
        <div class="pair-row">
          <div class="pair-head"><span>${esc(label)}</span><span class="num">${esc(total)}</span></div>
          <div class="pair-track">
            <span class="pair-seg seg-${colors[0]}" style="--seg:${l.toFixed(2)}%" data-tip="${esc(leftTip)}"></span>
            <span class="pair-seg seg-${colors[1]}" style="--seg:${(100 - l).toFixed(2)}%" data-tip="${esc(rightTip)}"></span>
          </div>
          <div class="pair-foot">
            <span><i class="swatch" style="background:var(--${colors[0]})"></i>${Math.round(l)}%</span>
            <span>${Math.round(100 - l)}%<i class="swatch" style="background:var(--${colors[1]})"></i></span>
          </div>
        </div>`;
}

const kv = (rows) =>
  `<div class="kv">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><span class="num">${esc(v)}</span></div>`).join("")}</div>`;

const stat = (label, value, note, cls = "") =>
  `<div class="stat${cls ? " " + cls : ""}">
        <span class="k">${esc(label)}</span>
        <span class="v num">${esc(value)}</span>
        ${note ? `<span class="n">${esc(note)}</span>` : ""}
      </div>`;

// ---- Generated prose ------------------------------------------------------
// The original page had hand-written subtitles; these say the same kind of thing
// from whatever the numbers turned out to be.

function rhythmLine(r) {
  const { firstHour, lastHour, nightEvents } = r.rhythm;
  if (firstHour === null) return "No activity in this window.";
  if (!nightEvents) return `Nothing before ${hourLabel(firstHour)}, nothing after ${hourLabel(lastHour + 1)}. A strictly daylight operation.`;
  return `Active from ${hourLabel(firstHour)} to ${hourLabel(lastHour + 1)}, including ${num(nightEvents)} events between midnight and six.`;
}

function modelLine(r) {
  if (r.models.length < 2) return `Everything ran on ${r.models[0]?.label ?? "one model"}.`;
  const [top] = r.models;
  const turnShare = (100 * top.turns) / r.scale.actions;
  const costShare = (100 * top.cost) / (r.money.billed || 1);
  return `${top.label} took ${pct(turnShare)} of the turns and ${pct(costShare)} of the budget.`;
}

function toolLine(r) {
  const [first, second] = r.tools;
  if (!first) return "No tool calls in this window.";
  if (!second) return `${first[0]} did all of it.`;
  return `${first[0]} ${(first[1] / second[1]).toFixed(1)}× more than ${second[0]}.`;
}

// ---- Page -----------------------------------------------------------------
export function render(r, { title = "cc-recap — your week with Claude Code" } = {}) {
  const from = dateLabel(r.period.from);
  const to = new Date(r.period.to).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const range = `${from}–${to}`;
  const ratio = r.work.ratio ? r.work.ratio.toFixed(1) : "—";
  const worst = r.rage.worst;
  const quote = worst ? worst.text.replace(/\s+/g, " ").slice(0, 150) + (worst.text.length > 150 ? "…" : "") : null;
  const conversation = r.scale.instructions + r.scale.actions;
  const youShare = conversation ? (100 * r.scale.instructions) / conversation : 50;
  const clock = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const quoteWho = worst ? `Your angriest message · ${dateLabel(worst.ts)}, ${clock(worst.ts)}` : "";
  const quoteHtml = quote
    ? `<div class="quote-strip">“${esc(quote)}”<span class="who">${esc(quoteWho)}</span></div>`
    : "";
  // The asterisks are wrapped so they can be set apart from the words around
  // them; a serif italic hangs them high enough to read as footnote markers.
  const maskedQuote = quote
    ? esc(maskProfanity(quote)).replace(/\*+/g, (run) => `<span class="masked">${run}</span>`)
    : "";

  // Safe mode strikes out the middle of the swearing and leaves the sentence
  // intact, so the card stays postable under a real name and still reads as
  // something a person actually said.
  const safeQuoteHtml = quote
    ? `<div class="quote-strip is-safe">“${maskedQuote}”<span class="who">Masked for the timeline · ${esc(quoteWho)}</span></div>`
    : "";

  const body = `
<div class="wrap">

  <div class="masthead">
    <h1>cc-recap</h1>
    <span class="meta num">${esc(new Date(r.period.from).toLocaleDateString("sv-SE"))} → ${esc(new Date(r.period.to).toLocaleDateString("sv-SE"))}</span>
  </div>
  <p class="deck">
    You said <span class="said">${num(r.scale.instructions)}</span> things.
    It did <span class="did num">${num(r.scale.actions)}</span>.
  </p>
  <div class="strapline">
    <span class="label">${num(r.scale.sessions)} sessions · ${num(r.rhythm.activeDays)} active days</span>
    <span class="label">Computed locally · nothing uploaded</span>
  </div>

  <!-- ====================== SHARE CARD ====================== -->
  <div class="card-frame">
    <div class="sec-head">
      <h2>The card</h2>
      <div class="card-actions">
        <button type="button" class="act act-primary" id="dlPng">Download PNG</button>
        <button type="button" class="act" id="shareX">Share on X</button>
        <button type="button" class="act" id="copyPng">Copy image</button>
        <button type="button" class="act act-toggle" id="safeToggle" aria-pressed="false">Safe mode: off</button>
      </div>
    </div>

    <div class="card" id="shareCard">
      <div class="card-id">
        <span class="name">cc-recap</span>
        <span class="when">${esc(range)} · Claude Code</span>
      </div>

      <div class="thesis">
        <div class="row">
          <div class="side side-you">
            <span class="lbl">You said</span>
            <b class="qty">${num(r.scale.instructions)}</b>
          </div>
          <div class="side side-it">
            <span class="lbl">It did</span>
            <b class="qty num">${num(r.scale.actions)}</b>
          </div>
        </div>
        <div class="split" style="--you-share:${youShare.toFixed(1)}%">
          <span class="you"></span><span class="it"></span>
        </div>
        <div class="shares">
          <span>${pct(youShare)} of the conversation</span>
          <span>${pct(100 - youShare)}</span>
        </div>
      </div>

      <div class="card-body">
        <div class="portrait">
          <span class="lbl">Your archetype</span>
          <div class="arch">${esc(r.archetype.name)}</div>
          <p class="verdict">${esc(r.archetype.verdict)}</p>
          <div id="quoteSlot">${quoteHtml}</div>
        </div>

        <div class="figures">
          <div class="fig"><b class="v v-machine num">$${Math.round(r.money.billed)}</b><span class="k">Burned in ${num(r.rhythm.activeDays)} days</span></div>
          <div class="fig"><b class="v v-machine num">${esc(compact(r.volume.total))}</b><span class="k">Tokens moved</span></div>
          <div class="fig"><b class="v v-paper num">${r.rhythm.firstHour ?? 0}–${(r.rhythm.lastHour ?? 0) + 1}h</b><span class="k">Only hours you exist</span></div>
          <div class="fig"><b class="v v-paper num">${pct(r.ledger.permissiveShare)}</b><span class="k">With permissions off</span></div>
        </div>
      </div>

      <div class="card-foot">
        <div class="foot-rhythm">
          <span class="lbl">Every hour of your week · ${num(r.scale.sessions)} sessions in ${num(r.rhythm.activeDays)} days</span>
          <div class="card-spark" id="cardSpark"></div>
          <div class="spark-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
        </div>
        <div class="foot-install">
          <span class="lbl">Run yours</span>
          <b>npx cc-recap</b>
        </div>
      </div>
    </div>

    <div class="card-note">
      <span id="actNote">Every figure below is computed from your own transcripts on this machine.</span>
      <span>${pct(r.volume.cacheShare, 1)} of all token traffic was re-reading cached context.</span>
    </div>
  </div>

  <!-- ====================== MONEY ====================== -->
  <section class="inst" data-signal="burn">
    <div class="rail"><span class="unit">USD</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Money</h2>
      <p class="hint">List prices · cache read 0.1× · cache write 2× at 1h TTL</p>
    </div>

    <p class="finding">Caching absorbed <strong class="num">${money(r.money.saved)}</strong> — ${pct(r.money.savedShare, 1)} of what this week would otherwise have cost.</p>

    <div class="readouts">
      ${stat("Actually spent", money(r.money.billed), `across ${num(r.scale.sessions)} sessions`, "burn")}
      ${stat("Without caching", money(r.money.uncached), "same tokens, no cache", "ghost")}
      ${stat("Cost per instruction", money(r.money.perInstruction), `${num(r.scale.instructions)} instructions given`, "burn")}
      ${stat("Cost per surviving line", r.money.perSurvivingLine === null ? "—" : money(r.money.perSurvivingLine), `${num(r.work.net)} net lines of code`)}
    </div>

    <div class="panel">
      <h3>What the cache is worth</h3>
      <p class="sub">Same traffic priced two ways. The gap is the discount for re-reading context you had already sent.</p>
      <div class="bars">
        <div class="bar-row" data-tip="Billed at cache-read and cache-write rates">
          <span class="bar-key">Billed</span>
          <span class="bar-track"><span class="bar-fill burn" style="--fill:${r.money.billedShare}%"></span></span>
          <span class="bar-val num">${money(r.money.billed)}</span>
        </div>
        <div class="bar-row" data-tip="Every cached token billed as fresh input">
          <span class="bar-key">If uncached</span>
          <span class="bar-track"><span class="bar-fill ghost" style="--fill:100%;--delay:0.05s"></span></span>
          <span class="bar-val num">${money(r.money.uncached)}</span>
        </div>
      </div>
    </div>
  </section>

  <!-- ====================== MODELS ====================== -->
  <section class="inst" data-signal="churn">
    <div class="rail"><span class="unit">Share</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Models</h2>
      <p class="hint">Two shares of the same 100% scale</p>
    </div>

    <p class="finding">${esc(modelLine(r))}</p>
    <div class="panel">
      <h3>Share of turns and spend</h3>
      <p class="sub">Turns and spend rarely line up — the expensive model is not the busy one.</p>
      <div class="legend">
        ${r.models.slice(0, 2).map((m, i) => `<span><i class="swatch" style="background:var(--${i ? "churn" : "burn"})"></i> ${esc(m.label)}</span>`).join("")}
      </div>
      <div class="pair">
        ${pairRow(
          "Share of turns",
          `${num(r.scale.actions)} total`,
          r.models[0]?.turns ?? 0,
          r.models.slice(1).reduce((n, m) => n + m.turns, 0),
          `${r.models[0]?.label ?? ""} — ${num(r.models[0]?.turns ?? 0)} turns`,
          `${r.models[1]?.label ?? "rest"} — ${num(r.models.slice(1).reduce((n, m) => n + m.turns, 0))} turns`,
        )}
        ${pairRow(
          "Share of spend",
          `${money(r.money.billed)} total`,
          r.models[0]?.cost ?? 0,
          r.models.slice(1).reduce((n, m) => n + m.cost, 0),
          `${r.models[0]?.label ?? ""} — ${money(r.models[0]?.cost ?? 0)}`,
          `${r.models[1]?.label ?? "rest"} — ${money(r.models.slice(1).reduce((n, m) => n + m.cost, 0))}`,
        )}
      </div>
    </div>
  </section>

  <!-- ====================== VOLUME ====================== -->
  <section class="inst" data-signal="ghost">
    <div class="rail"><span class="unit">Tokens</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Volume</h2>
      <p class="hint">${compact(r.volume.total)} tokens moved in total</p>
    </div>

    <p class="finding">${pct(r.volume.cacheShare, 1)} of every token you moved was context being re-read, not new text. Another ${pct(r.volume.thinkingShare, 1)} of its output was thinking you never saw.</p>
    <div class="split-2">
      <div class="panel">
        <h3>Where the tokens went</h3>
        <p class="sub">Almost everything was context being re-read, not new text being produced.</p>
        <div class="bars">
          ${bars(
            [
              ["Cache read", r.volume.cacheRead, "Cached context replayed at 0.1× input price", "ghost"],
              ["Cache write", r.volume.cacheWrite, "Context written into the cache at 2× (1h TTL)", "ghost"],
              ["Output", r.volume.output, "Tokens the model generated", "churn"],
              ["Fresh input", r.volume.input, "Text never seen before", "burn"],
            ].map(([k, v, tip, sig]) => [k, v, `${tip} — ${num(v)}`, sig]),
            "",
            compact,
          )}
        </div>
      </div>
      <div class="panel">
        <h3>Thinking you never saw</h3>
        <p class="sub">Reasoning tokens are billed as output but returned empty. This is the share of its production that stayed private.</p>
        <div class="pair" style="margin-bottom:16px">
          ${pairRow(
            "Output tokens",
            num(r.volume.output),
            r.volume.thinking,
            Math.max(0, r.volume.output - r.volume.thinking),
            `${num(r.volume.thinking)} hidden reasoning tokens`,
            `${num(r.volume.output - r.volume.thinking)} tokens you could read`,
            ["ghost", "churn"],
          )}
        </div>
        ${kv([
          ["Text it wrote to you", `${num(r.volume.agentChars)} chars`],
          ["Text you wrote to it", `${num(r.volume.userChars)} chars`],
          ["Longest single message", `${num(r.volume.longestMessage)} chars`],
          ["Questions it asked you", num(r.volume.questions)],
        ])}
      </div>
    </div>
  </section>

  <!-- ====================== RHYTHM ====================== -->
  <section class="inst" data-signal="churn">
    <div class="rail"><span class="unit">Hours</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Rhythm</h2>
      <p class="hint">Local time · all activity</p>
    </div>

    <p class="finding">${esc(rhythmLine(r))}</p>
    <div class="panel">
      <h3>Hour of day</h3>
      <p class="sub">${esc(rhythmLine(r))}</p>
      <div class="trace" id="hourChart"></div>
      <div class="ruler" id="hourAxis"></div>
    </div>
    <div class="split-2">
      <div class="panel">
        <h3>Day of week</h3>
        <p class="sub">${num(r.rhythm.activeDays)} of ${num(r.rhythm.periodDays)} days carried everything; the longest streak reached ${num(r.rhythm.streak)}.</p>
        <div class="trace short" id="dayChart"></div>
        <div class="ruler" id="dayAxis"></div>
      </div>
      <div class="panel">
        <h3>Session shape</h3>
        <p class="sub">How the work was actually distributed across the window.</p>
        ${kv([
          ["Sessions", num(r.scale.sessions)],
          ["Active days", `${num(r.rhythm.activeDays)} of ${num(r.rhythm.periodDays)}`],
          ["Longest streak", `${num(r.rhythm.streak)} day${r.rhythm.streak === 1 ? "" : "s"}`],
          ["Longest session", r.rhythm.longest ? `${num(r.rhythm.longest.minutes)} min · ${num(r.rhythm.longest.events)} events` : "—"],
          ["Peak hour", hourLabel(r.rhythm.peakHour)],
          ["Work between 00–06", r.rhythm.nightEvents ? `${num(r.rhythm.nightEvents)} events` : "none"],
        ])}
      </div>
    </div>
  </section>

  <!-- ====================== WORK ====================== -->
  <section class="inst" data-signal="churn">
    <div class="rail"><span class="unit">Lines</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Work</h2>
      <p class="hint">From real diffs, not tool-call counts</p>
    </div>

    <p class="finding"><strong class="num">${num(r.work.added)}</strong> lines written, <strong class="num">${num(r.work.net)}</strong> survived — ${ratio} drafts for every line that stayed.</p>
    <div class="readouts">
      ${stat("Lines added", num(r.work.added))}
      ${stat("Lines removed", num(r.work.removed), "", "alarm")}
      ${stat("Net survivors", num(r.work.net), `${ratio} written per 1 kept`, "churn")}
      ${stat("Tool errors", num(r.work.errors), `against ${num(r.work.victoryClaims)} victory claims`, "alarm")}
    </div>
    <div class="split-2">
      <div class="panel">
        <h3>Tools</h3>
        <p class="sub">${esc(toolLine(r))}</p>
        <div class="bars">${bars(r.tools)}</div>
      </div>
      <div class="panel">
        <h3>Shell commands</h3>
        <p class="sub">Top program per invocation, heredoc bodies excluded.</p>
        <div class="bars">${bars(r.shell, "churn")}</div>
      </div>
    </div>
  </section>

  <!-- ====================== BEHAVIOUR ====================== -->
  <section class="inst" data-signal="ghost">
    <div class="rail"><span class="unit">Phrases</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Behaviour</h2>
      <p class="hint">Phrase mining across ${compact(r.volume.agentChars)} characters, EN + RU</p>
    </div>

    <p class="finding">It announced the next move ${num(r.behaviour.stated)} times and a tool call followed in ${pct(r.behaviour.actedShare)} of them.</p>
    <div class="split-2">
      <div class="panel">
        <h3>What it said</h3>
        <p class="sub">Each category counts the messages it appeared in, not every occurrence.</p>
        <div class="bars">${bars(r.behaviour.phrases, "ghost")}</div>
      </div>
      <div class="panel">
        <h3>Announcements vs actions</h3>
        <p class="sub">It said it was about to do something ${num(r.behaviour.stated)} times. A tool call followed in ${num(r.behaviour.acted)} of them.</p>
        <div class="pair" style="margin-bottom:16px">
          ${pairRow(
            "Stated intentions",
            num(r.behaviour.stated),
            r.behaviour.acted,
            Math.max(0, r.behaviour.stated - r.behaviour.acted),
            `${num(r.behaviour.acted)} followed by a tool call`,
            `${num(r.behaviour.stated - r.behaviour.acted)} with no tool call before the turn ended`,
            ["churn", "ghost"],
          )}
        </div>
        ${kv([
          ["Replies in Russian", `${pct(r.behaviour.russianShare, 1)} of its output`],
          ["Emoji used", num(r.behaviour.emoji)],
          ["Permission asks", num(r.behaviour.permissionAsks)],
        ])}
      </div>
    </div>
  </section>

  <!-- ====================== VOCABULARY ====================== -->
  <section class="inst" data-signal="you">
    <div class="rail"><span class="unit">Words</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Vocabulary</h2>
      <p class="hint">Distinctive words, not frequent ones</p>
    </div>

    <p class="finding">${num(r.vocabulary.userUnique)} words you reach for that it never does. ${num(r.vocabulary.agentUnique)} it reaches for that you never do.</p>
    <div class="split-2">
      <div class="panel">
        <h3>Sounds like you</h3>
        <p class="sub">Words you reach for that it does not.</p>
        <div class="chips">${r.vocabulary.userWords.map((w) => `<span class="chip you">${esc(w)}</span>`).join("")}</div>
        ${kv([["Your unique words", num(r.vocabulary.userUnique)]])}
      </div>
      <div class="panel">
        <h3>Sounds like it</h3>
        <p class="sub">Its signature vocabulary.</p>
        <div class="chips">${r.vocabulary.agentWords.map((w) => `<span class="chip it">${esc(w)}</span>`).join("")}</div>
        ${kv([["Its unique words", `${num(r.vocabulary.agentUnique)} — ${(r.vocabulary.agentUnique / (r.vocabulary.userUnique || 1)).toFixed(1)}× yours`]])}
      </div>
    </div>
  </section>

  <!-- ====================== RAGE ====================== -->
  <section class="inst" data-signal="alarm">
    <div class="rail"><span class="unit">Score</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Rage</h2>
      <p class="hint">Obfuscation-tolerant · stays on this machine</p>
    </div>

    <p class="finding">${r.rage.meter === 0 ? "Nothing in this window tripped the detector." : `The meter reads ${r.rage.meter} out of 100 across ${num(r.scale.instructions)} instructions.`}</p>
    <div class="split-2">
      <div class="panel">
        <h3>Rage meter</h3>
        <p class="sub">Weighted by severity: annoyance ×1, profanity ×3, insult ×6, and ×1.5 again when aimed at the agent rather than the code.</p>
        <div class="meter" id="rageMeter" data-tip="Score ${num(r.rage.total)} across ${num(r.scale.instructions)} instructions"></div>
        <div class="meter-scale"><span>0</span><span>50</span><span>100</span></div>
        ${kv([
          ["Profanity", num(r.rage.profanity)],
          ["Direct insults", num(r.rage.insults)],
          ["Aimed at the agent", num(r.rage.atAgent)],
          ["Shouting in caps", num(r.rage.shouting)],
        ])}
      </div>
      <div class="panel">
        <h3>Angriest moment</h3>
        ${worst
          ? `<p class="sub">${esc(dateLabel(worst.ts))}, ${esc(new Date(worst.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))} — score ${worst.score.toFixed(0)}, the highest of the window.</p>
        <blockquote>“${esc(quote)}”<cite>${esc(worst.project)} · ${worst.atAgent ? "aimed at the agent" : "aimed at the code"}</cite></blockquote>`
          : `<p class="sub">Nothing tripped the detector in this window.</p>`}
      </div>
    </div>
  </section>

  <!-- ====================== LEDGER ====================== -->
  <section class="inst" data-signal="burn">
    <div class="rail"><span class="unit">USD</span><span class="tick"></span></div>
    <div class="inst-head">
      <h2>Ledger</h2>
      <p class="hint">Private — never leaves the machine</p>
    </div>

    <p class="finding">${pct(r.ledger.permissiveShare)} of the work went through with no confirmation step.</p>
    <div class="panel">
      <h3>Spend by project</h3>
      <p class="sub">Session count and cost rarely track each other.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Project</th><th class="n">Sessions</th><th class="n">Cost</th><th class="n">Per session</th></tr></thead>
          <tbody>
            ${r.ledger.projects
              .map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${num(p.sessions)}</td><td class="n">${money(p.cost)}</td><td class="n">${money(p.cost / p.sessions)}</td></tr>`)
              .join("")}
          </tbody>
        </table>
      </div>
      <p class="sub" style="margin:20px 0 0">
        File types touched: ${r.ledger.fileTypes.map(([ext, n]) => `${esc(ext)} ${num(n)}`).join(", ") || "none"}.
        Permission mode ran ${r.ledger.permissionModes.map(([mode, n]) => `<strong>${esc(mode)}</strong> ${num(n)}`).join(", ")} —
      </p>
    </div>
  </section>

</div>

<div id="tip" role="status" aria-live="polite"></div>`;

  const shareText = [
    `My week with Claude Code — ${range}`,
    ``,
    `Archetype: ${r.archetype.name}`,
    `${num(r.scale.instructions)} things I said → ${num(r.scale.actions)} things it did`,
    `$${Math.round(r.money.billed)} of tokens · ${compact(r.volume.total)} moved`,
    ``,
    `Computed locally from my own transcripts, nothing uploaded:`,
    `npx cc-recap`,
  ].join("\n");

  const script = `
  const QUOTE_RAW = ${JSON.stringify(quoteHtml)};
  const QUOTE_SAFE = ${JSON.stringify(safeQuoteHtml)};
  const SHARE_TEXT = ${JSON.stringify(shareText)};
  const HOURS = ${JSON.stringify(r.rhythm.hours)};
  const DAYS = ${JSON.stringify(r.rhythm.days)};
  const RAGE = ${JSON.stringify(r.rage.meter)};
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  /**
   * Vertical bars sharing one scale, with the peak emphasised and the hours you
   * do not exist drawn as a stub on the baseline rather than left blank —
   * absence is the finding, so it has to be visible.
   *
   * The axis is a ruler: every step gets a tick so the scale reads as
   * continuous, and only every majorEvery-th one is numbered.
   */
  function columns(host, axis, values, labels, format, majorEvery) {
    const max = Math.max(...values, 1);
    const peak = values.indexOf(max);
    values.forEach((value, i) => {
      const col = el("div", "col" + (i === peak ? " peak" : value === 0 ? " empty" : ""));
      const bar = el("b");
      bar.style.setProperty("--h", Math.max((value / max) * 100, value === 0 ? 1.5 : 3) + "%");
      bar.style.setProperty("--delay", (i * 0.016).toFixed(3) + "s");
      col.appendChild(bar);
      col.dataset.tip = format(labels[i], value);
      host.appendChild(col);
      const major = i % majorEvery === 0;
      const tick = el("div", major ? "major" : "");
      if (major) tick.textContent = labels[i];
      axis.appendChild(tick);
    });
  }

  columns(
    document.getElementById("hourChart"),
    document.getElementById("hourAxis"),
    HOURS,
    HOURS.map((_, i) => String(i).padStart(2, "0")),
    (label, value) => label + ":00 — " + value.toLocaleString("en-US") + " events",
    window.matchMedia("(max-width: 560px)").matches ? 6 : 3,
  );

  columns(
    document.getElementById("dayChart"),
    document.getElementById("dayAxis"),
    DAYS,
    DAY_NAMES,
    (label, value) => label + " — " + value.toLocaleString("en-US") + " events",
    1,
  );

  // Card sparkline: the same 24 hours, compressed to a footer strip.
  const spark = document.getElementById("cardSpark");
  const sparkMax = Math.max(...HOURS, 1);
  HOURS.forEach((value) => {
    const bar = el("i", value === sparkMax ? "peak" : value === 0 ? "zero" : "");
    bar.style.height = Math.max((value / sparkMax) * 100, value === 0 ? 6 : 12) + "%";
    spark.appendChild(bar);
  });

  // Rage meter: 20 segments.
  const meter = document.getElementById("rageMeter");
  for (let i = 0; i < 20; i += 1) meter.appendChild(el("i", i < Math.round(RAGE / 5) ? "on" : ""));

  // ---- Powering up ---------------------------------------------------------
  // Every plot is armed at zero and lit when its panel first comes into view,
  // once. The class is added from here rather than written into the markup, so
  // a page with JS switched off simply shows the finished reading.
  const plots = document.querySelectorAll(".panel");
  if (window.IntersectionObserver && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    plots.forEach((plot) => plot.classList.add("arm"));
    const watcher = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("lit");
        watcher.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -12% 0px" });
    plots.forEach((plot) => watcher.observe(plot));
  }

  // Shared tooltip for every [data-tip] target.
  const tip = document.getElementById("tip");
  let raf = 0;
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest("[data-tip]");
    if (!target) return;
    tip.textContent = target.dataset.tip;
    tip.classList.add("on");
  });
  document.addEventListener("pointerout", (event) => {
    if (event.target.closest("[data-tip]")) tip.classList.remove("on");
  });
  document.addEventListener("pointermove", (event) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const pad = 14;
      let x = event.clientX + pad;
      let y = event.clientY + pad;
      if (x + tip.offsetWidth > window.innerWidth - 8) x = event.clientX - tip.offsetWidth - pad;
      if (y + tip.offsetHeight > window.innerHeight - 8) y = event.clientY - tip.offsetHeight - pad;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    });
  });

  // ---- The card as a file --------------------------------------------------
  // Screenshotting a browser window gives you a card at whatever width the
  // window happened to be, with a scrollbar down the side. This rasterises the
  // live card at a fixed 1200 x 630 through an SVG foreignObject, so what
  // lands in the timeline is the card and nothing else. No network, no library.

  const card = document.getElementById("shareCard");
  const note = document.getElementById("actNote");
  const quoteSlot = document.getElementById("quoteSlot");
  const NOTE_DEFAULT = note.textContent;
  const TOKENS = [
    "--card-ground", "--card-paper", "--card-graphite", "--card-rule",
    "--card-machine", "--card-ember", "--mono", "--serif", "--sans",
    "--t-micro", "--t-label", "--t-body", "--t-lead",
  ];

  let noteTimer = 0;
  function say(text) {
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.textContent = NOTE_DEFAULT; }, 6000);
  }

  /** The card, frozen at export size, as an SVG data URL. */
  function cardSvg() {
    const clone = card.cloneNode(true);
    clone.removeAttribute("id");
    clone.style.width = "1200px";
    clone.style.height = "630px";
    clone.style.minHeight = "0";
    clone.style.aspectRatio = "auto";

    // The page's tokens are read off the live root so the file matches the card
    // on screen, rather than whichever theme an SVG image decides it is in.
    const root = getComputedStyle(document.documentElement);
    const vars = TOKENS.map((t) => t + ":" + root.getPropertyValue(t).trim()).join(";");
    const css = document.getElementById("ccss").textContent;
    const markup = new XMLSerializer().serializeToString(clone);

    // The tokens go in a rule rather than a style attribute: the font stacks
    // carry double quotes of their own, which would end the attribute early.
    const pin = "#ccx{width:1200px;height:630px;" + vars + "}";

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">' +
      '<foreignObject x="0" y="0" width="1200" height="630">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" id="ccx">' +
      "<style><![CDATA[" + css + "\\n" + pin + "]]></style>" + markup +
      "</div></foreignObject></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /** 2400 x 1260 so it survives the timeline's re-encode. */
  function cardPng() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 2400;
        canvas.height = 1260;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 2400, 1260);
        try {
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no blob"))), "image/png");
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("the card would not rasterise"));
      img.src = cardSvg();
    });
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // A browser that will not rasterise the card still opens it, and the card is
  // the only thing on that page — so the fallback screenshot is still clean.
  function fallback(err) {
    say("Could not build the PNG here (" + err.message + ") — opened the card on its own page instead.");
    window.open(cardSvg(), "_blank", "noopener");
  }

  document.getElementById("dlPng").addEventListener("click", () => {
    say("Rendering…");
    cardPng().then((blob) => {
      saveBlob(blob, "cc-recap.png");
      say("Saved cc-recap.png — 1200 × 630, ready to drop into a post.");
    }, fallback);
  });

  document.getElementById("copyPng").addEventListener("click", () => {
    if (!navigator.clipboard || !window.ClipboardItem) {
      say("This browser has no image clipboard — use Download PNG.");
      return;
    }
    say("Rendering…");
    // Safari resolves the clipboard write against a promise handed over
    // synchronously, so the blob is passed as one rather than awaited first.
    const item = new ClipboardItem({ "image/png": cardPng() });
    navigator.clipboard.write([item]).then(
      () => say("Card copied — paste it straight into the post."),
      () => cardPng().then((blob) => { saveBlob(blob, "cc-recap.png"); say("Clipboard refused; saved cc-recap.png instead."); }, fallback),
    );
  });

  document.getElementById("shareX").addEventListener("click", () => {
    const intent = "https://x.com/intent/post?text=" + encodeURIComponent(SHARE_TEXT);
    window.open(intent, "_blank", "noopener");
    cardPng().then((blob) => {
      saveBlob(blob, "cc-recap.png");
      say("Post opened and cc-recap.png saved — drag the file into the post.");
    }, () => say("Post opened. Use Download PNG for the image."));
  });

  const safeToggle = document.getElementById("safeToggle");
  if (!QUOTE_RAW) {
    safeToggle.disabled = true;
    safeToggle.textContent = "No quote to hide";
  } else {
    safeToggle.addEventListener("click", () => {
      const on = safeToggle.getAttribute("aria-pressed") !== "true";
      safeToggle.setAttribute("aria-pressed", String(on));
      safeToggle.textContent = "Safe mode: " + (on ? "on" : "off");
      quoteSlot.innerHTML = on ? QUOTE_SAFE : QUOTE_RAW;
      say(on ? "Your angriest message is blocked out on the card. It is still in Rage, below." : "The quote is back on the card, verbatim.");
    });
  }`;

  return { body, script, css: CSS, title };
}

/** Standalone file for a browser. */
export function renderPage(report, options) {
  const { body, script, css, title } = render(report, options);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style id="ccss">${css}</style>
</head>
<body>
${body}
<script>${script}
</script>
</body>
</html>
`;
}

/** Body-only file, ready to hand to the Artifact tool (it supplies the skeleton). */
export function renderArtifact(report, options) {
  const { body, script, css, title } = render(report, options);
  return `<title>${esc(title)}</title>
<style id="ccss">${css}</style>
${body}
<script>${script}
</script>
`;
}
