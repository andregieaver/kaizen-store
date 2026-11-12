import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/postcss@8.5.32/node_modules/postcss/");
const postcss = require("postcss");
for (const f of ["3-w0shgm-eqtf.css", "3jc9lkep25kye.css"]) {
  const css = readFileSync("/home/user/kaizen-store/.next/static/chunks/" + f, "utf8");
  const root = postcss.parse(css);
  const bodies = new Map();
  root.walkRules((r) => { const body = r.nodes.filter((n) => n.type === "decl").map((n) => n.toString()).join(";"); if (body.length < 60) return; const k = body; const e = bodies.get(k) || { n: 0, sels: [] }; e.n++; e.sels.push(r.selector.slice(0, 70)); bodies.set(k, e); });
  const d = [...bodies].filter(([, e]) => e.n > 1).map(([k, e]) => ({ waste: k.length * (e.n - 1), n: e.n, len: k.length, body: k.slice(0, 70), sels: e.sels.slice(0, 3) })).sort((a, b) => b.waste - a.waste);
  console.log("==", f, "repeated declaration bodies (>=60 bytes):", d.length, "repeat bytes", d.reduce((a, x) => a + x.waste, 0), "of", css.length);
  for (const x of d.slice(0, 10)) console.log(String(x.waste).padStart(6), "x" + x.n, x.len, x.body, "|", x.sels.join(" || "));
}
