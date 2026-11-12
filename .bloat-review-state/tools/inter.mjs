import fs from "node:fs"; import path from "node:path";
import { closure, info } from "./graph.mjs";
const ROOT = "/home/user/kaizen-store"; const rel = (f) => path.relative(ROOT, f);
const j = JSON.parse(fs.readFileSync("/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/analyze/s_store_market.json", "utf8"));
const server = new Map(j.server.map(([m, b]) => [m.replace(/\.\[json\]\.cjs$/, ""), b]));
const total = j.totals.server; const listed = [...server.values()].reduce((a, b) => a + b, 0);
console.log("route server total", total, "top-600 listed", listed);
const sum = (set) => [...set].reduce((n, f) => n + (server.get(rel(f)) ?? 0), 0);
const entries = { "page-article.tsx": "src/components/page-article.tsx", "page-block.tsx": "src/components/page-block.tsx", "page-content.ts": "src/lib/page-content.ts" };
for (const [name, e] of Object.entries(entries)) { const c = closure(path.join(ROOT, e)); console.log(name, "closure files", c.size, "| bytes among analyzer's listed server modules", sum(c.keys())); }
// per direct import of page-article: closure sizes
const pa = info(path.join(ROOT, "src/components/page-article.tsx"));
const rows = pa.stat.map((d) => { const c = closure(d); return [rel(d), c.size, sum(c.keys())]; }).sort((a, b) => b[2] - a[2]);
console.log("direct imports of page-article.tsx: file | closure files | bytes in route (listed)");
for (const r of rows) console.log(r.join(" | "));
