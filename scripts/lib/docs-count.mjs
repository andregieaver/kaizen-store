// Counters for the written rules (bloat review step 1.1, src/lib/docs-budget.scan.test.ts). Plain Node, built-ins only: no
// function reads process.cwd(), the caller passes the root.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { NAME_EXCEPTIONS, staleRuleNames } from "./rule-names.mjs";

export const staleNames = staleRuleNames;
export { NAME_EXCEPTIONS };

/** Repo-relative paths, sorted, of every *.baseline.json under src. */
export function baselineFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".next") walk(rel);
      } else if (entry.isFile() && entry.name.endsWith(".baseline.json")) found.push(rel);
    }
  };
  if (existsSync(path.join(root, "src")) && statSync(path.join(root, "src")).isDirectory()) walk("src");
  return found.sort();
}

/** The files whose path is not a substring of the rule text. */
export function unnamedBaselines(files, ruleText) {
  return files.filter((file) => !ruleText.includes(file));
}

// ---- The written rules (step 1.1, commit 2) --------------------------------------------------------------------------------

/** Sentences that guard an action taken without opening a file: they stay in CLAUDE.md. An array entry needs every phrase. */
export const NEVER_SENTENCES = [
  "Never apply a migration to production by hand",
  "never rename or drop in the same change",
  "Never add a bypass to the app's sign-in for a test",
  "Money is integer minor units",
  "`countries.standard_vat_rate` for a product",
  ["AI features must stay grounded", "never as HTML"],
  "Server-only modules import",
  "The platform's name is Kaizena Flow",
  "Homer and Lisa",
  "Whatever is built for stores and their owners is built for the platform too",
];

/** The working plans whose progress rows are held to 300 characters. */
export const TRACKERS = ["docs/audits/psi-followups.md", "docs/audits/code-review-2026-11.md", "docs/audits/bloat-review-2026-11.md"];

const LONG_LINE = 500;
const BIG_RULE = 4000;
const BIG_HEADINGS = 10000;
const TRACKER_ROW = 300;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

const isDir = (full) => existsSync(full) && statSync(full).isDirectory();
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");
const chars = (line) => [...line].length;

/** Repo-relative paths of every file under dir (a repo-relative folder) that passes keep(name), sorted. */
function filesUnder(root, dir, keep, skip = () => false) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !skip(child, true)) walk(child);
      } else if (entry.isFile() && keep(entry.name) && !skip(child, false)) out.push(child);
    }
  };
  if (isDir(path.join(root, dir))) walk(dir);
  return out.sort();
}

const markdown = (name) => name.endsWith(".md");

// ---- ignore files: a small matcher of our own, so CI's runner needs no rg ----

function foldersWithIgnoreFiles(root) {
  const folders = ["", "docs", "supabase"];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        folders.push(`${rel}/${entry.name}`);
        walk(`${rel}/${entry.name}`);
      }
    }
  };
  if (isDir(path.join(root, "docs", "audits"))) {
    folders.push("docs/audits");
    walk("docs/audits");
  }
  return folders.filter((folder) => isDir(path.join(root, folder)));
}

function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      source += ".*";
      i += 1;
    } else if (ch === "*") source += "[^/]*";
    else source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function patternsOf(root, folder) {
  const patterns = [];
  for (const name of [".ignore", ".rgignore"]) {
    const file = path.join(root, folder, name);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      let line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const dirOnly = line.endsWith("/");
      if (dirOnly) line = line.slice(0, -1);
      const anchored = line.startsWith("/") || line.includes("/");
      if (line.startsWith("/")) line = line.slice(1);
      patterns.push({ regexp: globToRegExp(line), anchored, dirOnly });
    }
  }
  return patterns;
}

const ignoreCache = new Map();
function ignoreTable(root) {
  if (!ignoreCache.has(root)) {
    ignoreCache.set(
      root,
      foldersWithIgnoreFiles(root).map((folder) => ({ folder, patterns: patternsOf(root, folder) })).filter((entry) => entry.patterns.length),
    );
  }
  return ignoreCache.get(root);
}

