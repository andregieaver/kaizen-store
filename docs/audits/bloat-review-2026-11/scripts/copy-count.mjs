#!/usr/bin/env node
// Near-copy detector for the bloat review (dimension CP). Read-only on the repo.
// node near.mjs <level 0|1|2> <outfile.json> <dir> [<dir>...]
// level 0: exact after trim; 1: strings and numbers -> LIT; 2: also every non-keyword identifier -> ID.
// Same line rules as the review's first clone scan: drop blank lines, comment lines, import lines, lone closing brackets; window of 10 lines.
// Extra filter (all levels): the window's raw text is >= 220 chars and it has >= MIN_DISTINCT distinct normalised lines,
// so ten lines of "ID: LIT," (a catalogue, a type, a props list) do not count.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const REPO = process.cwd();
const level = Number(process.argv[2]);
const outFile = process.argv[3];
const dirs = process.argv.slice(4);
const WINDOW = Number(process.env.WINDOW ?? 10);
const MIN_DISTINCT = Number(process.env.MIN_DISTINCT ?? 6);
const KW = new Set(("const let var function return if else for while do await async new typeof export default type interface extends implements class try catch finally throw switch case break continue null undefined true false in of as satisfies void this yield delete instanceof enum keyof readonly static public private protected string number boolean unknown never any object symbol bigint import from get set is infer declare namespace abstract super LIT").split(" "));
const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name) && !name.endsWith(".d.ts") && !/test-helper/.test(name)) acc.push(path);
  }
  return acc;
};
const byDesign = (f) => /\/lib\/(admin-messages|messages)\//.test(f) || f.endsWith("/db/schema.ts");
const files = dirs.flatMap((d) => walk(join(REPO, d))).filter((f) => !f.includes("/src/test/") && !byDesign(f));
const rel = (f) => relative(REPO, f);
const norm = (t) => {
  if (level === 0) return t;
  let s = t
    .replace(/"(?:[^"\\]|\\.)*"/g, "\u0001")
    .replace(/'(?:[^'\\]|\\.)*'/g, "\u0001")
    .replace(/`(?:[^`\\]|\\.)*`/g, "\u0001")
    .replace(/\b\d[\d_]*(?:\.\d+)?n?\b/g, "\u0001");
  if (level >= 2) s = s.replace(/[A-Za-z_$][\w$]*/g, (m) => (KW.has(m) ? m : "ID"));
  return s.replace(/\u0001/g, "LIT").replace(/\s+/g, " ");
};
const data = new Map();
const windows = new Map();
let keptAll = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8").split("\n");
  const kept = [];
  let inBlock = false;
  raw.forEach((line, idx) => {
    let t = line.trim();
    if (inBlock) { if (t.includes("*/")) inBlock = false; return; }
    if (t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; return; }
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("import ") || /^[)}\]];?,?$/.test(t)) return;
    t = t.replace(/\s+/g, " ");
    kept.push({ text: t, n: idx + 1, norm: norm(t) });
  });
  data.set(file, kept);
  keptAll += kept.length;
  for (let i = 0; i + WINDOW <= kept.length; i++) {
    const w = kept.slice(i, i + WINDOW);
    let rawLen = 0; const distinct = new Set();
    for (const l of w) { rawLen += l.text.length; distinct.add(l.norm); }
    if (rawLen < 220 || distinct.size < MIN_DISTINCT) continue;
    const hash = createHash("md5").update(w.map((l) => l.norm).join("\n")).digest("base64").slice(0, 14);
    let list = windows.get(hash);
    if (!list) windows.set(hash, (list = []));
    list.push({ file, i });
  }
}
// copied lines: any (>=2 places) and cross-file (>=2 files)
const copiedAny = new Map(), copiedCross = new Map();
const mark = (m, file, i) => { let s = m.get(file); if (!s) m.set(file, (s = new Set())); for (let k = i; k < i + WINDOW; k++) s.add(k); };
const multi = [];
for (const [hash, list] of windows) {
  if (list.length < 2) continue;
  const fset = new Set(list.map((x) => x.file));
  for (const { file, i } of list) { mark(copiedAny, file, i); if (fset.size >= 2) mark(copiedCross, file, i); }
  if (fset.size >= 2) multi.push({ hash, list, nfiles: fset.size });
}
const sum = (m) => [...m.values()].reduce((a, s) => a + s.size, 0);
// per top-folder
const folderOf = (f) => { const r = rel(f).split("/"); return r.slice(0, r[1] === "components" || r[1] === "app" ? 3 : 2).join("/"); };
const perFolder = new Map();
for (const [file, kept] of data) {
  const k = folderOf(file); const e = perFolder.get(k) ?? { kept: 0, any: 0, cross: 0 };
  e.kept += kept.length; e.any += copiedAny.get(file)?.size ?? 0; e.cross += copiedCross.get(file)?.size ?? 0; perFolder.set(k, e);
}
const perFile = [...data.entries()].map(([file, kept]) => ({ file: rel(file), kept: kept.length, cross: copiedCross.get(file)?.size ?? 0, any: copiedAny.get(file)?.size ?? 0 })).filter((x) => x.cross >= 30).sort((a, b) => b.cross - a.cross);
// Families: sort windows by number of files desc; greedily take one, extend it forward/backward while the next window
// (i+1 in every place) is still shared by >= 60% of the same places; then mark those places as used.
multi.sort((a, b) => b.nfiles - a.nfiles || b.list.length - a.list.length);
const used = new Set(); // file#i of window starts already in a family
const key = (file, i) => file + "#" + i;
const hashAt = new Map();
for (const [hash, list] of windows) for (const { file, i } of list) hashAt.set(key(file, i), hash);
const families = [];
for (const m of multi) {
  const places = m.list.filter((p) => !used.has(key(p.file, p.i)));
  const fset = new Set(places.map((p) => p.file));
  if (fset.size < 2) continue;
  // extend
  let start = 0, end = 0; // offsets relative to p.i
  const shared = (off) => {
    const hs = new Map();
    for (const p of places) { const h = hashAt.get(key(p.file, p.i + off)); if (h) hs.set(h, (hs.get(h) ?? 0) + 1); }
    let best = 0; for (const v of hs.values()) best = Math.max(best, v);
    return best;
  };
  while (shared(end + 1) >= Math.max(2, Math.ceil(places.length * 0.6))) end++;
  while (shared(start - 1) >= Math.max(2, Math.ceil(places.length * 0.6))) start--;
  for (const p of places) for (let o = start - WINDOW + 1; o <= end + WINDOW - 1; o++) used.add(key(p.file, p.i + o));
  const first = places[0];
  const kept = data.get(first.file);
  const from = Math.max(0, first.i + start), to = Math.min(kept.length, first.i + end + WINDOW);
  families.push({
    files: fset.size, places: places.length, lines: end - start + WINDOW,
    at: places.map((p) => `${rel(p.file)}:${data.get(p.file)[Math.max(0, p.i + start)]?.n}`),
    sample: kept.slice(from, to).map((l) => l.text.slice(0, 170)),
    sampleNorm: kept.slice(from, Math.min(to, from + 4)).map((l) => l.norm.slice(0, 120)),
  });
}
families.sort((a, b) => (b.places - 1) * b.lines - (a.places - 1) * a.lines);
// pairs by shared windows
const pairs = new Map();
for (const m of multi) {
  const fl = [...new Set(m.list.map((x) => x.file))];
  if (fl.length > 12) continue;
  for (let a = 0; a < fl.length; a++) for (let b = a + 1; b < fl.length; b++) {
    const k = fl[a] < fl[b] ? fl[a] + "|" + fl[b] : fl[b] + "|" + fl[a];
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
}
const pairList = [...pairs.entries()].map(([k, n]) => { const [a, b] = k.split("|"); return { a: rel(a), b: rel(b), windows: n }; }).sort((x, y) => y.windows - x.windows).slice(0, 400);
const out = { level, WINDOW, MIN_DISTINCT, dirs, files: files.length, keptAll, copiedAny: sum(copiedAny), copiedCross: sum(copiedCross), perFolder: [...perFolder.entries()].sort((a, b) => b[1].cross - a[1].cross), perFile: perFile.slice(0, 300), pairs: pairList, families: families.slice(0, 400), nFamilies: families.length };
writeFileSync(outFile, JSON.stringify(out, null, 1));
const pct = (a, b) => ((a / b) * 100).toFixed(2) + "%";
console.log(`level ${level} dirs ${dirs.join(",")} files ${files.length} lines ${keptAll} any ${out.copiedAny} (${pct(out.copiedAny, keptAll)}) cross-file ${out.copiedCross} (${pct(out.copiedCross, keptAll)}) families ${families.length}`);
for (const [k, v] of out.perFolder) console.log(`  ${k}: ${v.kept} lines, any ${v.any} (${pct(v.any, v.kept)}), cross ${v.cross} (${pct(v.cross, v.kept)})`);
if (level === 0) {
  console.log(`${out.copiedAny} exact copied lines`);
  console.log(`${out.copiedCross} lines copied across files`);
  console.log(`${out.copiedAny - out.copiedCross} lines copied inside one file`);
}
