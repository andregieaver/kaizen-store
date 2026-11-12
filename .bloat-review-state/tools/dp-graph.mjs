// A small import graph of src/: value imports only (type-only imports skipped). Usage: node graph.mjs <pkg>  -> client files reaching <pkg>.
import fs from "node:fs";
import path from "node:path";
const root = "/home/user/kaizen-store";
const src = path.join(root, "src");
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|mjs|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p); } })(src);
const set = new Set(files);
function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(src, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, base + ".ts", base + ".tsx", base + ".mjs", base + ".js", path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (set.has(c)) return c;
  return null;
}
const info = new Map();
const importRe = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const head = text.slice(0, 300);
  const client = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head);
  const serverOnly = /import\s+["']server-only["']/.test(text); const useServer = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(head);
  const stat = [], dyn = [], pk = new Set(), dynPk = new Set();
  let m;
  importRe.lastIndex = 0;
  while ((m = importRe.exec(text))) {
    if (m[4]) {
      if (m[2]) continue; // import type
      // all-inline-type named imports: import { type A, type B } from
      const names = m[3].trim();
      if (/^\{[^}]*\}$/.test(names)) { const parts = names.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean); if (parts.length && parts.every(p => p.startsWith("type "))) continue; }
      const r = resolve(f, m[4]); if (r) stat.push(r); else if (!m[4].startsWith(".") && !m[4].startsWith("@/")) pk.add(m[4]);
    } else if (m[5]) { const r = resolve(f, m[5]); if (r) stat.push(r); else if (!m[5].startsWith(".") && !m[5].startsWith("@/")) pk.add(m[5]); }
    else { const s = m[6] || m[7]; const r = resolve(f, s); if (r) dyn.push(r); else if (!s.startsWith(".") && !s.startsWith("@/")) dynPk.add(s); }
  }
  info.set(f, { client, serverOnly, useServer, stat, dyn, pk, dynPk, size: text.length });
}
const pkg = process.argv[2];
const matches = (s) => s === pkg || s.startsWith(pkg + "/");
// BFS from each client file through static imports (dynamic edges optional via flag)
const followDyn = process.argv.includes("--dyn");
const rel = (p) => path.relative(root, p);
const results = [];
for (const [f, i] of info) {
  if (!i.client) continue;
  const prev = new Map([[f, null]]); const q = [f]; let hit = null;
  while (q.length && !hit) {
    const cur = q.shift(); const ci = info.get(cur);
    if ([...ci.pk].some(matches) || (followDyn && [...ci.dynPk].some(matches))) { hit = cur; break; }
    for (const n of [...ci.stat, ...(followDyn ? ci.dyn : [])]) if (!prev.has(n) && !info.get(n).useServer && !info.get(n).serverOnly) { prev.set(n, cur); q.push(n); }
  }
  if (hit) { const chain = []; for (let c = hit; c; c = prev.get(c)) chain.unshift(rel(c)); results.push(chain); }
}
console.log("client entry files reaching", pkg, "statically:", results.length);
const byLeaf = {};
for (const c of results) { const k = c[c.length - 1]; (byLeaf[k] ||= []).push(c); }
for (const [k, v] of Object.entries(byLeaf).sort((a, b) => b[1].length - a[1].length).slice(0, 25)) { console.log(v.length, k); const s = v.sort((a,b)=>a.length-b.length)[0]; console.log("     e.g. " + s.join(" -> ")); }