/** True when an ignore file (.ignore or .rgignore) covers the repo-relative path or one of its folders. */
export function ignored(root, relPath, asFolder = false) {
  for (const { folder, patterns } of ignoreTable(root)) {
    const prefix = folder === "" ? "" : `${folder}/`;
    if (!relPath.startsWith(prefix)) continue;
    const segments = relPath.slice(prefix.length).split("/");
    for (let i = 1; i <= segments.length; i += 1) {
      const candidate = segments.slice(0, i).join("/");
      const candidateIsDir = i < segments.length || asFolder;
      for (const pattern of patterns) {
        if (pattern.dirOnly && !candidateIsDir) continue;
        if (pattern.regexp.test(pattern.anchored ? candidate : segments[i - 1])) return true;
      }
    }
  }
  return false;
}

// ---- rules, decisions and trackers ----

function ruleFilePaths(root) {
  const files = [];
  if (existsSync(path.join(root, "docs/rules/storefront.md"))) files.push("docs/rules/storefront.md");
  for (const file of filesUnder(root, "docs/rules/admin", markdown)) if (!file.endsWith("/README.md")) files.push(file);
  return files;
}

/** One rule per '## ' heading: { heading, bytes }. */
function rulesOf(text) {
  const rules = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      current = { heading: line.slice(3).trim(), lines: [line] };
      rules.push(current);
    } else if (current) current.lines.push(line);
  }
  return rules.map((rule) => ({ heading: rule.heading, bytes: Buffer.byteLength(`${rule.lines.join("\n")}\n`) }));
}

function hasPathsList(text) {
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") return false;
  const close = lines.indexOf("---", 1);
  if (close < 0) return false;
  const front = lines.slice(1, close);
  const at = front.findIndex((line) => /^paths:\s*(\[.*\S.*\])?\s*$/.test(line));
  if (at < 0) return false;
  if (/^paths:\s*\[.*\S.*\]\s*$/.test(front[at])) return true;
  return front.slice(at + 1).some((line) => /^\s+-\s+\S/.test(line));
}

function decisionRows(root) {
  const rows = [];
  if (existsSync(path.join(root, "docs/decisions.md"))) {
    for (const line of read(root, "docs/decisions.md").split("\n")) {
      const match = /^\|\s*(D\d+)\s*\|/.exec(line);
      if (match) rows.push({ id: match[1], bytes: Buffer.byteLength(`${line}\n`) });
    }
  }
  for (const file of filesUnder(root, "docs/decisions", (name) => /^D\d+.*\.md$/.test(name))) {
    const id = /\/(D\d+)[^/]*\.md$/.exec(file)[1];
    rows.push({ id, bytes: statSync(path.join(root, file)).size, file: true });
  }
  return rows;
}

function trackerRowsOver(root) {
  const over = [];
  for (const file of TRACKERS) {
    if (!existsSync(path.join(root, file))) continue;
    const lines = read(root, file).split("\n");
    let from = 0;
    let to = lines.length;
    let onlyRows = true;
    if (file.endsWith("psi-followups.md")) {
      onlyRows = false;
      const done = lines.findIndex((line) => line.startsWith("## Done"));
      if (done >= 0) to = done;
    } else {
      const start = lines.findIndex((line) => line === "## Progress");
      if (start < 0) continue;
      from = start + 1;
      const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
      if (next >= 0) to = next;
    }
    for (let i = from; i < to; i += 1) {
      if (onlyRows && !lines[i].startsWith("|")) continue;
      if (chars(lines[i]) > TRACKER_ROW) over.push(`${file}:${i + 1}`);
    }
  }
  return over;
}

/**
 * @typedef {{
 *   claude: { bytes: number, lines: number },
 *   imports: string[],
 *   loaded: number,
 *   unpathed: string[],
 *   longLines: { claude: number, rules: number, decisions: number, living: number, tableRows: Record<string, number> },
 *   bigRules: Record<string, number>,
 *   bigDecisions: Record<string, number>,
 *   duplicateIds: string[],
 *   headingLists: Record<string, number>,
 *   neverMissing: string[],
 *   trackerRows: string[],
 *   trackersUnnamed: string[],
 *   planLines: number,
 *   uncovered: string[],
 *   staleNames: string[],
 * }} DocsCounts
 */

