#!/usr/bin/env node
// cc-recap — Spotify-Wrapped for Claude Code.
// Reads ~/.claude/projects/**/*.jsonl, computes everything locally, writes one HTML file.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { collect, DEFAULT_PROJECTS_DIR } from "./src/collect.mjs";
import { analyze } from "./src/metrics.mjs";
import { renderPage, renderArtifact } from "./src/render.mjs";
import { DEFAULT_PRICES } from "./src/pricing.mjs";

const PKG = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8"),
);

const HELP = `cc-recap — your week with Claude Code, computed from your own transcripts.

Usage: cc-recap [options]

  --days N          window length, counted back from today (default 7)
  --from DATE       start date, YYYY-MM-DD (overrides --days)
  --to DATE         end date, YYYY-MM-DD (default: today)
  --all             every transcript on the machine, no window
  --out FILE        output path (default ./cc-recap.html)
  --json FILE       also write the raw report as JSON
  --artifact        emit a body-only file for the Artifact tool instead of a full page
  --projects DIR    transcripts root (default ${DEFAULT_PROJECTS_DIR})
  --prices FILE     JSON price overrides, e.g. {"claude-opus-5":{"in":15,"out":75}}
  --open            open the report in your browser when it is written
  --quiet           no terminal summary
  --version         print the version
  --help            this text

Nothing is uploaded and nothing is sent anywhere; the only output is the file you asked for.`;

function parseArgs(argv) {
  const args = { days: 7, out: "cc-recap.html" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => argv[++i];
    switch (flag) {
      case "--days": args.days = Number(value()); break;
      case "--from": args.from = value(); break;
      case "--to": args.to = value(); break;
      case "--all": args.all = true; break;
      case "--out": args.out = value(); break;
      case "--json": args.json = value(); break;
      case "--artifact": args.artifact = true; break;
      case "--projects": args.projects = value(); break;
      case "--prices": args.prices = value(); break;
      case "--open": args.open = true; break;
      case "--quiet": args.quiet = true; break;
      case "--version": case "-v": args.version = true; break;
      case "--help": case "-h": args.help = true; break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }
  return args;
}

/** Local-midnight boundaries, so "the week" means the week you lived, not UTC's. */
function window(args) {
  if (args.all) return { from: 0, to: Date.now() };
  const end = args.to ? new Date(args.to + "T23:59:59.999") : new Date();
  const start = args.from
    ? new Date(args.from + "T00:00:00")
    : new Date(new Date(end).setHours(0, 0, 0, 0) - (args.days - 1) * 86400000);
  return { from: start.getTime(), to: end.getTime() };
}

function summary(r) {
  const line = (k, v) => `  ${k.padEnd(22)} ${v}`;
  return [
    "",
    `  ${r.archetype.name} — ${r.archetype.verdict}`,
    "",
    line("Period", `${new Date(r.period.from).toLocaleDateString("sv-SE")} → ${new Date(r.period.to).toLocaleDateString("sv-SE")}`),
    line("Sessions", `${r.scale.sessions} across ${r.rhythm.activeDays} active days`),
    line("Instructions", `${r.scale.instructions} (${r.scale.typed} typed by you)`),
    line("Agent turns", r.scale.actions),
    line("Spent", `$${r.money.billed.toFixed(2)} (uncached: $${r.money.uncached.toFixed(2)})`),
    line("Tokens", `${(r.volume.total / 1e6).toFixed(1)}M — ${r.volume.cacheShare.toFixed(1)}% cache reads`),
    line("Hidden thinking", `${r.volume.thinkingShare.toFixed(1)}% of output`),
    line("Code", `+${r.work.added} / -${r.work.removed} → ${r.work.net} net`),
    line("Rage meter", `${r.rage.meter}/100`),
    "",
  ].join("\n");
}

/** Hand the file to whatever the platform uses to open things. */
function openInBrowser(file) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(opener, [file], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Opening is a convenience; the path is printed either way.
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message + "\n\n" + HELP);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(PKG.version);
    return;
  }

  const prices = args.prices
    ? { ...DEFAULT_PRICES, ...JSON.parse(readFileSync(args.prices, "utf8")) }
    : DEFAULT_PRICES;

  const { from, to } = window(args);
  const corpus = collect({ projectsDir: args.projects ?? DEFAULT_PROJECTS_DIR, from, to });
  if (!corpus.files) {
    console.error(`No transcripts found in ${args.projects ?? DEFAULT_PROJECTS_DIR}`);
    process.exit(1);
  }
  if (!corpus.turns.length) {
    console.error("No activity in this window — try --days 30 or --all.");
    process.exit(1);
  }

  const report = analyze(corpus, { prices });
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, args.artifact ? renderArtifact(report) : renderPage(report), "utf8");
  if (args.json) {
    mkdirSync(dirname(resolve(args.json)), { recursive: true });
    writeFileSync(resolve(args.json), JSON.stringify(report, null, 2), "utf8");
  }

  if (args.open) openInBrowser(out);

  if (!args.quiet) {
    console.log(summary(report));
    console.log(`  Written to ${out}`);
    console.log(`  Read ${corpus.lines.toLocaleString("en-US")} records from ${corpus.files} transcripts`);
    console.log(`  Open it and hit Download PNG — the card comes out 1200 x 630, and`);
    console.log(`  Safe mode masks the swearing in your angriest message before it does.\n`);
  }
}

main();
