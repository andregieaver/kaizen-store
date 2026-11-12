// Systematic twin scan: pairs of non-test files that share many identical code lines (order-free).
// node docs/audits/bloat-review-2026-11/scripts/twin-count.mjs [rows to list]; run from the repository root; the last line is '<n> twin pairs'.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = 'src';
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root).filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !f.includes('/admin-messages/') && !f.includes('/lib/messages/'));
const sig = new Map(); const count = [];
files.forEach((f, i) => {
  const set = new Set();
  for (const l of readFileSync(f, 'utf8').split('\n')) { const t = l.trim(); if (t.length < 30 || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('import ') || t.startsWith('} from')) continue; set.add(t); }
  count[i] = set.size;
  for (const t of set) { let a = sig.get(t); if (!a) sig.set(t, (a = [])); a.push(i); }
});
const pair = new Map();
for (const a of sig.values()) { if (a.length < 2 || a.length > 8) continue; for (let x = 0; x < a.length; x++) for (let y = x + 1; y < a.length; y++) { const k = a[x] * 100000 + a[y]; pair.set(k, (pair.get(k) ?? 0) + 1); } }
const rows = [];
for (const [k, n] of pair) { const x = Math.floor(k / 100000), y = k % 100000; const small = Math.min(count[x], count[y]); if (n >= 20 && n / small >= 0.3) rows.push([n, Math.round(n / small * 100), files[x].replace('src/', ''), files[y].replace('src/', ''), count[x], count[y]]); }
rows.sort((a, b) => b[0] - a[0]);
const inTwin = new Set(); let shared = 0; for (const r of rows) { shared += r[0]; inTwin.add(r[2]); inTwin.add(r[3]); }
console.log(`files scanned ${files.length}; twin pairs (>=20 shared long lines and >=30% of the smaller file): ${rows.length}; files in a pair: ${inTwin.size}; shared lines summed over pairs: ${shared}`);
for (const r of rows.slice(0, Number(process.argv[2] ?? 70))) console.log(`${String(r[0]).padStart(4)} lines ${String(r[1]).padStart(3)}%  ${r[2]} (${r[4]})  <>  ${r[3]} (${r[5]})`);
console.log(`${rows.length} twin pairs`);
