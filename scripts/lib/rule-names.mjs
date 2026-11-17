// The code names the written rules cite that the code does not have (bloat review step 0.41, src/lib/docs-budget.scan.test.ts).
// Spans between backticks are checked: a path, a function name written with (), a component or type name in PascalCase, an SQL
// name and a constant. Plain Node, built-ins only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs", ".css", ".sql", ".json", ".php"]);
const MAX_BYTES = 2_000_000;
const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_ROOTS = ["src", "scripts", "e2e", "wordpress-plugin"];

function addWords(set, file) {
  if (statSync(file).size >= MAX_BYTES) return;
  for (const match of readFileSync(file, "utf8").matchAll(/[A-Za-z_$][\w$]*/g)) set.add(match[0]);
}

function walk(dir, set) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, set);
    } else if (entry.isFile() && CODE_EXT.has(path.extname(entry.name))) addWords(set, full);
  }
}

function vocabulary(root) {
  const set = new Set();
  for (const dir of CODE_ROOTS) {
    const full = path.join(root, dir);
    if (existsSync(full)) walk(full, set);
  }
  const migrations = path.join(root, "supabase", "migrations");
  if (existsSync(migrations)) {
    for (const entry of readdirSync(migrations, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".sql")) addWords(set, path.join(migrations, entry.name));
    }
  }
  const pkg = path.join(root, "package.json");
  if (existsSync(pkg)) addWords(set, pkg);
  return set;
}

function mdFilesUnder(root, rel) {
  const out = [];
  const dir = path.join(root, rel);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isDirectory()) out.push(...mdFilesUnder(root, `${rel}/${entry.name}`));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(`${rel}/${entry.name}`);
  }
  return out;
}

function ruleFiles(root) {
  const files = ["CLAUDE.md", ...mdFilesUnder(root, "docs/rules"), ...mdFilesUnder(root, ".claude/rules")];
  return files.filter((file) => existsSync(path.join(root, file)));
}

/** Spans the rules may cite although no file holds them yet, each with its reason. */
export const NAME_EXCEPTIONS = {
  "public/kaizen/docs/": "The docs portal's pictures folder (src/lib/docs-markdown.ts); it exists once the first picture is added.",
};

const PATH_SPAN = /^(src|docs|scripts|e2e|supabase|content|public|wordpress-plugin|\.github|\.claude)\/[^\s`]+$/;

/** True when a path-like span names a file or folder that exists under root. */
function pathExists(root, span) {
  let rel = span.replace(/#[^/]*$/, "");
  rel = rel.replace(/:\d+(?:-\d+)?$/, "");
  rel = rel.replace(/[.,;:)]+$/, "");
  return existsSync(path.join(root, rel));
}

/** The cited names the code does not have, as sorted strings 'file: name'. */
export function staleRuleNames(root) {
  const words = vocabulary(root);
  const stale = new Set();
  for (const file of ruleFiles(root)) {
    const text = readFileSync(path.join(root, file), "utf8");
    for (const span of text.matchAll(/`([^`\n]+)`/g)) {
      const name = span[1];
      if (Object.hasOwn(NAME_EXCEPTIONS, name)) continue;
      if (PATH_SPAN.test(name) && !/[*{}<…]/.test(name)) {
        if (!pathExists(root, name)) stale.add(`${file}: ${name}`);
        continue;
      }
      const fn = /^(?:[\w$]+\.)*([A-Za-z_$][\w$]*)\(\)$/.exec(name);
      if (fn) {
        if (!words.has(fn[1])) stale.add(`${file}: ${name}`);
        continue;
      }
      if (/^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+$/.test(name)) {
        if (!words.has(name)) stale.add(`${file}: ${name}`);
        continue;
      }
      const sql = /^commerce\.([a-z_][a-z0-9_]*)$/.exec(name) ?? /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/.exec(name);
      if (sql) {
        if (!words.has(sql[sql.length - 1])) stale.add(`${file}: ${name}`);
        continue;
      }
      if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(name) && !words.has(name)) stale.add(`${file}: ${name}`);
    }
  }
  return [...stale].sort();
}
