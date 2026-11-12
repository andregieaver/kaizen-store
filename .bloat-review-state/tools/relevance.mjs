// For each recent commit: how many of CLAUDE.md's index lines (through their rule in docs/rules) name a file the commit changed. Read-only.
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = "/home/user/kaizen-store";
const read = (f) => readFileSync(path.join(root, f), "utf8");
const ruleFiles = ["docs/rules/storefront.md", ...readdirSync(path.join(root, "docs/rules/admin")).filter((f) => f !== "README.md").map((f) => `docs/rules/admin/${f}`)];
const rules = [];
for (const f of ruleFiles) for (const p of read(f).split(/\n(?=## )/)) if (p.startsWith("## ")) rules.push({ f, h: p.split("\n")[0].slice(3), text: p, bytes: Buffer.byteLength(p) });
const claudeLines = read("CLAUDE.md").split("\n").filter((l) => l.startsWith("- "));

const log = execFileSync("git", ["log", "--name-only", "--format=@@%h %s"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
const commits = [];
for (const block of log.split("\n@@").map((b, i) => (i === 0 ? b.replace(/^@@/, "") : b))) {
  const [head, ...files] = block.split("\n").filter(Boolean);
  commits.push({ head, files });
}
const out = [];
for (const c of commits) {
  const src = c.files.filter((f) => f.startsWith("src/") && !/\.test\.tsx?$/.test(f));
  if (!src.length) continue;
  const hit = new Set();
  for (const r of rules) {
    for (const f of src) {
      // a rule names the file by its path, or by its path without the extension (globs such as `src/lib/tripletex*.ts` are missed)
      if (r.text.includes(f) || r.text.includes(f.replace(/\.tsx?$/, "") + "`")) {
        hit.add(r.h);
        break;
      }
    }
  }
  const touchesDocs = { claude: c.files.includes("CLAUDE.md"), decisions: c.files.includes("docs/decisions.md"), rulesDoc: c.files.some((f) => f.startsWith("docs/rules/")), anyDoc: c.files.some((f) => f.startsWith("docs/")) };
  out.push({ head: c.head.slice(0, 70), srcFiles: src.length, rules: hit.size, bytes: [...hit].reduce((a, h) => a + rules.find((r) => r.h === h).bytes, 0), ...touchesDocs });
}
const n = out.length;
const sorted = out.map((o) => o.rules).sort((a, b) => a - b);
console.log("commits with src changes:", n, "of", commits.length);
console.log("rules whose text names a changed file: median", sorted[n >> 1], "p75", sorted[Math.floor(n * 0.75)], "p90", sorted[Math.floor(n * 0.9)], "max", sorted[n - 1], "zero:", sorted.filter((x) => x === 0).length);
const b = out.map((o) => o.bytes).sort((a, b) => a - b);
console.log("bytes of those rules: median", b[n >> 1], "p90", b[Math.floor(n * 0.9)]);
console.log("index lines:", claudeLines.length, "rules:", rules.length);
console.log("commits touching CLAUDE.md:", commits.filter((c) => c.files.includes("CLAUDE.md")).length, "decisions.md:", commits.filter((c) => c.files.includes("docs/decisions.md")).length, "docs/rules:", commits.filter((c) => c.files.some((f) => f.startsWith("docs/rules/"))).length, "any docs/:", commits.filter((c) => c.files.some((f) => f.startsWith("docs/"))).length, "of", commits.length);
const srcOnly = out.map((o) => o.srcFiles).sort((a, b) => a - b);
console.log("src files changed per commit: median", srcOnly[n >> 1], "p90", srcOnly[Math.floor(n * 0.9)]);
for (const o of out.slice(0, 12)) console.log(o.srcFiles, o.rules, o.bytes, o.head);
