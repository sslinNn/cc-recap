// Reads Claude Code transcripts (~/.claude/projects/**/*.jsonl) into a normalized corpus.
// Nothing here touches the network; every field comes off the local disk.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** Every *.jsonl under the projects dir, one level of nesting tolerated. */
function transcriptFiles(root) {
  const files = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) walk(full, depth + 1);
      } else if (entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  };
  walk(root, 0);
  return files;
}

/** The transcript dir name is the cwd with slashes flattened, which is lossy for
 *  hyphenated paths — so the first real cwd seen in a directory wins for all of it. */
const labelCache = new Map();

function projectLabel(dirName, cwd) {
  if (cwd) {
    const name = cwd.split("/").filter(Boolean).pop() ?? dirName;
    labelCache.set(dirName, name);
    return name;
  }
  if (labelCache.has(dirName)) return labelCache.get(dirName);
  const parts = dirName.replace(/^-/, "").replace(/-/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

const textOf = (block) => (typeof block?.text === "string" ? block.text : "");

/** Flatten a message's content into blocks, tolerating the string form. */
function blocksOf(message) {
  const content = message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter((b) => b && typeof b === "object") : [];
}

// Slash-command envelopes, hook output and injected reminders are not things the human
// said — strip them, and drop the message entirely if nothing of theirs is left.
const ENVELOPE = [
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<command-(name|message|args)>[\s\S]*?<\/command-\1>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g,
  // A finished background task reports itself through the user role; it is the
  // harness talking, and left in it wins "angriest message" on a quiet week.
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  // `!` runs a shell command locally. The human typed it, but they typed it at
  // the shell, not at the agent, so it is not one of their instructions.
  /<bash-(input|stdout|stderr)>[\s\S]*?<\/bash-\1>/g,
];

export function cleanPrompt(text) {
  let out = text;
  for (const re of ENVELOPE) out = out.replace(re, " ");
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u001b\[[0-9;]*m/g, "").trim();
}

/** Lines added/removed from a real diff, not from the fact that Edit was called. */
function diffStat(result) {
  let added = 0;
  let removed = 0;
  const patch = Array.isArray(result?.structuredPatch) ? result.structuredPatch : [];
  for (const hunk of patch) {
    for (const line of hunk?.lines ?? []) {
      if (typeof line !== "string") continue;
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) removed += 1;
    }
  }
  // A brand-new file arrives as `create` with an empty patch: every line is an addition.
  if (!patch.length && result?.type === "create" && typeof result.content === "string") {
    added += result.content.split("\n").length;
  }
  return { added, removed };
}

export function collect({ projectsDir = DEFAULT_PROJECTS_DIR, from = -Infinity, to = Infinity } = {}) {
  const corpus = {
    from,
    to,
    sessions: new Map(),
    turns: [],
    prompts: [],
    toolUses: [],
    toolResults: [],
    edits: [],
    assistantTexts: [],
    files: 0,
    lines: 0,
    skipped: 0,
  };

  for (const file of transcriptFiles(projectsDir)) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    corpus.files += 1;
    const dirName = file.slice(projectsDir.length + 1).split("/")[0];
    // tool_use_id -> tool name, so an error result can be attributed to the tool that failed.
    const toolNames = new Map();

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        corpus.skipped += 1;
        continue;
      }
      corpus.lines += 1;

      const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < from || ts > to) continue;

      const sessionId = rec.sessionId || rec.session_id;
      if (!sessionId) continue;
      const project = projectLabel(dirName, rec.cwd);

      let session = corpus.sessions.get(sessionId);
      if (!session) {
        session = {
          id: sessionId,
          project,
          dir: dirName,
          cwd: rec.cwd || "",
          start: ts,
          end: ts,
          events: 0,
          cost: 0,
          turns: 0,
          prompts: 0,
        };
        corpus.sessions.set(sessionId, session);
      }
      session.start = Math.min(session.start, ts);
      session.end = Math.max(session.end, ts);
      session.events += 1;

      const message = rec.message;
      const blocks = blocksOf(message);

      if (rec.type === "assistant") {
        const model = message?.model ?? "unknown";
        if (model === "<synthetic>") continue; // local error envelopes, never billed
        const usage = message?.usage ?? {};
        const cacheCreation = usage.cache_creation ?? {};
        const text = blocks.filter((b) => b.type === "text").map(textOf).join("\n");
        const turn = {
          ts,
          sessionId,
          project,
          model,
          isSidechain: rec.isSidechain === true,
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          cacheWrite1h: cacheCreation.ephemeral_1h_input_tokens ?? 0,
          cacheWrite5m: cacheCreation.ephemeral_5m_input_tokens ?? 0,
          thinking: usage.output_tokens_details?.thinking_tokens ?? 0,
          textChars: text.length,
          toolCalls: blocks.filter((b) => b.type === "tool_use").length,
        };
        corpus.turns.push(turn);
        session.turns += 1;
        if (text.trim()) corpus.assistantTexts.push({ ts, sessionId, text });

        for (const block of blocks) {
          if (block.type !== "tool_use") continue;
          toolNames.set(block.id, block.name);
          corpus.toolUses.push({ ts, sessionId, project, name: block.name, input: block.input ?? {} });
        }
        continue;
      }

      if (rec.type !== "user") continue;

      const results = blocks.filter((b) => b.type === "tool_result");
      if (results.length) {
        for (const block of results) {
          corpus.toolResults.push({
            ts,
            sessionId,
            name: toolNames.get(block.tool_use_id) ?? "unknown",
            isError: block.is_error === true,
          });
        }
        const result = rec.toolUseResult;
        if (result && typeof result === "object" && (result.structuredPatch || result.type === "create")) {
          const { added, removed } = diffStat(result);
          if (added || removed) {
            corpus.edits.push({ ts, sessionId, project, path: result.filePath ?? "", added, removed });
          }
        }
        continue;
      }

      // A real prompt: text the human (or a script acting as one) handed to the agent.
      if (rec.isMeta === true) continue;
      const text = cleanPrompt(blocks.filter((b) => b.type === "text").map(textOf).join("\n"));
      if (!text) continue;
      corpus.prompts.push({
        ts,
        sessionId,
        project,
        dir: dirName,
        text,
        permissionMode: rec.permissionMode ?? null,
        typed: rec.promptSource === "typed" || rec.origin?.kind === "human",
      });
      session.prompts += 1;
    }
  }

  // A directory's label may only become knowable late in the scan — apply it everywhere.
  for (const session of corpus.sessions.values()) {
    if (labelCache.has(session.dir)) session.project = labelCache.get(session.dir);
  }
  for (const prompt of corpus.prompts) {
    if (labelCache.has(prompt.dir)) prompt.project = labelCache.get(prompt.dir);
  }

  return corpus;
}