/** Every number the written rules are held to, read from the working tree under root. @returns {DocsCounts} */
export function docsCounts(root) {
  ignoreCache.delete(root);
  const claudeText = read(root, "CLAUDE.md");
  const imports = claudeText
    .split("\n")
    .filter((line) => /^@\S+$/.test(line))
    .map((line) => line.slice(1))
    .sort();

  const ruleDirs = ["docs/rules", ".claude/rules"];
  const claudeRules = filesUnder(root, ".claude/rules", markdown);
  const unpathed = claudeRules.filter((file) => !hasPathsList(read(root, file)));
  const loadedFiles = ["CLAUDE.md", ...imports, ...unpathed];
  const loaded = loadedFiles.reduce((sum, file) => sum + statSync(path.join(root, file)).size, 0);

  const overLong = (text, only) => text.split("\n").filter((line) => chars(line) > LONG_LINE && (!only || only(line))).length;
  const ruleLong = ruleDirs.flatMap((dir) => filesUnder(root, dir, markdown)).reduce((sum, file) => sum + overLong(read(root, file)), 0);
  const decisionFiles = [
    ...(existsSync(path.join(root, "docs/decisions.md")) ? ["docs/decisions.md"] : []),
    ...filesUnder(root, "docs/decisions", markdown),
  ];
  // Prose lines only: a decision is a table row, usually over 500 characters, held by the 4,000-byte rule (reviewed 17 November 2026).
  const decisionLong = decisionFiles.reduce((sum, file) => sum + overLong(read(root, file), (line) => !line.startsWith("|")), 0);

  let living = 0;
  const tableRows = {};
  const isKept = (file) => !file.startsWith("docs/rules/") && !file.startsWith("docs/decisions/") && file !== "docs/decisions.md";
  const docsFiles = filesUnder(root, "docs", markdown, (rel, folder) => ignored(root, rel, folder));
  for (const file of docsFiles.filter(isKept)) {
    const text = read(root, file);
    living += overLong(text, (line) => !line.startsWith("|"));
    const rows = overLong(text, (line) => line.startsWith("|"));
    if (rows) tableRows[file] = rows;
  }

  const bigRules = {};
  const headingLists = {};
  for (const file of ruleFilePaths(root)) {
    const text = read(root, file);
    for (const rule of rulesOf(text)) {
      if (rule.bytes > BIG_RULE) {
        const key = `${file}#${rule.heading}`;
        bigRules[key] = Math.max(bigRules[key] ?? 0, rule.bytes);
      }
    }
    headingLists[file] = Buffer.byteLength(
      text
        .split("\n")
        .filter((line) => line.startsWith("## "))
        .join("\n"),
    );
  }

  const rows = decisionRows(root);
  const useFiles = rows.some((row) => row.file);
  const bigDecisions = {};
  for (const row of rows) if (row.bytes > BIG_RULE && (!useFiles || row.file)) bigDecisions[row.id] = row.bytes;
  const seen = new Map();
  for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
  const duplicateIds = [...seen].filter(([, n]) => n > 1).map(([id]) => id).sort();

  const flat = claudeText.replace(/\s+/g, " ");
  const neverMissing = NEVER_SENTENCES.filter((entry) => ![entry].flat().every((phrase) => flat.includes(phrase))).map((entry) =>
    [entry].flat().join(" ... "),
  );

  const trackersUnnamed = TRACKERS.filter((file) => !claudeText.includes(path.posix.basename(file)));
  const planLines = claudeText.split("\n").filter((line) => line.includes("bloat-review-2026-11")).length;

  const uncovered = [];
  for (const file of filesUnder(root, "docs/audits", markdown)) {
    if (file.split("/").length === 3 && /\d{4}-\d{2}-\d{2}\.md$/.test(file) && !ignored(root, file)) uncovered.push(file);
  }
  const findEvidence = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.name === "evidence" && !ignored(root, child, true)) uncovered.push(`${child}/`);
      findEvidence(child);
    }
  };
  if (isDir(path.join(root, "docs/audits"))) findEvidence("docs/audits");

  return {
    claude: { bytes: Buffer.byteLength(claudeText), lines: claudeText.split("\n").length - 1 },
    imports,
    loaded,
    unpathed,
    longLines: {
      claude: overLong(claudeText),
      rules: ruleLong,
      decisions: decisionLong,
      living,
      tableRows,
    },
    bigRules,
    bigDecisions,
    duplicateIds,
    headingLists,
    neverMissing,
    trackerRows: trackerRowsOver(root),
    trackersUnnamed,
    planLines,
    uncovered: uncovered.sort(),
    staleNames: staleRuleNames(root),
  };
}

