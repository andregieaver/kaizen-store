import { readFileSync, statSync } from "node:fs";
import path from "node:path";
const f = process.argv[2];
const j = JSON.parse(readFileSync(f,"utf8"));
const dir = path.dirname(f);
const groups = new Map();
let total = 0;
for (const rel of j.files) {
  const abs = path.resolve(dir, rel);
  let s = 0; try { s = statSync(abs).size; } catch {}
  total += s;
  let key;
  const m = abs.match(/node_modules\/\.pnpm\/([^/]+)\//);
  if (m) key = "nm:" + m[1].replace(/_.*$/, "");
  else if (abs.includes(".next/server/chunks")) key = "chunks";
  else if (abs.includes(".next/node_modules")) key = ".next/node_modules";
  else if (abs.includes(".next/")) key = ".next/other";
  else key = path.relative("/home/user/kaizen-store", abs).split("/").slice(0,3).join("/");
  groups.set(key, (groups.get(key) ?? 0) + s);
}
console.log(f, "files", j.files.length, "total MB", (total/1e6).toFixed(1));
for (const [k,v] of [...groups.entries()].sort((a,b)=>b[1]-a[1]).slice(0, Number(process.argv[3] ?? 25))) console.log((v/1e6).toFixed(2), k);
