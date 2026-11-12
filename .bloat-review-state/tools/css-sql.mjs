import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const root = "/home/user/kaizen-store";
const cssFiles = process.argv.slice(2);
const classes = new Set();
for (const f of cssFiles) {
  const css = readFileSync(f, "utf8");
  for (const m of css.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) classes.add(m[1].replace(/\\(.)/g, "$1"));
}
const tokenize = (t, set) => { for (const m of t.matchAll(/[^\s"'`<>{}(),;=\\]+/g)) set.add(m[0]); };
const sqlTokens = new Set();
for (const f of readdirSync(path.join(root, "supabase/migrations"))) if (f.endsWith(".sql")) tokenize(readFileSync(path.join(root, "supabase/migrations", f), "utf8"), sqlTokens);
const srcTokens = new Set();
(function walk(d){ for (const e of readdirSync(d,{withFileTypes:true})) { const p = path.join(d,e.name); if (e.isDirectory()) { if (p !== path.join(root,"src/data")) walk(p); } else tokenize(readFileSync(p,"utf8"), srcTokens); } })(path.join(root,"src"));
let inSql = 0; const only = [];
for (const c of classes) { if (sqlTokens.has(c)) { inSql++; if (!srcTokens.has(c)) only.push(c); } }
console.log("css classes", classes.size, "also a token in the SQL", inSql, "in SQL but not in src", only.length, only.filter(c => !/^[0-9]+s?$/.test(c)));
