import { readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
global.gc?.();
const base = process.memoryUsage().heapUsed;
const kept = {};
for (const f of ["structure.json","names-en.json","names-nb.json","names-sv.json","names-da.json"]) {
  const t0 = performance.now();
  const txt = readFileSync(path.join(dir,f),"utf8");
  const t1 = performance.now();
  kept[f] = JSON.parse(txt);
  const t2 = performance.now();
  global.gc?.();
  const used = process.memoryUsage().heapUsed;
  console.log(f, "read ms", (t1-t0).toFixed(1), "parse ms", (t2-t1).toFixed(1), "heap after MB", ((used-base)/1e6).toFixed(1));
}
const s = kept["structure.json"];
console.log("structure keys", Object.keys(s));
for (const k of Object.keys(s)) { const v = s[k]; console.log(k, Array.isArray(v) ? "array "+v.length : typeof v === "object" && v ? "object "+Object.keys(v).length : v); }
const n = kept["names-en.json"];
console.log("names keys", Object.keys(n));
for (const k of Object.keys(n)) { const v = n[k]; console.log(k, Array.isArray(v) ? "array "+v.length : typeof v === "object" && v ? "object "+Object.keys(v).length : v); }
