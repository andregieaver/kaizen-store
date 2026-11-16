// The code names the written rules cite that the code does not have (bloat review step 0.41, src/lib/docs-budget.scan.test.ts).
// Only two kinds of span between backticks are checked: a function name written with () and a component or type name in
// PascalCase. Plain Node, built-ins only.
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

function ruleFiles(root) {
  const files = ["CLAUDE.md", "docs/rules/storefront.md"];
  const admin = path.join(root, "docs", "rules", "admin");
  if (existsSync(admin)) {
    for (const name of readdirSync(admin).sort()) if (name.endsWith(".md")) files.push(`docs/rules/admin/${name}`);
  }
  return files.filter((file) => existsSync(path.join(root, file)));
}

/** The cited names the code does not have, as sorted strings 'file: name'. */
export function staleRuleNames(root) {
  const words = vocabulary(root);
  const stale = new Set();
  for (const file of ruleFiles(root)) {
    const text = readFileSync(path.join(root, file), "utf8");
    for (const span of text.matchAll(/`([^`\n]+)`/g)) {
      const name = span[1];
      const fn = /^(?:[\w$]+\.)*([A-Za-z_$][\w$]*)\(\)$/.exec(name);
      if (fn) {
        if (!words.has(fn[1])) stale.add(`${file}: ${name}`);
      } else if (/^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+$/.test(name) && !words.has(name)) {
        stale.add(`${file}: ${name}`);
      }
    }
  }
  return [...stale].sort();
}
