import fs from "node:fs";
const s = fs.readFileSync(process.argv[2], "utf8");
// split by lines beginning with hex id + ":"
const lines = s.split(/\n(?=[0-9a-f]+:)/);
const rows = lines.map((l) => ({ id: l.slice(0, l.indexOf(":")), len: l.length, head: l.slice(0, 260).replace(/\n/g, " ") }));
rows.sort((a, b) => b.len - a.len);
console.log("rows", rows.length, "total", s.length);
for (const r of rows.slice(0, +process.argv[3] || 14)) console.log(r.len, r.head);
