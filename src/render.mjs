// Renders the report as one self-contained HTML page. Design carried over from the
// original AI Wrapped artifact; every figure comes from src/metrics.mjs.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function bars(rows, cls, format = num) {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return rows
    .map(([name, value, tip]) => `
        <div class="bar-row" data-tip="${esc(tip ?? `${name} — ${num(value)}`)}">
          <span class="bar-key">${esc(name)}</span>
          <span class="bar-track"><span class="bar-fill${cls ? " " + cls : ""}" style="width:${(100 * value) / max}%"></span></span>
          <span class="bar-val num">${esc(format(value))}</span>
        </div>`)
    .join("");
}

function pairRow(label, total, left, right, leftTip, rightTip, colors = ["signal", "cool"]) {
  const sum = left + right || 1;
  const l = (100 * left) / sum;
  return `
        <div class="pair-row">
          <div class="pair-head"><span>${esc(label)}</span><span class="num">${esc(total)}</span></div>
          <div class="pair-track">
            <span class="pair-seg seg-${colors[0]}" style="width:${l}%" data-tip="${esc(leftTip)}">${Math.round(l)}%</span>
            <span class="pair-seg seg-${colors[1]}" style="width:${100 - l}%" data-tip="${esc(rightTip)}">${Math.round(100 - l)}%</span>
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
export function render(r, { title = "AI Wrapped" } = {}) {
  const from = dateLabel(r.period.from);
  const to = new Date(r.period.to).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const range = `${from}–${to}`;
  const ratio = r.work.ratio ? r.work.ratio.toFixed(1) : "—";
  const worst = r.rage.worst;
  const quote = worst ? worst.text.replace(/\s+/g, " ").slice(0, 150) + (worst.text.length > 150 ? "…" : "") : null;

  const body = `
<div class="wrap">

  <div class="masthead">
    <h1>AI WRAPPED</h1>
    <div class="meta">
      <div class="label">Reporting period</div>
      <div class="num">${esc(new Date(r.period.from).toLocaleDateString("sv-SE"))} → ${esc(new Date(r.period.to).toLocaleDateString("sv-SE"))}</div>
    </div>
  </div>
  <div class="strapline">
    <span class="label">${num(r.scale.sessions)} sessions · ${num(r.rhythm.activeDays)} active days</span>
    <span class="label">Computed locally · nothing uploaded</span>
  </div>

  <!-- ====================== SHARE CARD ====================== -->
  <div class="card-frame">
    <div class="sec-head">
      <h2>The card</h2>
      <span class="hint">Screenshot this one · 1200 × 630</span>
    </div>

    <div class="card">
      <div class="card-top">
        <span class="name">AI Wrapped</span>
        <span class="range num">${esc(range)} · Claude Code</span>
      </div>

      <div class="card-body">
        <div>
          <div class="arch-tag">Your archetype</div>
          <div class="arch">${esc(r.archetype.name)}</div>
          <p class="verdict">${esc(r.archetype.verdict)}</p>
          <div class="flow">
            <span><b class="num">${num(r.scale.instructions)}</b><span class="lbl">things you said</span></span>
            <span class="to">→</span>
            <span><b class="num v-signal">${num(r.scale.actions)}</b><span class="lbl">things it did</span></span>
          </div>
        </div>

        <div>
          ${quote ? `<div class="quote-strip">“${esc(quote)}”<span class="who">Your angriest message · ${esc(dateLabel(worst.ts))}, ${esc(new Date(worst.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}</span></div>` : ""}
          <div class="mini-tiles">
            <div class="tile"><span class="v v-signal num">$${Math.round(r.money.billed)}</span><span class="k">Burned in ${num(r.rhythm.activeDays)} days</span></div>
            <div class="tile"><span class="v num">${r.rhythm.firstHour ?? 0}–${(r.rhythm.lastHour ?? 0) + 1}h</span><span class="k">The only hours you exist</span></div>
            <div class="tile"><span class="v num">${esc(ratio)}<span style="font-size:0.6em">:1</span></span><span class="k">Lines written per 1 kept</span></div>
            <div class="tile"><span class="v v-alert num">${pct(r.ledger.permissiveShare)}</span><span class="k">Ran with permissions off</span></div>
          </div>
        </div>
      </div>

      <div class="card-foot">
        <div class="foot-rhythm">
          <div class="label" style="margin-bottom:6px">Every hour of your week · ${num(r.scale.sessions)} sessions in ${num(r.rhythm.activeDays)} days</div>
          <div class="card-spark" id="cardSpark"></div>
        </div>
        <div class="foot-archetype">
          <div class="word-strip"><span>Its favourite words:</span>${r.vocabulary.agentWords.slice(0, 5).map((w) => `<b>${esc(w)}</b>`).join("")}</div>
          <div class="word-strip" style="margin-top:4px"><span>Yours:</span>${r.vocabulary.userWords.slice(0, 3).map((w) => `<b style="color:var(--card-signal)">${esc(w)}</b>`).join("")}</div>
        </div>
      </div>
    </div>

    <div class="card-note">
      <span>Every figure below is computed from your own transcripts on this machine.</span>
      <span>${pct(r.volume.cacheShare, 1)} of all token traffic was re-reading cached context.</span>
    </div>
  </div>

  <!-- ====================== MONEY ====================== -->
  <section>
    <div class="sec-head">
      <h2>Money</h2>
      <span class="hint">List prices · cache read 0.1× · cache write 2× at 1h TTL</span>
    </div>

    <div class="grid-3" style="margin-bottom:22px">
      ${stat("Actually spent", money(r.money.billed), `across ${num(r.scale.sessions)} sessions`)}
      ${stat("Without caching", money(r.money.uncached), "same tokens, no cache", "cool")}
      ${stat("Cost per instruction", money(r.money.perInstruction), `${num(r.scale.instructions)} instructions given`)}
      ${stat("Cost per surviving line", r.money.perSurvivingLine === null ? "—" : money(r.money.perSurvivingLine), `${num(r.work.net)} net lines of code`)}
    </div>

    <div class="panel">
      <h3>What the cache is worth</h3>
      <p class="sub">Same traffic priced two ways. The gap is the discount for re-reading context you had already sent.</p>
      <div class="bars">
        <div class="bar-row" data-tip="Billed at cache-read and cache-write rates">
          <span class="bar-key">Billed</span>
          <span class="bar-track"><span class="bar-fill" style="width:${r.money.billedShare}%"></span></span>
          <span class="bar-val num">${money(r.money.billed)}</span>
        </div>
        <div class="bar-row" data-tip="Every cached token billed as fresh input">
          <span class="bar-key">If uncached</span>
          <span class="bar-track"><span class="bar-fill cool" style="width:100%"></span></span>
          <span class="bar-val num">${money(r.money.uncached)}</span>
        </div>
      </div>
      <p class="prose" style="margin-top:14px;font-size:var(--step-1)">
        Caching absorbed <strong>${money(r.money.saved)}</strong> — ${pct(r.money.savedShare, 1)} of what this work would otherwise have cost.
      </p>
    </div>
  </section>

  <!-- ====================== MODELS ====================== -->
  <section>
    <div class="sec-head">
      <h2>Models</h2>
      <span class="hint">Two shares of the same 100% scale</span>
    </div>
    <div class="panel">
      <h3>${esc(modelLine(r))}</h3>
      <p class="sub">Turns and spend rarely line up — the expensive model is not the busy one.</p>
      <div class="legend">
        ${r.models.slice(0, 2).map((m, i) => `<span><i class="swatch" style="background:var(--${i ? "cool" : "signal"})"></i> ${esc(m.label)}</span>`).join("")}
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
  <section>
    <div class="sec-head">
      <h2>Volume</h2>
      <span class="hint">${compact(r.volume.total)} tokens moved in total</span>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Where the tokens went</h3>
        <p class="sub">Almost everything was context being re-read, not new text being produced.</p>
        <div class="bars">
          ${bars(
            [
              ["Cache read", r.volume.cacheRead, "Cached context replayed at 0.1× input price"],
              ["Cache write", r.volume.cacheWrite, "Context written into the cache at 2× (1h TTL)"],
              ["Output", r.volume.output, "Tokens the model generated"],
              ["Fresh input", r.volume.input, "Text never seen before"],
            ].map(([k, v, tip]) => [k, v, `${tip} — ${num(v)}`]),
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
  <section>
    <div class="sec-head">
      <h2>Rhythm</h2>
      <span class="hint">Local time · all activity</span>
    </div>
    <div class="panel" style="margin-bottom:22px">
      <h3>Hour of day</h3>
      <p class="sub">${esc(rhythmLine(r))}</p>
      <div class="cols" id="hourChart"></div>
      <div class="col-axis" id="hourAxis"></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Day of week</h3>
        <p class="sub">${num(r.rhythm.activeDays)} of ${num(r.rhythm.periodDays)} days carried everything; the longest streak reached ${num(r.rhythm.streak)}.</p>
        <div class="cols" id="dayChart" style="height:96px"></div>
        <div class="col-axis" id="dayAxis"></div>
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
  <section>
    <div class="sec-head">
      <h2>Work</h2>
      <span class="hint">From real diffs, not tool-call counts</span>
    </div>
    <div class="grid-3" style="margin-bottom:22px">
      ${stat("Lines added", num(r.work.added))}
      ${stat("Lines removed", num(r.work.removed), "", "alert")}
      ${stat("Net survivors", num(r.work.net), `${ratio} written per 1 kept`, "cool")}
      ${stat("Tool errors", num(r.work.errors), `against ${num(r.work.victoryClaims)} victory claims`)}
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Tools</h3>
        <p class="sub">${esc(toolLine(r))}</p>
        <div class="bars">${bars(r.tools)}</div>
      </div>
      <div class="panel">
        <h3>Shell commands</h3>
        <p class="sub">Top program per invocation, heredoc bodies excluded.</p>
        <div class="bars">${bars(r.shell, "cool")}</div>
      </div>
    </div>
  </section>

  <!-- ====================== BEHAVIOUR ====================== -->
  <section>
    <div class="sec-head">
      <h2>Behaviour</h2>
      <span class="hint">Phrase mining across ${compact(r.volume.agentChars)} characters, EN + RU</span>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>What it said</h3>
        <p class="sub">Each category counts the messages it appeared in, not every occurrence.</p>
        <div class="bars">${bars(r.behaviour.phrases)}</div>
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
            ["cool", "signal"],
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
  <section>
    <div class="sec-head">
      <h2>Vocabulary</h2>
      <span class="hint">Distinctive words, not frequent ones</span>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Sounds like you</h3>
        <p class="sub">Words you reach for that it does not.</p>
        <div class="chips">${r.vocabulary.userWords.map((w) => `<span class="chip sig">${esc(w)}</span>`).join("")}</div>
        ${kv([["Your unique words", num(r.vocabulary.userUnique)]])}
      </div>
      <div class="panel">
        <h3>Sounds like it</h3>
        <p class="sub">Its signature vocabulary.</p>
        <div class="chips">${r.vocabulary.agentWords.map((w) => `<span class="chip cool">${esc(w)}</span>`).join("")}</div>
        ${kv([["Its unique words", `${num(r.vocabulary.agentUnique)} — ${(r.vocabulary.agentUnique / (r.vocabulary.userUnique || 1)).toFixed(1)}× yours`]])}
      </div>
    </div>
  </section>

  <!-- ====================== RAGE ====================== -->
  <section>
    <div class="sec-head">
      <h2>Rage</h2>
      <span class="hint">Obfuscation-tolerant · stays on this machine</span>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Rage meter</h3>
        <p class="sub">Weighted by severity: annoyance ×1, profanity ×3, insult ×6, and ×1.5 again when aimed at the agent rather than the code.</p>
        <div class="meter" id="rageMeter" data-tip="Score ${num(r.rage.total)} across ${num(r.scale.instructions)} instructions"></div>
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
  <section>
    <div class="sec-head">
      <h2>Ledger</h2>
      <span class="hint">Private — never leaves the machine</span>
    </div>
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
      <p class="prose" style="margin-top:16px;font-size:var(--step-1)">
        File types touched: ${r.ledger.fileTypes.map(([ext, n]) => `${esc(ext)} ${num(n)}`).join(", ") || "none"}.
        Permission mode ran ${r.ledger.permissionModes.map(([mode, n]) => `<strong>${esc(mode)}</strong> ${num(n)}`).join(", ")} —
        ${pct(r.ledger.permissiveShare)} of the work went through with no confirmation step.
      </p>
    </div>
  </section>

</div>

<div id="tip" role="status" aria-live="polite"></div>`;

  const script = `
  const HOURS = ${JSON.stringify(r.rhythm.hours)};
  const DAYS = ${JSON.stringify(r.rhythm.days)};
  const RAGE = ${JSON.stringify(r.rage.meter)};
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  /** Vertical bars sharing one scale, with the peak emphasised. */
  function columns(host, axis, values, labels, format) {
    const max = Math.max(...values, 1);
    const peak = values.indexOf(max);
    values.forEach((value, i) => {
      const col = el("div", "col" + (i === peak ? " peak" : value === 0 ? " empty" : ""));
      const bar = el("b");
      bar.style.height = Math.max((value / max) * 100, value === 0 ? 1.5 : 3) + "%";
      col.appendChild(bar);
      col.dataset.tip = format(labels[i], value);
      host.appendChild(col);
      const tick = el("div");
      tick.textContent = labels[i];
      axis.appendChild(tick);
    });
  }

  columns(
    document.getElementById("hourChart"),
    document.getElementById("hourAxis"),
    HOURS,
    HOURS.map((_, i) => String(i).padStart(2, "0")),
    (label, value) => label + ":00 — " + value.toLocaleString("en-US") + " events",
  );
  const tickStep = window.matchMedia("(max-width: 560px)").matches ? 6 : 3;
  document.querySelectorAll("#hourAxis div").forEach((tick, i) => {
    if (i % tickStep !== 0) tick.textContent = "";
  });

  columns(
    document.getElementById("dayChart"),
    document.getElementById("dayAxis"),
    DAYS,
    DAY_NAMES,
    (label, value) => label + " — " + value.toLocaleString("en-US") + " events",
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
  });`;

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
<style>${css}</style>
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
<style>${css}</style>
${body}
<script>${script}
</script>
`;
}
