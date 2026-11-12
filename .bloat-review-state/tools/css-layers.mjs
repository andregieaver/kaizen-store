import { readFileSync } from "node:fs";
const f = process.argv[2];
const css = readFileSync(f, "utf8");
// split top-level blocks
let depth = 0, start = 0; const blocks = [];
for (let i = 0; i < css.length; i++) {
  const c = css[i];
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { blocks.push(css.slice(start, i + 1)); start = i + 1; } }
}
const sums = {};
for (const b of blocks) {
  const head = b.slice(0, b.indexOf("{")).trim();
  let key;
  if (head.startsWith("@layer")) key = head;
  else if (head.startsWith("@")) key = head.split(/[\s(]/)[0];
  else key = "(unlayered rule)";
  sums[key] = (sums[key] || 0) + b.length;
}
console.log("total", css.length, "blocks", blocks.length);
for (const [k, v] of Object.entries(sums).sort((a, b) => b[1] - a[1])) console.log(v, k);
