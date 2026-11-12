import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/postcss@8.5.32/node_modules/postcss/");
const postcss = require("postcss");
const file = process.argv[2];
const css = readFileSync(file, "utf8");
const root = postcss.parse(css);
const groups = new Map();
const add = (k, s) => { const g = groups.get(k) || { bytes: 0, n: 0, text: [] }; g.bytes += s.length; g.n++; g.text.push(s); groups.set(k, g); };
for (const node of root.nodes) {
  const s = node.toString();
  if (node.type === "atrule" && node.name === "layer") add("@layer " + node.params, s);
  else if (node.type === "atrule") add("@" + node.name + " (top)", s);
  else add("unlayered rules", s);
}
console.log("total", css.length, "gzip", gzipSync(css).length);
for (const [k, g] of [...groups].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(String(g.bytes).padStart(8), String(gzipSync(g.text.join("")).length).padStart(7), String(g.n).padStart(5), k.slice(0, 80));
}
