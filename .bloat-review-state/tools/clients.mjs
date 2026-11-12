import path from "node:path";
import fs from "node:fs";
import { info, closure } from "./graph.mjs";
const ROOT = "/home/user/kaizen-store";
const rel = (f) => path.relative(ROOT, f);
const entry = path.resolve(ROOT, process.argv[2]);
// server graph: BFS that stops at client modules, records first parent chain
const prev = new Map([[entry, null]]); const q = [entry]; const clients = [];
while (q.length) { const f = q.shift(); const i = info(f); if (i.client && f !== entry) { clients.push(f); continue; } for (const d of i.stat) if (!prev.has(d)) { prev.set(d, f); q.push(d); } }
const loaded = JSON.parse(fs.readFileSync("/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/loaded.json", "utf8"));
const page = loaded[process.argv[3] ?? "store-home"]; const sizes = new Map(page.byModule);
console.log("client boundaries statically reachable from", process.argv[2], ":", clients.length);
let sum = 0;
for (const c of clients) {
  const cl = closure(c); // its own static client closure
  const mods = [...cl.keys()].map(rel);
  const bytes = mods.reduce((n, m) => n + (sizes.get(m) ?? 0), 0);
  const chain = []; for (let f = c; f; f = prev.get(f)) chain.unshift(path.basename(f));
  console.log(`${rel(c)} | own closure ${cl.size} modules | loaded on ${process.argv[3] ?? "store-home"}: ${sizes.has(rel(c)) ? "yes" : "no"} (${bytes} B incl. deps that loaded) | via ${chain.slice(0, -1).join(" > ")}`);
}
