import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const root = "/home/user/kaizen-store";
const cssFiles = process.argv.slice(2);
const classes = new Map();
for (const f of cssFiles) {
  const css = readFileSync(f, "utf8");
  for (const m of css.matchAll(/\.((?:\\.|[A-Za-z_-])(?:\\.|[A-Za-z0-9_-])*)/g)) { const c = m[1].replace(/\\(.)/g, "$1"); classes.set(c, path.basename(f)); }
}
const tokenize = (t, set) => { for (const m of t.matchAll(/[^\s"'`<>{}(),;=\\]+/g)) set.add(m[0]); };
const code = new Set(), tests = new Set();
(function walk(d){ for (const e of readdirSync(d,{withFileTypes:true})) { const p = path.join(d,e.name); if (e.isDirectory()) { if (p !== path.join(root,"src/data")) walk(p); } else tokenize(readFileSync(p,"utf8"), /\.test\.tsx?$/.test(e.name) || p.includes("/fixtures/") ? tests : code); } })(path.join(root,"src"));
const onlyTests = [], nowhere = [];
for (const [c] of classes) { if (code.has(c)) continue; if (tests.has(c)) onlyTests.push(c); else nowhere.push(c); }
console.log("css class names", classes.size, "only in tests/fixtures", onlyTests.length, onlyTests.slice(0,60));
console.log("in neither (built by composition or from CSS files)", nowhere.length, nowhere.slice(0,30));
