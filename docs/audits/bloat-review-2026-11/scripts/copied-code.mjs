#!/usr/bin/env node
// A plain copy-paste detector for the bloat review (own script; no outside tool).  node clones.mjs <outDir>
// Method: every non-test .ts/.tsx file of src; drop blank lines, comment lines and import lines; trim each line; slide a window
// of WINDOW lines and hash it. A window whose hash occurs in two or more places is a copy. A line is "copied" when it lies in
// any such window. Pairs of files are ranked by the windows they share; a window found in many files is a "family".
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = process.cwd();
const out = process.argv[2];
const WINDOW = 10;
const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name) && !name.endsWith(".d.ts")) acc.push(path);
  }
  return acc;
};
const files = walk(join(REPO, "src")).filter((f) => !f.includes("/src/test/"));
const byDesign = (f) => /\/lib\/(admin-messages|messages)\//.test(f) || f.endsWith("/db/schema.ts");
const rel = (f) => relative(REPO, f);

const data = new Map(); // file -> { lines: [{text, n}], total }
const windows = new Map(); // hash -> [{file, i}]
for (const file of files) {
  const raw = readFileSync(file, "utf8").split("\n");
  const kept = [];
  let inBlock = false;
  raw.forEach((line, idx) => {
    let t = line.trim();
    if (inBlock) { if (t.includes("*/")) inBlock = false; return; }
    if (t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; return; }
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("import ") || /^[)}\]];?,?$/.test(t)) return;
    kept.push({ text: t.replace(/\s+/g, " "), n: idx + 1 });
  });
  data.set(file, { lines: kept, total: raw.length });
  for (let i = 0; i + WINDOW <= kept.length; i++) {
    const text = kept.slice(i, i + WINDOW).map((l) => l.text).join("\n");
    if (text.length < 220) continue; // ten very short lines carry little
    const hash = createHash("md5").update(text).digest("base64").slice(0, 12);
    let list = windows.get(hash);
    if (!list) windows.set(hash, (list = []));
    list.push({ file, i });
  }
}

