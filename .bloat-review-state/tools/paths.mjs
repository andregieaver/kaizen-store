import path from "node:path";
import { info } from "./graph.mjs";
const ROOT = "/home/user/kaizen-store";
const entry = path.resolve(ROOT, process.argv[2]);
const prev = new Map([[entry, null]]); const q = [entry];
while (q.length) { const f = q.shift(); for (const d of info(f).stat) if (!prev.has(d)) { prev.set(d, f); q.push(d); } }
const rel = (f) => path.relative(ROOT, f);
for (const t of process.argv.slice(3)) {
  const hit = [...prev.keys()].filter((f) => rel(f).includes(t));
  if (hit.length === 0) { console.log(t, ": not reachable"); continue; }
  const target = hit[0]; const chain = []; for (let f = target; f; f = prev.get(f)) chain.unshift(rel(f));
  console.log(`${t} (${hit.length} files match) <-`, chain.join("  ->  "));
}
