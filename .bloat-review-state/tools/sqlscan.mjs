// Scans src for sql`...` template literals and reports patterns. Read-only.
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/test-support|test-fixture/.test(e.name)) files.push(p);
  }
})(root);
const out = { statements: 0, files: files.length, pagesDoc: [], presetDoc: [], noLimitList: 0 };
const docs = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  // crude: find sql` ... ` blocks (not nested-aware beyond ${...} depth)
  let i = 0;
  while ((i = src.indexOf("sql`", i)) !== -1) {
    let j = i + 4, depth = 0;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "\\") { j++; continue; }
      if (c === "$" && src[j + 1] === "{") { depth++; j++; continue; }
      if (c === "}" && depth > 0) { depth--; continue; }
      if (c === "`" && depth === 0) break;
    }
    const body = src.slice(i + 4, j);
    const line = src.slice(0, i).split("\n").length;
    i = j + 1;
    if (!/^\s*(select|with|insert|update|delete)\b/i.test(body)) continue;
    out.statements++;
    docs.push({ f: path.relative(root, f), line, body });
  }
}
const sel = docs.filter((d) => /^\s*(select|with)\b/i.test(d.body));
const whole = (re) => sel.filter((d) => re.test(d.body));
// whole JSON documents of pages
const pagesDoc = sel.filter((d) => /from commerce\.pages\b/i.test(d.body) && /(^|[\s,(])(p\.|pg\.|pages\.)?(published|draft)\s*(,|\n|\s+from|\s+as\b)/i.test(d.body.replace(/published_at|first_published_at/g, "")));
const presetDoc = sel.filter((d) => /from commerce\.design_presets\b/i.test(d.body) && /(^|[\s,(])(p\.|d\.)?(snapshot|draft)\s*(,|\n|\s+from|\s+as\b)/i.test(d.body));
console.log("files", out.files, "sql statements", out.statements, "selects", sel.length);
console.log("pages whole-document selects:", pagesDoc.length);
for (const d of pagesDoc) console.log("  ", d.f + ":" + d.line);
console.log("design_presets whole snapshot/draft selects:", presetDoc.length);
for (const d of presetDoc) console.log("  ", d.f + ":" + d.line);
