import { parse } from "./parse.mjs";
const rows = parse("builder.rsc");
const r = rows.find((x) => x.id === "3a");
const j = JSON.parse(r.text);
const texts = j[3].texts;
const sizes = Object.entries(texts).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]);
console.log("areas", sizes.length, "total", JSON.stringify(texts).length);
console.log(sizes.map(([k, n]) => `${k}:${n}`).join("  "));
const b = texts.builder; if (b) { const s2 = Object.entries(b).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]).slice(0, 25); console.log("builder top keys:", s2.map(([k, n]) => `${k}:${n}`).join("  ")); }
console.log("other props:", Object.keys(j[3]).join(","));
const r13 = rows.find((x) => x.id === "13"); const j13 = JSON.parse(r13.text); console.log("row 13 texts areas:", Object.entries(j13[3].texts).map(([k, v]) => `${k}:${JSON.stringify(v).length}`).join("  "));
