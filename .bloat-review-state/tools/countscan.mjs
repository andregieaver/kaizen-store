// Heuristics over src/server: (1) selects whose rows are only counted (.length), (2) list selects with neither limit nor a key filter. Read-only.
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
let onlyCounted = []; let selects = 0, noLimit = [], withLimit = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re = /const\s+(\w+)\s*=\s*await\s+[^;]*?sql`/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    let j = m.index + m[0].length, depth = 0;
    for (; j < src.length; j++) { const c = src[j]; if (c === "\\") { j++; continue; } if (c === "$" && src[j + 1] === "{") { depth++; j++; continue; } if (c === "}" && depth > 0) { depth--; continue; } if (c === "`" && depth === 0) break; }
    const body = src.slice(m.index + m[0].length, j);
    if (!/^\s*(select|with)\b/i.test(body)) continue;
    selects++;
    const line = src.slice(0, m.index).split("\n").length;
    // uses of the variable in the rest of the enclosing ~60 lines
    const rest = src.slice(j, j + 4000);
    const uses = rest.match(new RegExp(`\\b${name}\\b(\\.\\w+)?`, "g")) || [];
    const real = uses.filter((u) => u !== name + ".length");
    if (uses.length > 0 && real.length === 0 && !/count\(/i.test(body) && !/limit\s+1\b/i.test(body) && !/for update/i.test(body)) onlyCounted.push(`${path.relative(root, f)}:${line} ${body.trim().split("\n")[0].slice(0, 110)}`);
    if (/\blimit\b/i.test(body) || /fetch first/i.test(body)) withLimit++;
    else if (!/\b(count|sum|max|min|exists|bool_or|bool_and|json_agg|jsonb_agg|array_agg|string_agg)\s*\(/i.test(body) && !/\bid\s*=\s*\$\{/.test(body) && !/=\s*any\(/i.test(body) && !/\bin\s*\(\$\{/i.test(body) && /\bfrom\s+commerce\.\w+/i.test(body) && /^const\s+(rows|\w+s)\b/.test(m[0])) noLimit.push(`${path.relative(root, f)}:${line} ${body.trim().split("\n")[0].slice(0, 110)}`);
  }
}
console.log("selects assigned to a const:", selects, "| with limit:", withLimit, "| only counted with .length:", onlyCounted.length, "| plural result, no limit, no id/any filter, no aggregate:", noLimit.length);
console.log("--- only counted"); console.log(onlyCounted.join("\n"));
fs.writeFileSync(process.argv[3], noLimit.join("\n"));
