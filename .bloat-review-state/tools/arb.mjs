import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = "/home/user/kaizen-store";
const cls = JSON.parse(readFileSync(process.argv[2], "utf8"));
const files = [];
function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (p.endsWith("src/data")) continue; walk(p); } else if (/\.(tsx?)$/.test(p) && !/\.(test|spec)\./.test(p)) files.push([p, readFileSync(p, "utf8")]); } }
walk(join(root, "src"));
const arb = cls.filter(c => /\[.+\]/.test(c.name));
let one = 0, oneB = 0, two = 0; const dist = {};
const fam = {};
for (const c of arb) {
  let n = 0; for (const [, t] of files) if (t.includes(c.name)) n++;
  c.files = n; if (n <= 1) { one++; oneB += c.bytes; } else if (n === 2) two++;
  const base = c.name.replace(/^.*:(?![^\[]*\])/, "").replace(/\[.*$/, "[]");
  (fam[base] ||= { n: 0, b: 0, ex: [] }); fam[base].n++; fam[base].b += c.bytes; if (fam[base].ex.length < 6) fam[base].ex.push(c.name);
}
console.log("arbitrary classes", arb.length, "bytes", arb.reduce((a, b) => a + b.bytes, 0), "| used in <=1 file:", one, oneB, "bytes | in 2 files:", two);
for (const [k, v] of Object.entries(fam).sort((a, b) => b[1].n - a[1].n).slice(0, 22)) console.log(String(v.n).padStart(4), String(v.b).padStart(6), k, " e.g.", v.ex.join(" "));
// near-duplicate font sizes
const sizes = arb.filter(c => /(^|:)text-\[[\d.]+(px|rem)\]/.test(c.name)).map(c => c.name);
console.log("text-[..] sizes:", sizes.join(" "));
const allFiles = cls.map(c => c);
