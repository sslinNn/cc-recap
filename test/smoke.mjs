// End-to-end check against a synthetic transcript — never reads the real ~/.claude.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

import { collect } from "../src/collect.mjs";
import { analyze } from "../src/metrics.mjs";
import { renderPage } from "../src/render.mjs";
import { shellProgram } from "../src/metrics.mjs";

const root = mkdtempSync(join(tmpdir(), "cc-recap-test-"));
const project = join(root, "-home-tester-dev-demo");
mkdirSync(project, { recursive: true });

const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const base = { sessionId: "s1", cwd: "/home/tester/dev/demo", isSidechain: false };

const usage = (over) => ({
  input_tokens: 10,
  output_tokens: 1000,
  cache_creation_input_tokens: 2000,
  cache_read_input_tokens: 100000,
  cache_creation: { ephemeral_1h_input_tokens: 2000, ephemeral_5m_input_tokens: 0 },
  output_tokens_details: { thinking_tokens: 400 },
  ...over,
});

const records = [
  { ...base, type: "user", timestamp: at(50), promptSource: "typed", origin: { kind: "human" },
    permissionMode: "bypassPermissions",
    message: { role: "user", content: "б л я, опять не работает, почини уже" } },
  { ...base, type: "user", timestamp: at(49),
    message: { role: "user", content: "<command-name>/clear</command-name>" } },
  { ...base, type: "assistant", timestamp: at(48),
    message: { role: "assistant", model: "claude-opus-5", usage: usage(),
      content: [
        { type: "text", text: "Сейчас проверю и поправлю." },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "cd /tmp && grep -r foo . <<'EOF'\nignored\nEOF" } },
      ] } },
  { ...base, type: "user", timestamp: at(47),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }] },
    toolUseResult: { stdout: "", stderr: "boom" } },
  { ...base, type: "assistant", timestamp: at(46),
    message: { role: "assistant", model: "claude-sonnet-5", usage: usage({ output_tokens: 500 }),
      content: [{ type: "tool_use", id: "t2", name: "Edit", input: {} }] } },
  { ...base, type: "user", timestamp: at(45),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2" }] },
    toolUseResult: { type: "update", filePath: "/home/tester/dev/demo/app.ts",
      structuredPatch: [{ lines: [" keep", "+added one", "+added two", "-removed one"] }] } },
  { ...base, type: "assistant", timestamp: at(44),
    message: { role: "assistant", model: "claude-opus-5", usage: usage({ output_tokens: 200 }),
      content: [{ type: "text", text: "Готово, работает." }] } },
];

writeFileSync(join(project, "s1.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");

const corpus = collect({ projectsDir: root, from: 0, to: Date.now() });
const report = analyze(corpus);

// Envelope-only messages are not instructions.
assert.equal(report.scale.instructions, 1, "slash-command envelope must not count as a prompt");
assert.equal(report.scale.typed, 1);
assert.equal(report.scale.actions, 3, "three assistant turns");

// Diffs, not tool-call counts.
assert.equal(report.work.added, 2);
assert.equal(report.work.removed, 1);
assert.equal(report.work.net, 1);
assert.equal(report.work.errors, 1);

// Usage arithmetic and the cache model.
assert.equal(report.volume.cacheRead, 300000);
assert.equal(report.volume.thinking, 1200);
assert.ok(report.money.uncached > report.money.billed, "cache must be worth something");
assert.equal(report.models.length, 2);

// Bilingual phrase mining must actually fire on Cyrillic.
const phrase = Object.fromEntries(report.behaviour.phrases);
assert.ok(phrase["Narrated an action"] >= 1, "RU narration missed — check Unicode word boundaries");
assert.ok(phrase["Declared victory"] >= 1, "RU victory claim missed");
assert.equal(report.behaviour.stated, 1);
assert.equal(report.behaviour.acted, 1);

// Obfuscated profanity, and permission posture.
assert.ok(report.rage.profanity >= 1, "spaced-out profanity missed");
assert.ok(report.rage.worst, "an angriest message should exist");
assert.equal(report.ledger.permissiveShare, 100);
assert.equal(report.ledger.projects[0].name, "demo");

// Heredoc bodies must not become shell programs.
assert.equal(shellProgram("cd /tmp && grep -r foo . <<'EOF'\nignored\nEOF"), "cd");
assert.equal(report.shell[0][0], "cd");

// The page renders and carries the figures.
const html = renderPage(report);
assert.ok(html.startsWith("<!doctype html>"));
assert.ok(html.includes("AI WRAPPED"));
assert.ok(!/undefined|NaN/.test(html), "rendered page has holes");

console.log("smoke: ok —", report.scale.actions, "turns,", report.work.net, "net lines, rage", report.rage.meter);