/** A list of strings, one per broken rule, each ending with what to do. */
export function docsProblems(counts, baseline) {
  const problems = [];
  const rise = (name, now, was, hint) => {
    if (now > was) problems.push(`${name} rose from ${was} to ${now}. ${hint}`);
  };
  // CLAUDE.md's whole size and the bytes loaded are reported, not held: its Storefront and Admin index grows by one line with every new
  // rule until step 2.1 moves it, and the bytes outside the index are held by src/lib/docs-budget.scan.test.ts (step 0.43).
  // Reviewed 17 November 2026: holding the whole file would fail every new rule's index line.
  if (JSON.stringify(counts.imports) !== JSON.stringify(baseline.imports)) {
    problems.push("CLAUDE.md imports a new file: it loads in every session. Move the text to docs/rules.");
  }
  for (const file of counts.unpathed) problems.push(`${file} has no paths list, so it loads in every session. Give it a paths list.`);
  if (counts.longLines.claude > 0) problems.push(`CLAUDE.md has ${counts.longLines.claude} line(s) over 500 characters. Wrap them.`);
  for (const key of ["rules", "decisions", "living"]) {
    rise(`Prose lines over 500 characters in ${key}`, counts.longLines[key], baseline.longLines[key], "Wrap them: node scripts/wrap-docs.mjs.");
  }
  for (const [file, n] of Object.entries(counts.longLines.tableRows)) {
    // A decision is a table row that is usually over 500 characters; its size is held by the 4,000-byte rule below instead.
    if (file === "docs/decisions.md") continue;
    const was = baseline.longLines.tableRows[file] ?? 0;
    rise(`Table rows over 500 characters in ${file}`, n, was, "Move the detail out of the row.");
  }
  for (const [key, bytes] of Object.entries(counts.bigRules)) {
    if (!(key in baseline.bigRules) || bytes > baseline.bigRules[key]) {
      problems.push(`The rule ${key} is ${bytes} bytes. A new rule is at most 4,000 bytes: put detail in the feature's doc or its decision.`);
    }
  }
  for (const [id, bytes] of Object.entries(counts.bigDecisions)) {
    if (!(id in baseline.bigDecisions) || bytes > baseline.bigDecisions[id]) {
      problems.push(`The decision ${id} is ${bytes} bytes. A new decision is at most 4,000 bytes: put detail in the feature's doc.`);
    }
  }
  for (const id of counts.duplicateIds) problems.push(`The decision number ${id} stands twice. Claim the next number with node scripts/claim-decision.mjs.`);
  for (const [file, bytes] of Object.entries(counts.headingLists)) {
    if (bytes > BIG_HEADINGS) problems.push(`The headings of ${file} are ${bytes} bytes, over 10,000: split this rule file.`);
  }
  for (const phrase of counts.neverMissing) {
    problems.push(`CLAUDE.md lost the sentence "${phrase}". This sentence guards an action taken without opening a file: it stays in CLAUDE.md.`);
  }
  for (const row of counts.trackerRows) problems.push(`${row} is over 300 characters: a tracker row is at most 300 characters; put detail in the step's own section.`);
  for (const file of counts.trackersUnnamed) problems.push(`CLAUDE.md does not name ${file}. Name every working plan in its shared line.`);
  if (counts.planLines !== 1) problems.push(`CLAUDE.md names the bloat review on ${counts.planLines} lines, not 1. Only the shared trackers line names it.`);
  for (const file of counts.uncovered) problems.push(`${file} is a dated report or evidence folder no ignore file covers: add it to the ignore file of its folder.`);
  for (const name of counts.staleNames) problems.push(`The rule cites a name the code no longer has (${name}): correct the rule.`);
  return problems;
}

/** The numbers that are now below the baseline: run node scripts/docs-ratchet.mjs. */
export function docsFallen(counts, baseline) {
  const fallen = [];
  const fell = (name, now, was) => {
    if (now < was) fallen.push(`${name} fell from ${was} to ${now}. Run node scripts/docs-ratchet.mjs.`);
  };
  for (const key of ["rules", "decisions", "living"]) fell(`Prose lines over 500 characters in ${key}`, counts.longLines[key], baseline.longLines[key]);
  for (const [file, was] of Object.entries(baseline.longLines.tableRows)) fell(`Table rows over 500 characters in ${file}`, counts.longLines.tableRows[file] ?? 0, was);
  for (const [key, was] of Object.entries(baseline.bigRules)) fell(`The rule ${key}`, counts.bigRules[key] ?? 0, was);
  for (const [id, was] of Object.entries(baseline.bigDecisions)) fell(`The decision ${id}`, counts.bigDecisions[id] ?? 0, was);
  return fallen;
}
