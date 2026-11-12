import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/postcss@8.5.32/node_modules/postcss/");
const postcss = require("postcss");
const ROOT = "/home/user/kaizen-store";
const css = readFileSync(ROOT + "/.next/static/chunks/3-w0shgm-eqtf.css", "utf8");
const root = postcss.parse(css);
const util = root.nodes.find((n) => n.type === "atrule" && n.name === "layer" && n.params === "utilities");
// class -> bytes
const bytes = new Map();
const unescape = (s) => s.replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1");
function firstClass(sel) {
  const m = sel.match(/^\.((?:\\.|[^\s.:>+~\[\],)(\\])+)/);
  return m ? unescape(m[1]) : null;
}
function walk(node, wrap) {
  for (const n of node.nodes || []) {
    if (n.type === "rule") {
      const size = n.toString().length + wrap;
      // split selectors at top-level commas
      const sels = []; let depth = 0, cur = "";
      for (const ch of n.selector) { if (ch === "(" || ch === "[") depth++; else if (ch === ")" || ch === "]") depth--; if (ch === "," && depth === 0) { sels.push(cur); cur = ""; } else cur += ch; }
      sels.push(cur);
      const classes = [...new Set(sels.map((s) => firstClass(s.trim()) ?? ("?" + s.trim().slice(0, 40))))];
      for (const c of classes) bytes.set(c, (bytes.get(c) || 0) + size / classes.length);
    } else if (n.type === "atrule") {
      walk(n, 0);
    }
  }
}
walk(util, 0);
console.log("utility classes", bytes.size, "bytes attributed", Math.round([...bytes.values()].reduce((a, b) => a + b, 0)), "layer bytes", util.toString().length);
// corpora
function files(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (p === ROOT + "/src/data") continue; files(p, out); }
    else if (/\.(ts|tsx|css|json|xml|txt|xhtml|sql|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
const all = files(ROOT + "/src");
const sql = readdirSync(ROOT + "/supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => ROOT + "/supabase/migrations/" + f);
const corpusOf = (p) => {
  const r = p.slice(ROOT.length + 1);
  if (r.startsWith("supabase/")) return "sql";
  if (/\.(test|spec)\.tsx?$/.test(r) || r.startsWith("src/test/")) return "test";
  if (r.endsWith(".css")) return "css";
  if (r.startsWith("src/app/admin/") || r.startsWith("src/components/admin/")) return "admin";
  if (r.startsWith("src/lib/admin-messages/") || r.startsWith("src/lib/messages/")) return "messages";
  if (r.startsWith("src/app/") || r.startsWith("src/components/")) return "front";
  if (r.startsWith("src/lib/")) return "lib";
  if (r.startsWith("src/server/")) return "server";
  return "other";
};
const tokens = new Map(); // corpus -> Set
const texts = new Map();
const sizes = new Map();
for (const p of [...all, ...sql]) {
  const c = corpusOf(p);
  const t = readFileSync(p, "utf8");
  sizes.set(c, (sizes.get(c) || 0) + t.length);
  if (!tokens.has(c)) { tokens.set(c, new Set()); texts.set(c, []); }
  const set = tokens.get(c);
  for (const tok of t.split(/[\s"'`]+/)) if (tok.length < 120) set.add(tok);
  texts.get(c).push(t);
}
console.log("corpus sizes", Object.fromEntries(sizes));
const corpora = [...tokens.keys()];
const where = new Map();
const joined = new Map();
for (const [cls] of bytes) {
  const hit = [];
  for (const c of corpora) if (tokens.get(c).has(cls)) hit.push(c);
  if (hit.length === 0 && !cls.startsWith("?")) {
    for (const c of corpora) {
      if (!joined.has(c)) joined.set(c, texts.get(c).join("\n"));
      if (joined.get(c).includes(cls)) hit.push(c + "~");
    }
  }
  where.set(cls, hit);
}
const byKey = new Map();
for (const [cls, hit] of where) {
  const key = hit.map((h) => h.replace("~", "")).sort().join("+") || "(none)";
  const g = byKey.get(key) || { n: 0, bytes: 0, ex: [] };
  g.n++; g.bytes += bytes.get(cls); if (g.ex.length < 12) g.ex.push(cls);
  byKey.set(key, g);
}
const rows = [...byKey].sort((a, b) => b[1].bytes - a[1].bytes);
for (const [k, g] of rows.slice(0, 45)) console.log(String(Math.round(g.bytes)).padStart(7), String(g.n).padStart(5), k, "|", g.ex.slice(0, 6).join(" "));
writeFileSync("classes.json", JSON.stringify([...where].map(([c, h]) => [c, Math.round(bytes.get(c)), h]), null, 0));
// rollups
const roll = (pred) => { let n = 0, b = 0; for (const [cls, hit] of where) { const h = hit.map((x) => x.replace("~", "")); if (pred(h)) { n++; b += bytes.get(cls); } } return [n, Math.round(b)]; };
const codeFront = ["front"]; 
console.log("admin-only (admin, maybe test/messages/css)", roll((h) => h.includes("admin") && !h.some((x) => ["front", "lib", "server", "other", "sql"].includes(x))));
console.log("no front (not in front code at all)", roll((h) => !h.includes("front")));
console.log("only test", roll((h) => h.length > 0 && h.every((x) => x === "test")));
console.log("only sql", roll((h) => h.length > 0 && h.every((x) => x === "sql")));
console.log("only test/sql/messages/css", roll((h) => h.length > 0 && h.every((x) => ["test", "sql", "messages", "css"].includes(x))));
console.log("none", roll((h) => h.length === 0));
console.log("front present", roll((h) => h.includes("front")));