const copied = new Map(); // file -> Set(line index in kept)
const pairs = new Map(); // "a|b" -> shared windows
const families = []; // windows in 4+ files
for (const [hash, list] of windows) {
  if (list.length < 2) continue;
  const fileList = [...new Set(list.map((x) => x.file))];
  if (fileList.length < 2 && list.length < 2) continue;
  for (const { file, i } of list) {
    let set = copied.get(file);
    if (!set) copied.set(file, (set = new Set()));
    for (let k = i; k < i + WINDOW; k++) set.add(k);
  }
  if (fileList.length >= 4) families.push({ hash, files: fileList, first: list[0] });
  if (fileList.length <= 12) {
    for (let a = 0; a < fileList.length; a++) for (let b = a + 1; b < fileList.length; b++) {
      const key = fileList[a] < fileList[b] ? `${fileList[a]}|${fileList[b]}` : `${fileList[b]}|${fileList[a]}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
}

let keptAll = 0, copiedAll = 0, keptDesign = 0, copiedDesign = 0;
const perFolder = new Map();
const perFile = [];
for (const [file, { lines }] of data) {
  const c = copied.get(file)?.size ?? 0;
  const folder = rel(file).split("/").slice(0, 2).join("/") + (rel(file).startsWith("src/components/admin") ? "/admin" : "");
  const f = perFolder.get(folder) ?? { kept: 0, copied: 0 };
  f.kept += lines.length; f.copied += c;
  perFolder.set(folder, f);
  if (byDesign(file)) { keptDesign += lines.length; copiedDesign += c; } else { keptAll += lines.length; copiedAll += c; }
  if (c >= 40) perFile.push({ file: rel(file), kept: lines.length, copied: c, design: byDesign(file) });
}
// Merge families that are consecutive windows of the same block: keep one per (sorted file set).
const famBySet = new Map();
for (const fam of families) {
  const key = fam.files.slice().sort().join("|");
  const e = famBySet.get(key) ?? { files: fam.files, windows: 0, first: fam.first };
  e.windows++;
  famBySet.set(key, e);
}
const famList = [...famBySet.values()].filter((f) => !f.files.every(byDesign)).sort((a, b) => b.files.length * (b.windows + WINDOW - 1) - a.files.length * (a.windows + WINDOW - 1));
const pairList = [...pairs.entries()].map(([k, n]) => { const [a, b] = k.split("|"); return { a: rel(a), b: rel(b), windows: n, lines: n + WINDOW - 1, design: byDesign(a) && byDesign(b) }; }).sort((x, y) => y.windows - x.windows);
const sample = (first) => data.get(first.file).lines.slice(first.i, first.i + 6).map((l) => "    " + l.text.slice(0, 150)).join("\n");

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "0%");
let md = `# Copied code, measured (own scan, 11 Nov 2026)

Made by \`scripts/copied-code.mjs\`: non-test .ts and .tsx files of src; blank lines, comments, imports and lone closing brackets
dropped; a window of ${WINDOW} consecutive lines (at least 220 characters) found in two or more places is a copy. It finds exact
copies after trimming, not copies with a renamed variable, so it under-counts. See \`clones-notes.txt\`.

| Measure | Lines |
|---|---|
| Code lines scanned (catalogues and schema.ts aside) | ${keptAll} |
| ... of which lie in a copied window | ${copiedAll} (${pct(copiedAll, keptAll)}) |
| Code lines in the message catalogues and schema.ts (parallel by design) | ${keptDesign} |
| ... of which copied | ${copiedDesign} (${pct(copiedDesign, keptDesign)}) |

## By folder

| Folder | Code lines | Copied | Share |
|---|---|---|---|
${[...perFolder.entries()].sort((a, b) => b[1].copied - a[1].copied).map(([k, v]) => `| ${k} | ${v.kept} | ${v.copied} | ${pct(v.copied, v.kept)} |`).join("\n")}

## Files with the most copied lines (first 60)

${perFile.filter((f) => !f.design).sort((a, b) => b.copied - a.copied).slice(0, 60).map((f) => `- ${f.file}: ${f.copied} of ${f.kept} (${pct(f.copied, f.kept)})`).join("\n")}

## Pairs of files that share the most (first 80; catalogue pairs aside)

${pairList.filter((p) => !p.design).slice(0, 80).map((p) => `- about ${p.lines} lines: ${p.a} <-> ${p.b}`).join("\n")}

## Families: one block in four or more files (first 45)

${famList.slice(0, 45).map((f) => `- ${f.files.length} files, about ${f.windows + WINDOW - 1} lines each: ${f.files.slice(0, 6).map(rel).join(", ")}${f.files.length > 6 ? ", ..." : ""}\n${sample(f.first)}`).join("\n")}
`;
writeFileSync(join(out, "copied-code.md"), md);
writeFileSync(join(out, "copied-code.json"), JSON.stringify({ totals: { keptAll, copiedAll, keptDesign, copiedDesign }, perFolder: [...perFolder.entries()], perFile: perFile.sort((a, b) => b.copied - a.copied).slice(0, 400), pairs: pairList.slice(0, 1500), families: famList.slice(0, 300).map((f) => ({ files: f.files.map(rel), lines: f.windows + WINDOW - 1, at: `${rel(f.first.file)}:${data.get(f.first.file).lines[f.first.i].n}` })) }, null, 1));
writeFileSync(join(out, "copied-code-notes.txt"), `How copied-code.md was made (scripts/copied-code.mjs)

Exact copies only, after trimming and dropping comments, blank lines, imports and lone closing brackets: a block where one
identifier differs is not found, so the true share of near-copies is higher. A window is ${WINDOW} lines and at least 220
characters. Pairs are counted only for windows found in at most 12 files; larger sets are families. The message catalogues
(src/lib/admin-messages, src/lib/messages) and src/db/schema.ts are parallel by design and reported apart. Line numbers in
copied-code.json's "at" are real file lines of the family's first place.
`);
console.log(md.split("\n").slice(6, 30).join("\n"));
