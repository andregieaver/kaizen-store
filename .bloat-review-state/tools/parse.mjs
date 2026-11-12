import fs from "node:fs";
export function parse(file) {
  const buf = Buffer.from(fs.readFileSync(file, "utf8"), "utf8");
  const rows = []; let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i); if (colon < 0) break;
    const id = buf.slice(i, colon).toString();
    const tag = String.fromCharCode(buf[colon + 1]);
    if (tag === "T") {
      const comma = buf.indexOf(0x2c, colon); const len = parseInt(buf.slice(colon + 2, comma).toString(), 16);
      const text = buf.slice(comma + 1, comma + 1 + len).toString();
      rows.push({ id, tag: "T", text, len: len }); i = comma + 1 + len;
    } else {
      let nl = buf.indexOf(0x0a, colon); if (nl < 0) nl = buf.length;
      const text = buf.slice(colon + 1, nl).toString();
      rows.push({ id, tag: /[A-Z]/.test(tag) && tag !== "T" ? tag : "J", text, len: nl - i }); i = nl + 1;
    }
  }
  return rows;
}
if ((process.argv[1] ?? "").endsWith("parse.mjs")) {
  const rows = parse(process.argv[2]);
  const by = new Map(); for (const r of rows) by.set(r.id, (by.get(r.id) ?? []).concat(r));
  const refs = (t) => [...t.matchAll(/"\$(?:L|@|Q)?([0-9a-f]+)"/g)].map((m) => m[1]);
  function reach(start) { const seen = new Set(); const q = [...start]; while (q.length) { const id = q.pop(); if (seen.has(id) || !by.has(id)) continue; seen.add(id); for (const r of by.get(id)) if (r.tag !== "T") for (const x of refs(r.text)) q.push(x); } return seen; }
  const size = (set) => [...set].reduce((n, id) => n + by.get(id).reduce((m, r) => m + r.len, 0), 0);
  const total = rows.reduce((n, r) => n + r.len, 0);
  console.log("rows", rows.length, "bytes", total);
  for (const id of process.argv.slice(3)) { const r = reach([id]); console.log("from", id, "rows", r.size, "bytes", size(r)); }
  const sorted = [...rows].sort((a, b) => b.len - a.len).slice(0, 22);
  for (const r of sorted) console.log(r.len, r.id, r.tag, r.text.slice(0, 200).replace(/\n/g, " "));
}
