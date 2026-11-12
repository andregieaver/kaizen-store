// Shortest static-import path from an entry file to a target (a file path suffix or pkg:name).
import { readFileSync } from "node:fs";
const g = JSON.parse(readFileSync(process.argv[2],"utf8"));
const entry = process.argv[3], target = process.argv[4];
const withDyn = process.argv[5] === "dyn";
const start = Object.keys(g).find(k => k.endsWith(entry));
if (!start) { console.log("no entry", entry); process.exit(1); }
const prev = new Map([[start,null]]); const q=[start]; let found=null;
while (q.length) { const n = q.shift(); if (n === target || n.endsWith(target)) { found = n; break; }
  const node = g[n]; if (!node) continue;
  for (const x of [...node.s, ...(withDyn ? node.d : [])]) if (!prev.has(x)) { prev.set(x,n); q.push(x); } }
if (!found) { console.log("NOT reachable:", entry, "->", target, "(visited", prev.size, ")"); process.exit(0); }
const out=[]; for (let n=found; n; n=prev.get(n)) out.push(n.replace("/home/user/kaizen-store/","")); console.log(out.reverse().join("\n  -> "));
