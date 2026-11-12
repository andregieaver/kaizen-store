import { gzipSync } from "node:zlib";
const { adminTexts } = await import("@/lib/admin-text");
const size = (label, v) => { const j = JSON.stringify(v); console.log(label.padEnd(58), String(j.length).padStart(7), "bytes JSON,", String(gzipSync(j).length).padStart(6), "gzip"); return j.length; };
for (const lang of ["en", "nb"]) {
  for (const a of ["common", "setup", "shell", "assistant", "home", "products", "orders"]) size(`${lang} ${a}`, adminTexts(lang, [a]));
  size(`${lang} gate provider: common+setup+shell (layout.tsx:45)`, adminTexts(lang, ["common", "setup", "shell"]));
  size(`${lang} shell words on a store page for an owner (+assistant)`, adminTexts(lang, ["common", "setup", "shell", "assistant"]));
}
