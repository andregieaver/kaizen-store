#!/usr/bin/env node
// Codemod (bloat review step 2.25): moves adminText() and adminTexts() calls to the areas' modules in src/lib/admin-words.
//
//   node docs/audits/bloat-review-2026-11/scripts/admin-words-codemod.mjs <folder|file> [--write] [--tests]
//
// For every .ts and .tsx file under the folder that is not a test (with --tests, test files only):
//   adminText(lang, "orders")          -> ORDERS_WORDS[lang]
//   adminTexts(lang, ["a", "b"])       -> areaTexts(lang, { a: A_WORDS, b: B_WORDS })
//   <AdminAreas areas={["a"]}>         -> <AdminAreas areas={{ a: A_WORDS }}>
// adds `import { areaTexts } from "@/lib/admin-area";` and one `import { <AREA>_WORDS } from "@/lib/admin-words/<stem>";` per area,
// sorted, after the file's last import of an `@/lib/` module, and takes adminText and adminTexts out of the file's import of
// `@/lib/admin-text` (type imports stay, as `import type`). A call it cannot match is left as it is and printed as `by hand: <file>:<line>`.
// It refuses to write a "use client" file. Without --write it only prints what it would change.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--"));
const WRITE = args.includes("--write");
const TESTS = args.includes("--tests");
if (!target) {
  console.error("usage: admin-words-codemod.mjs <folder|file> [--write] [--tests]");
  process.exit(2);
}

/** area -> { stem, constant }, from the one `export const <NAME>_WORDS` of each module. */
const MODULES = new Map();
const WORDS_DIR = join(ROOT, "src/lib/admin-words");
for (const name of readdirSync(WORDS_DIR).filter((file) => file.endsWith(".ts"))) {
  const constant = /export const (\w+_WORDS)\b/.exec(readFileSync(join(WORDS_DIR, name), "utf8"))?.[1];
  if (!constant) continue;
  const area = constant
    .slice(0, -"_WORDS".length)
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  MODULES.set(area, { stem: name.slice(0, -3), constant });
}

const isTest = (file) => /\.test\.tsx?$/.test(file);
function walk(path, found = []) {
  if (statSync(path).isFile()) {
    if (/\.tsx?$/.test(path)) found.push(path);
    return found;
  }
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    walk(join(path, name), found);
  }
  return found;
}

const LANG = String.raw`((?:[^(),]|\([^()]*\))+?)`;
const ONE = new RegExp(String.raw`\badminText\(\s*${LANG}\s*,\s*"(\w+)"\s*\)`, "g");
const MANY = new RegExp(String.raw`\badminTexts\(\s*${LANG}\s*,\s*\[\s*((?:"\w+"\s*,?\s*)*)\]\s*\)`, "g");
const LEFT = /(?<![\w$])adminTexts?\(/g;

/** The text with comments blanked out (strings are left: a `//` inside a string is rare in these files and only hides a use). */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const rel = (file) => relative(ROOT, file).replaceAll("\\", "/");

let changed = 0;
for (const file of walk(join(ROOT, target))) {
  if (isTest(file) !== TESTS) continue;
  const before = readFileSync(file, "utf8");
  if (!/\badminTexts?\(|<AdminAreas\s+areas=\{\[/.test(before)) continue;
  if (rel(file) === "src/lib/admin-text.ts") continue;
  const used = new Set();
  let many = false;
  let text = before.replace(ONE, (whole, lang, area) => {
    const words = MODULES.get(area);
    if (!words) return whole;
    used.add(area);
    return `${words.constant}[${lang.trim()}]`;
  });
  text = text.replace(MANY, (whole, lang, list) => {
    const areas = [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    if (areas.length === 0 || areas.some((area) => !MODULES.has(area))) return whole;
    for (const area of areas) used.add(area);
    many = true;
    return `areaTexts(${lang.trim()}, { ${areas.map((area) => `${area}: ${MODULES.get(area).constant}`).join(", ")} })`;
  });

  // <AdminAreas areas={["a", "b"]}> hands the modules, not names: <AdminAreas areas={{ a: A_WORDS, b: B_WORDS }}>.
  text = text.replace(/<AdminAreas(\s+)areas=\{\[\s*((?:"\w+"\s*,?\s*)*)\]\}/g, (whole, space, list) => {
    const areas = [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    if (areas.length === 0 || areas.some((area) => !MODULES.has(area))) return whole;
    for (const area of areas) used.add(area);
    return `<AdminAreas${space}areas={{ ${areas.map((area) => `${area}: ${MODULES.get(area).constant}`).join(", ")} }}`;
  });

  const plain = code(text);
  const left = [...plain.matchAll(LEFT)].filter((m) => !/function\s+$/.test(plain.slice(Math.max(0, m.index - 20), m.index)));
  for (const m of left) console.log(`by hand: ${rel(file)}:${lineOf(text, m.index)}`);
  if (text === before) continue;

  // Imports: only constants the code (not a comment) now reads, and none the file imports already.
  const imports = [];
  for (const area of [...used].sort((a, b) => MODULES.get(a).stem.localeCompare(MODULES.get(b).stem))) {
    const { stem, constant } = MODULES.get(area);
    if (!new RegExp(`\\b${constant}\\b`).test(plain)) continue;
    if (new RegExp(`import\\s*\\{[^}]*\\b${constant}\\b[^}]*\\}\\s*from`).test(text)) continue;
    imports.push(`import { ${constant} } from "@/lib/admin-words/${stem}";`);
  }
  if (many && /\bareaTexts\(/.test(plain) && !/import\s*\{[^}]*\bareaTexts\b[^}]*\}\s*from/.test(text)) imports.unshift('import { areaTexts } from "@/lib/admin-area";');

  // adminText and adminTexts leave the import of the registry once no call is left.
  const stillOne = left.some((m) => plain.slice(m.index, m.index + 10) === "adminText(");
  const stillMany = left.some((m) => plain.slice(m.index, m.index + 11) === "adminTexts(");
  text = text.replace(/^import\s*(type\s+)?\{([^}]*)\}\s*from\s*"((?:@\/lib|\.)\/admin-text)";[^\S\n]*\n/m, (whole, typeOnly, names, from) => {
    if (typeOnly) return whole;
    const kept = names
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => !(name === "adminText" && !stillOne) && !(name === "adminTexts" && !stillMany));
    if (kept.length === 0) return "";
    if (kept.every((name) => name.startsWith("type "))) return `import type { ${kept.map((name) => name.slice(5)).join(", ")} } from "${from}";\n`;
    return `import { ${kept.join(", ")} } from "${from}";\n`;
  });

  if (imports.length > 0) {
    const statements = [...text.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["'];?[^\S\n]*$|^import\s+["'][^"']+["'];?[^\S\n]*$/gm)];
    const lib = statements.filter((m) => m[1]?.startsWith("@/lib/"));
    const after = (lib.length > 0 ? lib : statements).at(-1);
    const at = after ? after.index + after[0].length : 0;
    const block = imports.join("\n");
    text = after ? `${text.slice(0, at)}\n${block}${text.slice(at)}` : `${block}\n${text}`;
  }

  if (/["']use client["']/.test(before.slice(0, 300))) {
    console.log(`refused (use client): ${rel(file)}`);
    continue;
  }
  changed += 1;
  if (WRITE) writeFileSync(file, text);
  else console.log(`would change: ${rel(file)} (${[...used].join(", ")})`);
}
console.log(`${WRITE ? "changed" : "would change"} ${changed} file(s)`);
