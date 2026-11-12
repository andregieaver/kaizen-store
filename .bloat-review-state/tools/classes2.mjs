import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "/home/user/kaizen-store";
const css = readFileSync(process.argv[2], "utf8");
function split(s) { let depth = 0, start = 0; const out = []; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "\\") { i++; continue; } if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { out.push(s.slice(start, i + 1)); start = i + 1; } } } return out; }
function unesc(s) { return s.replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1"); }
const blocks = split(css);
const util = blocks.filter(b => b.startsWith("@layer utilities")).join("");
const cls = new Map(); let overhead = 0; let unknown = [];
function firstClass(head) {
  // find first ".name" token in selector (escaped chars allowed)
  const m = head.match(/\.((?:\\[0-9a-fA-F]{1,6} ?|\\.|[A-Za-z0-9_\- -￿])+)/);
  return m ? unesc(m[1]) : null;
}
function visit(block) {
  const i = block.indexOf("{"); const head = block.slice(0, i).trim(); const body = block.slice(i + 1, -1);
  if (head.startsWith("@layer") || head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@container")) {
    const inner = split(body);
    if (inner.length === 0) { overhead += block.length; return; }
    overhead += head.length + 2;
    for (const b of inner) visit(b);
    return;
  }
  const name = firstClass(head);
  if (!name) { unknown.push(head.slice(0, 80)); overhead += block.length; return; }
  cls.set(name, (cls.get(name) || 0) + block.length);
}
for (const b of blocks.filter(b => b.startsWith("@layer utilities"))) visit(b);
// sources
function area(p) {
  if (p.endsWith(".sql")) return "sql";
  if (/\.(test|spec)\.tsx?$/.test(p) || p.includes("/src/test/")) return "test";
  if (p.includes("/src/app/admin/") || p.includes("/src/components/admin/")) return "admin";
  if (p.includes("/src/lib/admin-messages/") || p.includes("/src/lib/messages/")) return "messages";
  if (p.includes("/src/app/")) return "app";
  if (p.includes("/src/components/")) return "components";
  if (p.includes("/src/lib/")) return "lib";
  if (p.includes("/src/server/")) return "server";
  if (p.includes("/src/db/")) return "db";
  return "other";
}
const files = [];
function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (p === join(root, "src/data")) continue; walk(p); } else files.push(p); } }
walk(join(root, "src"));
for (const e of readdirSync(join(root, "supabase/migrations"))) if (e.endsWith(".sql")) files.push(join(root, "supabase/migrations", e));
const tok = new Map(); const text = {}; const fileOf = new Map();
for (const f of files) {
  if (/\.(woff2|bz2|ico|png)$/.test(f)) continue;
  const a = area(f); const t = readFileSync(f, "utf8"); (text[a] ||= []).push(t);
  for (const w of t.split(/[\s"'`]+/)) { if (!w || w.length > 100) continue; let s = tok.get(w); if (!s) tok.set(w, s = new Set()); s.add(a); if (!fileOf.has(w)) fileOf.set(w, f.replace(root + "/", "")); }
}
for (const a in text) text[a] = text[a].join("\n");
const out = [];
for (const [name, bytes] of cls) {
  let s = tok.get(name); let how = "token";
  if (!s) { s = new Set(); how = "substring"; for (const a in text) if (text[a].includes(name)) s.add(a); }
  out.push({ name, bytes, areas: [...s].sort(), how, sample: fileOf.get(name) || "" });
}
writeFileSync(process.argv[3], JSON.stringify(out));
const total = [...cls.values()].reduce((a, b) => a + b, 0);
console.log("util layer bytes", util.length, "classes", cls.size, "class bytes", total, "overhead", overhead, "unknown", unknown.length, unknown.slice(0, 10));
const UI = new Set(["app", "components", "lib"]);
let buckets = { adminOnly: [0, 0], nonAdminUi: [0, 0], both: [0, 0], nonUiOnly: [0, 0], none: [0, 0] };
for (const o of out) {
  const a = new Set(o.areas); const hasAdmin = a.has("admin"); const hasUi = [...a].some(x => UI.has(x));
  let k;
  if (a.size === 0) k = "none"; else if (hasAdmin && !hasUi) k = "adminOnly"; else if (!hasAdmin && hasUi) k = "nonAdminUi"; else if (hasAdmin && hasUi) k = "both"; else k = "nonUiOnly";
  o.bucket = k; buckets[k][0]++; buckets[k][1] += o.bytes;
}
console.log(buckets);
console.log("nonUiOnly:", out.filter(o => o.bucket === "nonUiOnly").map(o => `${o.name} [${o.areas}] ${o.sample}`).join("\n  "));
console.log("none:", out.filter(o => o.bucket === "none").map(o => o.name).join(" | "));
// lib-only detail
const libOnly = out.filter(o => o.bucket === "nonAdminUi" && o.areas.every(a => a === "lib" || a === "test" || a === "server" || a === "messages" || a === "db" || a === "sql"));
console.log("lib-only (no app/components/admin):", libOnly.length, libOnly.reduce((a, b) => a + b.bytes, 0));
console.log(libOnly.map(o => `${o.name} <${o.sample}>`).join("\n  "));
writeFileSync(process.argv[3], JSON.stringify(out));
