import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = "/home/user/kaizen-store";
const cssFiles = ["src/app/globals.css", "src/app/motion.css", "src/app/admin/admin.css", "src/app/admin/schemes/indigo.css", "src/app/admin/schemes/meadow.css"];
// gather source text (non-css, non-test) and test text separately
const code = [], tests = [];
function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (p.endsWith("src/data")) continue; walk(p); } else if (/\.(tsx?|mjs)$/.test(p)) { (/\.(test|spec)\.tsx?$/.test(p) ? tests : code).push(readFileSync(p, "utf8")); } } }
walk(join(root, "src"));
const codeText = code.join("\n"), testText = tests.join("\n");
function strip(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ""); }
const report = {};
for (const f of cssFiles) {
  const css = strip(readFileSync(join(root, f), "utf8"));
  // selectors: take text before each "{" 
  const classes = new Set(), attrs = new Set(), keyframes = new Set(), vars = new Set();
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1];
    if (/^\s*@keyframes\s+([\w-]+)/.test(sel)) { keyframes.add(sel.match(/@keyframes\s+([\w-]+)/)[1]); continue; }
    if (/^\s*@/.test(sel)) continue;
    for (const c of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) classes.add(c[1]);
    for (const a of sel.matchAll(/\[(data-[\w-]+|aria-[\w-]+)/g)) attrs.add(a[1]);
  }
  const unusedC = [], testOnlyC = [], usedC = [];
  for (const c of classes) {
    const re = new RegExp(`(?<![\\w-])${c.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![\\w-])`);
    if (re.test(codeText)) usedC.push(c); else if (re.test(testText)) testOnlyC.push(c); else unusedC.push(c);
  }
  const unusedA = [], usedA = [];
  for (const a of attrs) {
    const camel = a.replace(/^data-/, "").replace(/-([a-z])/g, (_, x) => x.toUpperCase());
    const re = new RegExp(`(?<![\\w-])${a}(?![\\w-])`);
    if (re.test(codeText) || new RegExp(`dataset\\.${camel}\\b`).test(codeText)) usedA.push(a); else unusedA.push(a);
  }
  const unusedK = [...keyframes].filter(k => !new RegExp(`(?<![\\w-])${k}(?![\\w-])`).test(css.replace(new RegExp(`@keyframes\\s+${k}\\b`, "g"), "")) && !new RegExp(`(?<![\\w-])${k}(?![\\w-])`).test(codeText));
  report[f] = { classes: classes.size, unusedC, testOnlyC, attrs: attrs.size, unusedA, keyframes: keyframes.size, unusedK };
}
for (const [f, r] of Object.entries(report)) {
  console.log(`\n${f}: ${r.classes} classes, ${r.unusedC.length} unused in code, ${r.testOnlyC.length} only in tests; ${r.attrs} data/aria attrs, ${r.unusedA.length} unused; ${r.keyframes} keyframes, ${r.unusedK.length} unused`);
  console.log("  unused classes:", r.unusedC.join(" "));
  console.log("  test-only classes:", r.testOnlyC.join(" "));
  console.log("  unused attrs:", r.unusedA.join(" "));
  console.log("  unused keyframes:", r.unusedK.join(" "));
}
