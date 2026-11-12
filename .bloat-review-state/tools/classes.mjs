// Extract class names from the utilities layer and from other rules of the built CSS; attribute each to source areas.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "/home/user/kaizen-store";
const cssFile = process.argv[2];
const css = readFileSync(cssFile, "utf8");
// top-level blocks
let depth = 0, start = 0; const blocks = [];
for (let i = 0; i < css.length; i++) { const c = css[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { blocks.push(css.slice(start, i + 1)); start = i + 1; } } }
const util = blocks.filter(b => b.startsWith("@layer utilities")).join("");
// split utilities into rules (depth 1 inside layer)
const inner = util.slice(util.indexOf("{") + 1, -1);
depth = 0; start = 0; const rules = [];
for (let i = 0; i < inner.length; i++) { const c = inner[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { rules.push(inner.slice(start, i + 1)); start = i + 1; } } }
function unesc(s) { return s.replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1"); }
const cls = new Map(); // class -> bytes
for (const r of rules) {
  const head = r.slice(0, r.indexOf("{"));
  const m = head.match(/^\.((?:\\.|[^\s,:.>~+\[\(\{])+)/);
  if (!m) { cls.set("?" + head.slice(0, 60), (cls.get("?" + head.slice(0, 60)) || 0) + r.length); continue; }
  const name = unesc(m[1]);
  cls.set(name, (cls.get(name) || 0) + r.length);
}
// tokenise sources
const areas = new Map(); // token -> Set(area)
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
function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (p === join(root, "src/data")) continue; walk(p); } else if (/\.(tsx?|mjs|js|json|css|sql|html|txt|xml|xhtml)$/.test(p)) files.push(p); } }
walk(join(root, "src"));
for (const e of readdirSync(join(root, "supabase/migrations"))) if (e.endsWith(".sql")) files.push(join(root, "supabase/migrations", e));
const bytesByArea = {};
for (const f of files) {
  const a = area(f);
  const t = readFileSync(f, "utf8");
  bytesByArea[a] = (bytesByArea[a] || 0) + t.length;
  for (const tok of t.split(/[\s"'`<>{}=,;()]+/)) {
    if (!tok || tok.length > 80) continue;
    let s = areas.get(tok); if (!s) areas.set(tok, s = new Set()); s.add(a);
    // also strip trailing punctuation variants
  }
}
const out = [];
for (const [name, bytes] of cls) {
  const s = areas.get(name);
  out.push({ name, bytes, areas: s ? [...s].sort() : [] });
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log("rules", rules.length, "classes", cls.size, "util bytes", util.length);
console.log("source bytes by area", bytesByArea);
const groups = {};
for (const o of out) { const k = o.areas.join("+") || "(none exact)"; (groups[k] ||= { n: 0, bytes: 0 }); groups[k].n++; groups[k].bytes += o.bytes; }
const sorted = Object.entries(groups).sort((a, b) => b[1].bytes - a[1].bytes);
for (const [k, v] of sorted.slice(0, 60)) console.log(v.bytes, v.n, k);
