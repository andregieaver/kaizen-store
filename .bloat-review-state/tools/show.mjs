import { parse } from "./parse.mjs";
const rows = parse(process.argv[2]);
const want = new Set(process.argv.slice(4));
const needle = process.argv[3];
for (const r of rows) if ((needle && needle !== "-" && r.text.includes(needle)) || want.has(r.id)) console.log(r.id, r.tag, r.len, "\n", r.text.slice(0, 3000), "\n");
