import { readFileSync, statSync } from "node:fs";
const g = JSON.parse(readFileSync(process.argv[2],"utf8"));
for (const entry of process.argv.slice(3)) {
  const start = Object.keys(g).find(k => k.endsWith(entry));
  const seen = new Set([start]); const q=[start];
  while (q.length) { const n=q.pop(); const node=g[n]; if (!node) continue; for (const x of node.s) if (!seen.has(x)) { seen.add(x); q.push(x); } }
  const files = [...seen].filter(x=>!x.startsWith("pkg:"));
  const bytes = files.reduce((s,f)=>s+statSync(f).size,0);
  console.log(entry, "reaches", files.length, "source files,", (bytes/1e6).toFixed(1), "MB of source; packages:", [...seen].filter(x=>x.startsWith("pkg:")).length);
}
