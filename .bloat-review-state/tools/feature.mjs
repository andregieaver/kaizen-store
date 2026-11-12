import { readFileSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/postcss@8.5.32/node_modules/postcss/");
const postcss = require("postcss");
const css = readFileSync("/home/user/kaizen-store/.next/static/chunks/3-w0shgm-eqtf.css", "utf8");
const sz = (s) => `${s.length} raw / ${gzipSync(s, { level: 9 }).length} gz / ${brotliCompressSync(s).length} br`;
const root = postcss.parse(css);
const feature = /\.kz-brand|\.kz-gallery|\.kz-lightbox|\.kz-fade|\.kz-menu|\.kz-mi|\.kz-table|\.kz-th|data-page-modal|page-modal|data-hs-|kz-brands-move/;
let b = 0; const parts = [];
for (const node of [...root.nodes]) {
  if (node.type === "atrule" && (node.name === "layer" || node.name === "property")) continue;
  const s = node.toString();
  if (feature.test(s)) { b += s.length; parts.push(s); node.remove(); }
}
const comp = root.nodes.find((n) => n.type === "atrule" && n.name === "layer" && n.params === "components");
console.log("optional feature rules (brands, gallery+lightbox, menu hover, table scroll, page modal, header stages):", sz(parts.join("")));
console.log("motion (components layer):", sz(comp.toString()));
console.log("both together:", sz(parts.join("") + comp.toString()));
