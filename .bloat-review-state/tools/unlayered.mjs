import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/postcss@8.5.32/node_modules/postcss/");
const postcss = require("postcss");
const css = readFileSync("/home/user/kaizen-store/.next/static/chunks/3-w0shgm-eqtf.css", "utf8");
const root = postcss.parse(css);
const groups = [
  ["header overlay + stages (D80, D533)", /data-overlay|data-hs-|data-header-|\.site-header/],
  ["button hover effects (D206)", /\.kz-btn|button-hover|\.button-primary/],
  ["brands (D204-206)", /\.kz-brand/],
  ["menu hover (D207)", /\.kz-menu|\.kz-mi/],
  ["gallery + lightbox (D209)", /\.kz-gallery|\.kz-lightbox|\.kz-fade|data-ratio/],
  ["table scroll (D203)", /\.kz-table|\.kz-th/],
  ["builder canvas only", /data-builder|data-resize-handle|\.tiptap|data-style-marks/],
  ["page modal (D121)", /data-page-modal|page-modal/],
  ["carousel", /data-carousel/],
  ["rich text", /\.rich-text/],
  ["footer reveal", /footer-reveal|over-footer/],
  ["dark/light + theme roots", /:root|for-dark-colors|for-light-colors|data-color-mode/],
  ["product cards, buyer, plan switch", /product-card|data-buyer|data-plan|data-product-bar|data-default-bar/],
  ["hover timing (transition on a,button…)", /data-theme-canvas/],
];
const acc = new Map(groups.map(([n]) => [n, { b: 0, t: [] }])); acc.set("other", { b: 0, t: [] });
let total = 0;
for (const node of root.nodes) {
  if (node.type === "atrule" && node.name === "layer") continue;
  if (node.type === "atrule" && node.name === "property") continue;
  const s = node.toString(); total += s.length;
  const g = groups.find(([, re]) => re.test(s));
  const a = acc.get(g ? g[0] : "other"); a.b += s.length; a.t.push(s);
}
console.log("unlayered hand-written total", total);
for (const [n, a] of [...acc].sort((x, y) => y[1].b - x[1].b)) console.log(String(a.b).padStart(6), String(gzipSync(a.t.join("")).length).padStart(5), n);
console.log("other sample:", acc.get("other").t.slice(0, 12).map((s) => s.slice(0, 90)).join("\n   "));
