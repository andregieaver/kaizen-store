// From a server entry (a layout), find the client components it draws (first "use client" file on each static path), then for each
// the shortest static chain inside the client graph to a package. node dp-shell.mjs <entry> <pkg>
import fs from "node:fs";
import path from "node:path";
const root = "/home/user/kaizen-store", src = path.join(root, "src");
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p); } })(src);
const set = new Set(files);
const resolve = (from, spec) => { let base; if (spec.startsWith("@/")) base = path.join(src, spec.slice(2)); else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec); else return null; for (const c of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (set.has(c)) return c; return null; };
const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const info = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8"); const head = text.slice(0, 400);
  const dir = (n) => new RegExp(`^\\s*(\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${n}["']`).test(head);
  const stat = [], pk = new Set(); let m; re.lastIndex = 0;
  while ((m = re.exec(text))) { const spec = m[4] ?? m[5]; if (m[4]) { if (m[2]) continue; const names = m[3].trim(); if (/^\{[^}]*\}$/.test(names)) { const parts = names.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean); if (parts.length && parts.every((p) => p.startsWith("type "))) continue; } } const r = resolve(f, spec); if (r) stat.push(r); else if (!spec.startsWith(".") && !spec.startsWith("@/")) pk.add(spec); }
  info.set(f, { client: dir("use client"), server: dir("use server") || /import\s+["']server-only["']/.test(text), stat, pk });
}
const entry = path.join(root, process.argv[2]); const pkg = process.argv[3];
const rel = (p) => path.relative(root, p);
// server walk to client boundaries
const boundaries = new Set(); const seen = new Set([entry]); const q = [entry];
while (q.length) { const cur = q.shift(); const ci = info.get(cur); if (ci.client) { boundaries.add(cur); continue; } for (const n of ci.stat) if (!seen.has(n)) { seen.add(n); q.push(n); } }
console.log("client components drawn from", process.argv[2] + ":", boundaries.size);
let hits = 0;
for (const b of boundaries) {
  const prev = new Map([[b, null]]); const qq = [b]; let hit = null;
  while (qq.length && !hit) { const cur = qq.shift(); const ci = info.get(cur); if ([...ci.pk].some((s) => s === pkg || s.startsWith(pkg + "/"))) { hit = cur; break; } for (const n of ci.stat) if (!prev.has(n) && !info.get(n).server) { prev.set(n, cur); qq.push(n); } }
  if (hit) { hits++; const chain = []; for (let c = hit; c; c = prev.get(c)) chain.unshift(rel(c)); console.log("  " + chain.join(" -> ")); }
}
console.log("reaching", pkg + ":", hits);
