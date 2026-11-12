import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const ROOT = "/home/user/kaizen-store";
const cssFiles = ["src/app/globals.css", "src/app/motion.css", "src/app/admin/admin.css", "src/app/admin/schemes/meadow.css", "src/app/admin/schemes/indigo.css"];
function files(dir, out = []) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) { if (p === ROOT + "/src/data") continue; files(p, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; }
const all = files(ROOT + "/src");
const code = all.filter((p) => !/\.(test|spec)\.tsx?$/.test(p) && !p.includes("/src/test/"));
const tests = all.filter((p) => /\.(test|spec)\.tsx?$/.test(p) || p.includes("/src/test/"));
const codeText = code.map((p) => readFileSync(p, "utf8")).join("\n");
const testText = tests.map((p) => readFileSync(p, "utf8")).join("\n");
const report = {};
for (const f of cssFiles) {
  const raw = readFileSync(ROOT + "/" + f, "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  // selectors only: text before each '{'
  const sels = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]).filter((s) => !/^\s*@(keyframes|property|theme|font-face)/.test(s));
  const selText = sels.join("\n");
  const classes = [...new Set([...selText.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1]))].filter((c) => !/^\d/.test(c));
  const datas = [...new Set([...selText.matchAll(/\[(data-[\w-]+)/g)].map((m) => m[1]))];
  const keyframes = [...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))];
  const unusedC = [], dynC = [], testOnlyC = [];
  for (const c of classes) {
    const re = new RegExp("(^|[^\\w-])" + c.replace(/[-]/g, "\\-") + "($|[^\\w-])");
    if (re.test(codeText)) continue;
    // dynamic: prefix up to last dash followed by ${ or +
    const parts = c.split("-"); let dyn = false;
    for (let i = parts.length - 1; i >= 1 && !dyn; i--) { const pre = parts.slice(0, i).join("-") + "-"; if (codeText.includes(pre + "${") || codeText.includes(pre + '" +') || codeText.includes(pre + "' +") || codeText.includes("`" + pre + "`")) dyn = pre; }
    if (dyn) dynC.push(c + " (via " + dyn + ")"); else if (re.test(testText)) testOnlyC.push(c); else unusedC.push(c);
  }
  const unusedD = [];
  for (const d of datas) { const camel = d.replace(/^data-/, "").replace(/-([a-z])/g, (_, x) => x.toUpperCase()); if (!codeText.includes(d) && !codeText.includes("dataset." + camel)) unusedD.push(d); }
  const unusedK = keyframes.filter((k) => (css.match(new RegExp("\\b" + k + "\\b", "g")) || []).length < 2 && !codeText.includes(k));
  report[f] = { classes: classes.length, unused: unusedC, testOnly: testOnlyC, dynamic: dynC, dataAttrs: datas.length, unusedData: unusedD, keyframes: keyframes.length, unusedKeyframes: unusedK };
}
for (const [f, r] of Object.entries(report)) {
  console.log("==", f, "classes", r.classes, "unused", r.unused.length, "test-only", r.testOnly.length, "dynamic", r.dynamic.length, "| data attrs", r.dataAttrs, "unused", r.unusedData.length, "| keyframes", r.keyframes, "unused", r.unusedKeyframes.length);
  console.log("  unused classes:", r.unused.join(" "));
  console.log("  test-only:", r.testOnly.join(" "));
  console.log("  dynamic:", r.dynamic.join(" | "));
  console.log("  unused data attrs:", r.unusedData.join(" "));
  console.log("  unused keyframes:", r.unusedKeyframes.join(" "));
}
