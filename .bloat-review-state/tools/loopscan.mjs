// Heuristic: awaited database calls lexically inside a for/while loop body or a .map(async ...) callback. Read-only.
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/test-support|test-fixture/.test(e.name)) files.push(p);
  }
})(root);
const DB = /await\s+(?:\(\s*await\s+)?(?:db\(\)|readDb\(\)|replicaDb\(\)|tx|run|runner|database|trx)\s*\.\s*(?:execute|transaction)|await\s+typedRows?\(/;
let loops = 0, mapLoops = 0; const hits = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re = /\b(for\s*(?:await\s*)?\(|while\s*\()/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(src))) {
    // find matching ) of the header
    let i = m.index + m[0].length, depth = 1;
    for (; i < src.length && depth > 0; i++) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; }
    // skip whitespace to {
    while (/\s/.test(src[i])) i++;
    let body;
    if (src[i] === "{") {
      let j = i + 1, d = 1;
      for (; j < src.length && d > 0; j++) { if (src[j] === "{") d++; else if (src[j] === "}") d--; }
      body = src.slice(i, j);
    } else {
      const end = src.indexOf(";", i);
      body = src.slice(i, end + 1);
    }
    const dm = DB.exec(body);
    if (dm) {
      const line = src.slice(0, m.index).split("\n").length;
      const dbLine = src.slice(0, i + dm.index).split("\n").length;
      const n = (body.match(new RegExp(DB.source, "g")) || []).length;
      const key = dbLine;
      if (!seen.has(key)) { seen.add(key); loops++; hits.push({ f: path.relative(root, f), line, dbLine, n, kind: "loop" }); }
    }
  }
  const re2 = /\.(?:map|forEach)\(\s*async\s*\(/g;
  while ((m = re2.exec(src))) {
    let i = src.indexOf("=>", m.index); if (i < 0) continue; i += 2;
    while (/\s/.test(src[i])) i++;
    let body;
    if (src[i] === "{") { let j = i + 1, d = 1; for (; j < src.length && d > 0; j++) { if (src[j] === "{") d++; else if (src[j] === "}") d--; } body = src.slice(i, j); }
    else { body = src.slice(i, i + 400); }
    const dm = DB.exec(body);
    if (dm) { mapLoops++; hits.push({ f: path.relative(root, f), line: src.slice(0, m.index).split("\n").length, dbLine: src.slice(0, i + dm.index).split("\n").length, n: (body.match(new RegExp(DB.source, "g")) || []).length, kind: "map" }); }
  }
}
console.log("files", files.length, "loops with a direct awaited db call:", loops, "async map/forEach with one:", mapLoops);
const byFile = new Map();
for (const h of hits) byFile.set(h.f, (byFile.get(h.f) ?? 0) + 1);
console.log("files with at least one:", byFile.size);
console.log([...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([f, n]) => `${n} ${f}`).join("\n"));
fs.writeFileSync(process.argv[3], hits.map((h) => `${h.f}:${h.line} db@${h.dbLine} n=${h.n} ${h.kind}`).join("\n"));
