import { readFileSync, statSync } from "node:fs";
const g = JSON.parse(readFileSync(process.argv[2],"utf8"));
const P = "/home/user/kaizen-store/";
const entry = P + process.argv[3];
const cuts = process.argv.slice(4).map(c => c.split("->").map(s => P + s.trim()));
const isCut = (a,b) => cuts.some(([x,y]) => a === x && b === y);
function closure() { const prev = new Map([[entry,null]]); const q=[entry]; while (q.length) { const n=q.shift(); const node=g[n]; if (!node) continue; for (const x of node.s) if (!prev.has(x) && !isCut(n,x)) { prev.set(x,n); q.push(x); } } return prev; }
const prev = closure();
const files = [...prev.keys()].filter(x=>!x.startsWith("pkg:"));
console.log("closure:", files.length, "files,", (files.reduce((s,f)=>s+statSync(f).size,0)/1e6).toFixed(1), "MB source");
for (const t of ["pkg:sharp", P+"src/server/product-taxonomy.ts", P+"src/server/catalog.ts", P+"src/server/seo.ts", P+"src/db/schema.ts"]) {
  if (!prev.has(t)) { console.log("  not reached:", t.replace(P,"")); continue; }
  const out=[]; for (let n=t; n; n=prev.get(n)) out.push(n.replace(P,"")); console.log("  reached:", out.reverse().join(" -> "));
}
