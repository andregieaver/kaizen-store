import { parse } from "./parse.mjs";
for (const f of process.argv.slice(2)) {
const rows = parse(f);
const by = new Map(); for (const r of rows) by.set(r.id, (by.get(r.id) ?? []).concat(r));
const refs = (t) => [...t.matchAll(/"\$(?:L|@|Q)?([0-9a-f]+)"/g)].map((m) => m[1]);
function reach(start) { const seen = new Set(); const q = [...start]; while (q.length) { const id = q.pop(); if (seen.has(id) || !by.has(id)) continue; seen.add(id); for (const r of by.get(id)) if (r.tag !== "T") for (const x of refs(r.text)) q.push(x); } return seen; }
const size = (ids) => [...ids].reduce((n, id) => n + by.get(id).reduce((m, r) => m + r.len, 0), 0);
const b = reach(["b"]), c = reach(["c"]);
const onlyB = [...b].filter((x) => !c.has(x)), onlyC = [...c].filter((x) => !b.has(x)), both = [...b].filter((x) => c.has(x));
const total = rows.reduce((n, r) => n + r.len, 0);
console.log(f, "total", total, "| notFound-only", size(onlyB), "| real-only", size(onlyC), "| shared", size(both), "| share notFound", (100 * size(onlyB) / total).toFixed(0) + "%");
}
