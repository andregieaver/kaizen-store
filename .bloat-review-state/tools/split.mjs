import { readFileSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/postcss@8.5.32/node_modules/postcss/");
const postcss = require("postcss");
const ROOT = "/home/user/kaizen-store";
const css = readFileSync(ROOT + "/.next/static/chunks/3-w0shgm-eqtf.css", "utf8");
const adminCss = readFileSync(ROOT + "/.next/static/chunks/3jc9lkep25kye.css", "utf8");
const classes = new Map(JSON.parse(readFileSync("classes.json", "utf8")).map(([c, b, h]) => [c, h.map((x) => x.replace("~", ""))]));
const sz = (s) => `${s.length} raw / ${gzipSync(s, { level: 9 }).length} gz / ${brotliCompressSync(s).length} br`;
console.log("global:", sz(css)); console.log("admin sheet:", sz(adminCss));
const unescape = (s) => s.replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1");
const firstClass = (sel) => { const m = sel.match(/^\.((?:\\.|[^\s.:>+~\[\],)(\\])+)/); return m ? unescape(m[1]) : null; };
const splitSel = (selector) => { const sels = []; let depth = 0, cur = ""; for (const ch of selector) { if (ch === "(" || ch === "[") depth++; else if (ch === ")" || ch === "]") depth--; if (ch === "," && depth === 0) { sels.push(cur); cur = ""; } else cur += ch; } sels.push(cur); return sels; };
const adminOnly = (h) => h.includes("admin") && !h.some((x) => ["front", "lib", "server", "other", "sql"].includes(x));
const notFront = (h) => !h.includes("front") && !h.includes("lib") && h.length > 0; // admin/test/messages/server/css only
function strip(pred) {
  const root = postcss.parse(css);
  let removed = 0, n = 0;
  root.walkRules((rule) => {
    let p = rule.parent; let inUtil = false;
    while (p) { if (p.type === "atrule" && p.name === "layer" && p.params === "utilities") inUtil = true; p = p.parent; }
    if (!inUtil) return;
    const sels = splitSel(rule.selector);
    const keep = sels.filter((s) => { const c = firstClass(s.trim()); if (!c) return true; const h = classes.get(c); return !(h && pred(h)); });
    if (keep.length === 0) { removed += rule.toString().length; n++; rule.remove(); } else if (keep.length < sels.length) rule.selector = keep.join(",");
  });
  // drop empty at-rules
  let again = true; while (again) { again = false; root.walkAtRules((a) => { if (a.nodes && a.nodes.length === 0) { a.remove(); again = true; } }); }
  return { out: root.toString(), removed, n, root };
}
const a = strip(adminOnly);
console.log("minus admin-only utilities:", sz(a.out), "removed rules", a.n, "bytes", a.removed);
// also drop builder-only unlayered rules
const builderRe = /data-builder|data-resize-handle|\.tiptap|data-style-marks|data-theme-canvas\]\)? /;
let b = 0, bn = 0; const builderText = [];
for (const node of [...a.root.nodes]) {
  if (node.type === "rule" && /data-builder|data-resize-handle|\.tiptap|data-style-marks/.test(node.selector)) { b += node.toString().length; bn++; builderText.push(node.toString()); node.remove(); }
  if (node.type === "atrule" && node.name === "media" && node.nodes?.every((r) => r.type === "rule" && /data-builder|data-resize-handle|\.tiptap|data-style-marks/.test(r.selector))) { b += node.toString().length; bn++; node.remove(); }
}
const out2 = a.root.toString();
console.log("minus builder-only hand-written too:", sz(out2), "removed", bn, "rules", b, "bytes");
// motion: components layer
const comp = a.root.nodes.find((n) => n.type === "atrule" && n.name === "layer" && n.params === "components");
console.log("components layer (motion.css + .button-primary):", sz(comp.toString()));
comp.remove();
console.log("minus components layer too:", sz(a.root.toString()));
// admin page total
console.log("admin page loads:", css.length + adminCss.length, "raw", gzipSync(css).length + gzipSync(adminCss).length, "gz");
