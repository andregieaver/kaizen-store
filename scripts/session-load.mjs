// What a working session really loaded and read of the written rules and docs (bloat review step 1.24), from its own transcript.
//
//   node scripts/session-load.mjs [--transcript <file.jsonl>] [--step <id>]   write this session's file
//   node scripts/session-load.mjs --summary                                   the medians over the files written so far
//
// Run the first once, before a session's last push, and commit the file it writes under
// docs/audits/bloat-review-2026-11/session-load/: a cloud session's transcript is gone when its container is. It finds the newest
// transcript under ~/.claude/projects/<this folder> (or the one named), and the subagents' transcripts beside it, and writes ONE small file:
//
//   alwaysLoaded  the instruction files (CLAUDE.md and the like) the session was handed, with bytes and how many times
//   read          the rules and docs it read with the Read tool or through the shell (sed, cat), bytes and reads
//   omitted       how many `[Omitted long matching line]` marks a search or command answered with, by tool and path
//   totals        bytes of each kind, and codeChange: whether the session edited src, e2e, scripts or supabase
//
// Paths, bytes and counts only: never a prompt, a message, a command, a search pattern, an email address or the session id (the file
// holds 8 hex characters of its hash). The first 20 files are the 'before'; the first 20 after steps 2.1 and 2.40 are the 'after'.
// A transcript line is `{ type, message, toolUseResult, attachment }`; where a line has no `toolUseResult` (a subagent's), the text of
// its `tool_result` block is used, matched to the call by `tool_use_id`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OMITTED = "[Omitted long matching line]";
const DOC_PATH = /(?:^|[\s"'=/])((?:docs|\.claude)\/[\w./[\]()-]+|CLAUDE\.md|AGENTS\.md)/;
const CODE_DIRS = /^(?:src|e2e|scripts|supabase)\//;
const WHOLE_FILE = 0.8;
const SAMPLE = 20;

const bytes = (text) => Buffer.byteLength(typeof text === "string" ? text : "");
const isDoc = (rel) => rel === "CLAUDE.md" || rel === "AGENTS.md" || rel.startsWith("docs/") || rel.startsWith(".claude/") || rel.endsWith(".md");

/** The text of a tool result: a `toolUseResult` string, stdout or content, else the `tool_result` block's own text. */
function resultText(line, block) {
  const r = line.toolUseResult;
  if (r && typeof r === "object") {
    if (typeof r.stdout === "string") return r.stdout;
    if (typeof r.content === "string") return r.content;
    if (r.file && typeof r.file.content === "string") return r.file.content;
  }
  const c = block?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b?.text === "string" ? b.text : "")).join("");
  return "";
}

