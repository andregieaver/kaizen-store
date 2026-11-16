// Wraps the prose lines of Markdown under docs that are over 500 characters (bloat review step 0.40), with a proof that no
// word changed: each file must be identical to its original once whitespace is collapsed, or nothing is written.
//
//   node scripts/wrap-docs.mjs          wrap, then print the counts before and after
//   node scripts/wrap-docs.mjs --check  write nothing; exit 1 while a prose line is over 500 characters
//
// A prose line that has no single space outside its code spans cannot be wrapped: it is reported as unbreakable and does not fail
// the check. Headings, table rows and fenced blocks are never wrapped (src/lib/wrap-docs.test.ts).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { longLines, sameWords, wrapText } from "./lib/wrap-docs.mjs";

const root = path.join(import.meta.dirname, "..");

/** Left alone: split by another step (decisions.md), generated (shopify-parity.md) or dated records. */
export const SKIP = [
  /^docs\/decisions\.md$/,
  /^docs\/shopify-parity\.md$/,
  /^docs\/wave-10-notes\//,
  /^docs\/ab-testing-spike\//,
  /^docs\/audits\/psi-2026-[0-9-]+\.md$/,
  /^docs\/audits\/(.+\/)?evidence\//,
];

function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return walk(rel);
    return entry.name.endsWith(".md") && !SKIP.some((re) => re.test(rel)) ? [rel] : [];
  });
}

const files = walk("docs");
const isRules = (file) => file.startsWith("docs/rules/");
const texts = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));

function count(read) {
  const result = { rules: 0, other: 0, otherFiles: 0, table: 0, tableFiles: 0, unb: 0, unbFiles: 0 };
  for (const file of files) {
    const { prose, table, unbreakable } = longLines(read(file));
    result.unb += unbreakable;
    if (unbreakable > 0) result.unbFiles++;
    if (isRules(file)) result.rules += prose;
    else {
      result.other += prose;
      if (prose > 0) result.otherFiles++;
    }
    result.table += table;
    if (table > 0) result.tableFiles++;
  }
  return result;
}

const before = count((file) => texts.get(file));
const tableLine = (c) =>
  `table rows over 500 (left as they are): ${c.table} in ${c.tableFiles} files\nunbreakable (one code span, left as they are): ${c.unb} in ${c.unbFiles} files`;

if (process.argv.includes("--check")) {
  console.log(`docs/rules: ${before.rules} prose lines over 500`);
  console.log(`other docs: ${before.other} prose lines over 500 in ${before.otherFiles} files`);
  console.log(tableLine(before));
  process.exit(before.rules > 0 || before.other > 0 ? 1 : 0);
}

const wrapped = new Map();
const changed = [];
for (const file of files) {
  const text = texts.get(file);
  const next = wrapText(text);
  if (!sameWords(text, next)) changed.push(file);
  wrapped.set(file, next);
}
if (changed.length > 0) {
  for (const file of changed) console.error(`${file}: words changed`);
  process.exit(1);
}
for (const file of files) if (wrapped.get(file) !== texts.get(file)) writeFileSync(path.join(root, file), wrapped.get(file));
const after = count((file) => wrapped.get(file));
console.log(`docs/rules: ${before.rules} prose lines over 500 before, ${after.rules} after`);
console.log(`other docs: ${before.other} before, ${after.other} after in ${after.otherFiles} files`);
console.log(tableLine(after));
