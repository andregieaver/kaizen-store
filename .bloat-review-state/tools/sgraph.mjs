// Server-side import graph of src/: from each app entry (page/route/layout/...), static value imports to a package. Type-only imports skipped.
// node sgraph.mjs <pkg> [--chains N] [--entries regex]
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
  const head = text.slice(0, 400);
  const client = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head);
  const stat = [], dyn = [], pk = new Set(), dynPk = new Set();
  let m; importRe.lastIndex = 0;
  while ((m = importRe.exec(text))) {
    if (m[4]) {
      if (m[2]) continue;
      const names = m[3].trim();
      if (/^\{[^}]*\}$/.test(names)) { const parts = names.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean); if (parts.length && parts.every((p) => p.startsWith("type "))) continue; }
      const r = resolve(f, m[4]); if (r) stat.push(r); else if (!m[4].startsWith(".") && !m[4].startsWith("@/")) pk.add(m[4]);
    } else if (m[5]) { const r = resolve(f, m[5]); if (r) stat.push(r); else if (!m[5].startsWith(".") && !m[5].startsWith("@/")) pk.add(m[5]); }
    else { const s = m[6] || m[7]; const r = resolve(f, s); if (r) dyn.push(r); else if (!s.startsWith(".") && !s.startsWith("@/")) dynPk.add(s); }
  }
  info.set(f, { client, stat, dyn, pk, dynPk });
}
const pkg = process.argv[2];
const matches = (s) => s === pkg || s.startsWith(pkg + "/");
const rel = (p) => path.relative(root, p);
const entryRe = /\/src\/app\/.*\/(page|route|layout|default|not-found|error|loading|template)\.(tsx?|js)$|\/src\/(proxy|middleware|instrumentation)\.ts$/;
const filt = process.argv.includes("--entries") ? new RegExp(process.argv[process.argv.indexOf("--entries") + 1]) : null;
const nChains = process.argv.includes("--chains") ? +process.argv[process.argv.indexOf("--chains") + 1] : 6;
let entries = 0, hits = 0; const byLeaf = {}; const byKind = {};
for (const [f, i] of info) {
  if (!entryRe.test(f)) continue; if (filt && !filt.test(rel(f))) continue;
  entries++;
  const prev = new Map([[f, null]]); const q = [f]; let hit = null;
  while (q.length && !hit) {
    const cur = q.shift(); const ci = info.get(cur);
    if ([...ci.pk].some(matches)) { hit = cur; break; }
    // a server graph stops at client components (their code is in the SSR layer, a different bundle; still on the server, so follow them too)
    for (const n of ci.stat) if (!prev.has(n)) { prev.set(n, cur); q.push(n); }
  }
  const kind = rel(f).split("/").slice(2, 5).join("/");
  byKind[kind] ||= [0, 0]; byKind[kind][1]++;
  if (hit) { hits++; byKind[kind][0]++; const chain = []; for (let c = hit; c; c = prev.get(c)) chain.unshift(rel(c)); (byLeaf[rel(hit)] ||= []).push(chain); }
}
console.log(`entries=${entries} reaching ${pkg} by static imports=${hits}`);
for (const [k, v] of Object.entries(byLeaf).sort((a, b) => b[1].length - a[1].length).slice(0, nChains)) { console.log(v.length, k); const s = v.sort((a, b) => a.length - b.length)[0]; console.log("     shortest: " + s.join(" -> ")); }
if (process.argv.includes("--kinds")) for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1][1] - a[1][1]).slice(0, 25)) console.log(`  ${v[0]}/${v[1]}  ${k}`);