/** The pure part: transcript lines (each a JSON string or object) to what the session loaded and read. `roots` are the repo's folders. */
export function readTranscript(lines, { roots = [process.cwd()] } = {}) {
  const folders = new Set(roots.map((r) => r.replace(/\/+$/, "")));
  const objects = [];
  for (const raw of lines) {
    let o = raw;
    if (typeof raw === "string") {
      try {
        o = JSON.parse(raw);
      } catch {
        continue;
      }
    }
    if (o && typeof o === "object") objects.push(o);
  }
  for (const o of objects) if (typeof o.cwd === "string" && o.cwd.startsWith("/home/")) folders.add(o.cwd.replace(/\/+$/, ""));
  const ordered = [...folders].sort((a, b) => b.length - a.length);
  /** The repo-relative path, or null outside the repo. */
  const rel = (p) => {
    if (typeof p !== "string") return null;
    for (const f of ordered) if (p.startsWith(`${f}/`)) return p.slice(f.length + 1);
    return path.isAbsolute(p) ? null : p.replace(/^\.\//, "");
  };

  const always = new Map();
  const reads = new Map();
  const uses = new Map();
  const omittedBy = new Map();
  let session = "";
  let codeChange = false;
  let outsideRepoBytes = 0;
  let alwaysWithReloads = 0;
  let omittedLongLines = 0;

  for (const o of objects) {
    if (!session && typeof o.sessionId === "string") session = o.sessionId;
    if (o.type === "attachment" && o.attachment?.type === "instructions") {
      for (const f of o.attachment.files ?? []) {
        const b = bytes(f.content);
        const p = rel(f.path);
        if (p === null) {
          outsideRepoBytes += b;
          continue;
        }
        const e = always.get(p) ?? { path: p, bytes: 0, times: 0 };
        e.bytes = b;
        e.times++;
        always.set(p, e);
        alwaysWithReloads += b;
      }
      continue;
    }
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    if (o.type === "assistant") {
      for (const b of content) {
        if (b?.type !== "tool_use") continue;
        uses.set(b.id, { name: b.name, input: b.input ?? {} });
        if (["Edit", "Write", "NotebookEdit"].includes(b.name)) {
          const p = rel(b.input?.file_path ?? b.input?.notebook_path);
          if (p !== null && CODE_DIRS.test(p)) codeChange = true;
        }
      }
    } else if (o.type === "user") {
      for (const b of content) {
        if (b?.type !== "tool_result") continue;
        const use = uses.get(b.tool_use_id);
        const text = resultText(o, b);
        const marks = text.split(OMITTED).length - 1;
        if (marks > 0) {
          const where = use?.name === "Grep" ? rel(use.input.path ?? use.input.glob ?? "") ?? "" : "";
          const key = `${use?.name ?? "?"}\u0000${where}`;
          omittedBy.set(key, (omittedBy.get(key) ?? 0) + marks);
          omittedLongLines += marks;
        }
        const file = o.toolUseResult?.file;
        const isRead = use?.name === "Read" || (file && typeof file.filePath === "string");
        if (isRead) {
          const p = rel(file?.filePath ?? use?.input?.file_path);
          const b2 = bytes(file?.content ?? text);
          if (p === null) outsideRepoBytes += b2;
          else {
            const k = `${p}\u0000Read`;
            const e = reads.get(k) ?? { path: p, bytes: 0, reads: 0, via: "Read" };
            e.bytes += b2;
            e.reads++;
            reads.set(k, e);
          }
        } else if (use?.name === "Bash") {
          const m = DOC_PATH.exec(String(use.input.command ?? ""));
          const p = m ? rel(m[1]) : null;
          if (p !== null) {
            const k = `${p}\u0000shell`;
            const e = reads.get(k) ?? { path: p, bytes: 0, reads: 0, via: "shell" };
            e.bytes += bytes(text);
            e.reads++;
            reads.set(k, e);
          }
        }
      }
    }
  }

  const all = [...reads.values()];
  const docs = all.filter((e) => isDoc(e.path)).sort((a, b) => b.bytes - a.bytes);
  const sum = (list) => list.reduce((n, e) => n + e.bytes, 0);
  const alwaysLoaded = [...always.values()];
  return {
    session,
    codeChange,
    alwaysLoaded,
    read: docs,
    omitted: [...omittedBy].map(([key, count]) => {
      const [tool, p] = key.split("\u0000");
      return { tool, path: p, count };
    }),
    totals: {
      alwaysLoadedBytes: sum(alwaysLoaded),
      alwaysLoadedBytesWithReloads: alwaysWithReloads,
      rulesAndDocsReadBytes: sum(docs),
      sourceReadBytes: sum(all.filter((e) => !isDoc(e.path) && e.via === "Read")),
      outsideRepoBytes,
      omittedLongLines,
    },
  };
}

/** The file written for a session: the keys the brief names, the session as 8 hex characters of its hash. */
/** @param {{ date: string, step?: string | null, phase: string, subagents?: number }} meta */
export function sessionFile(parsed, { date, step = /** @type {string | null} */ (null), phase, subagents = 0 }) {
  return {
    date,
    session: createHash("sha256").update(parsed.session).digest("hex").slice(0, 8),
    step,
    phase,
    subagents,
    codeChange: parsed.codeChange,
    alwaysLoaded: parsed.alwaysLoaded,
    read: parsed.read,
    omitted: parsed.omitted,
    totals: parsed.totals,
  };
}

const median = (values) => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const fmt = (n) => (n === null ? "none yet" : n.toLocaleString("en-GB"));
const fmtBytes = (n) => (n === null ? "none yet" : `${fmt(n)} bytes`);

/** The pure part of --summary: `files` are the parsed session files in file-name order; `sizes` maps a docs/rules path to its bytes on disk. */
export function summarise(files, sizes = {}) {
  const out = [];
  /** @type {Record<string, { n: number, codeChange: number, loadMedian: number | null, omittedMedian: number | null, rules: unknown[] }>} */
  const groups = {};
  for (const phase of ["before", "after"]) {
    const group = files.filter((f) => f.phase === phase).slice(0, SAMPLE);
    const changing = group.filter((f) => f.codeChange);
    const loadMedian = median(changing.map((f) => f.totals.alwaysLoadedBytes + f.totals.rulesAndDocsReadBytes));
    const omittedMedian = median(group.map((f) => f.totals.omittedLongLines));
    const perRule = new Map();
    for (const f of group) {
      const bySession = new Map();
      for (const e of f.read) if (e.path.startsWith("docs/rules/")) bySession.set(e.path, (bySession.get(e.path) ?? 0) + e.bytes);
      for (const [p, b] of bySession) perRule.set(p, [...(perRule.get(p) ?? []), b]);
    }
    const rules = [...perRule].sort(([a], [b]) => a.localeCompare(b)).map(([p, list]) => {
      const m = median(list);
      const size = sizes[p] ?? null;
      return { path: p, size, median: m, whole: size !== null && size > 0 && m >= WHOLE_FILE * size };
    });
    groups[phase] = { n: group.length, codeChange: changing.length, loadMedian, omittedMedian, rules };
    out.push(
      `${phase}: ${group.length === SAMPLE ? `${SAMPLE} of ${SAMPLE}` : `${group.length} of ${SAMPLE}`}; ${changing.length} with a code change; ` +
        `median of always loaded plus rules and docs read, per code-change session: ${fmtBytes(loadMedian)}; ` +
        `median omitted long lines: ${fmt(omittedMedian)}`,
    );
    for (const r of rules) {
      out.push(`  ${r.path}: ${fmtBytes(r.size)} on disk, median read ${fmtBytes(r.median)}${r.whole ? "  WHOLE FILE READ" : ""}`);
    }
  }
  return { groups, lines: out };
}

// The command-line part.
const root = path.join(import.meta.dirname, "..");
const dir = path.join(root, "docs", "audits", "bloat-review-2026-11", "session-load");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  if (process.argv.includes("--summary")) {
    const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
    const files = names.map((n) => JSON.parse(readFileSync(path.join(dir, n), "utf8")));
    const sizes = {};
    for (const f of files) for (const e of f.read) if (e.path.startsWith("docs/rules/") && !(e.path in sizes) && existsSync(path.join(root, e.path))) sizes[e.path] = statSync(path.join(root, e.path)).size;
    console.log(summarise(files, sizes).lines.join("\n"));
    return;
  }
  let transcript = arg("--transcript");
  const folder = path.join(os.homedir(), ".claude", "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
  if (!transcript) {
    const found = existsSync(folder)
      ? readdirSync(folder).filter((n) => n.endsWith(".jsonl")).map((n) => ({ n, t: statSync(path.join(folder, n)).mtimeMs })).sort((a, b) => b.t - a.t)
      : [];
    if (found.length === 0) {
      console.log(`no transcript found in ${folder}; pass --transcript`);
      process.exit(1);
    }
    transcript = path.join(folder, found[0].n);
  }
  const lines = readFileSync(transcript, "utf8").split("\n").filter(Boolean);
  const subDir = path.join(path.dirname(transcript), path.basename(transcript, ".jsonl"), "subagents");
  let subagents = 0;
  if (existsSync(subDir)) {
    for (const n of readdirSync(subDir).filter((x) => x.endsWith(".jsonl"))) {
      lines.push(...readFileSync(path.join(subDir, n), "utf8").split("\n").filter(Boolean));
      subagents++;
    }
  }
  const parsed = readTranscript(lines, { roots: [process.cwd(), root] });
  const claude = existsSync(path.join(root, "CLAUDE.md")) ? statSync(path.join(root, "CLAUDE.md")).size : Infinity;
  const phase = claude < 15_000 && existsSync(path.join(root, "docs", "decisions")) ? "after" : "before";
  const date = new Date().toISOString().slice(0, 10);
  const file = sessionFile(parsed, { date, step: arg("--step") ?? null, phase, subagents });
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${date}-${file.session}.json`);
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  console.log(JSON.stringify(file.totals, null, 2));
  console.log(`Wrote ${path.relative(root, out)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
