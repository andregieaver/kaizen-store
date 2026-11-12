// For a sample of features: how many places carry the rule, and how big each copy is. Read-only.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = "/home/user/kaizen-store";
const read = (f) => readFileSync(path.join(root, f), "utf8");
const claude = read("CLAUDE.md").split("\n");
const ruleFiles = ["docs/rules/storefront.md", ...readdirSync(path.join(root, "docs/rules/admin")).filter((f) => f !== "README.md").map((f) => `docs/rules/admin/${f}`)];
const rules = [];
for (const f of ruleFiles) {
  const parts = read(f).split(/\n(?=## )/);
  for (const p of parts) if (p.startsWith("## ")) rules.push({ f, h: p.split("\n")[0].slice(3), bytes: Buffer.byteLength(p), text: p });
}
const decisions = read("docs/decisions.md").split("\n");

const sample = [
  { key: "Order numbers", ds: ["D141"], doc: null, src: ["src/lib/order-numbers.ts", "src/server/order-numbers.ts"] },
  { key: "Drop shipping", ds: ["D550", "D482"], doc: "docs/drop-shipping.md", src: ["src/lib/drop-shipping.ts", "src/server/suppliers.ts"] },
  { key: "Unit price", ds: ["D160"], doc: "docs/wave-1d-unit-price.md", src: ["src/lib/unit-price.ts"] },
  { key: "Withdrawals and returns", ds: ["D153"], doc: "docs/returns.md", src: ["src/server/returns.ts"] },
  { key: "A/B tests of pages", ds: ["D148"], doc: "docs/ab-testing.md", src: ["src/lib/experiments.ts", "src/server/experiments.ts"] },
  { key: "Store features", ds: ["D178"], doc: "docs/store-features.md", src: ["src/lib/store-features.ts", "src/server/store-features.ts"] },
  { key: "Custom fields", ds: ["D118"], doc: "docs/custom-fields.md", src: ["src/lib/custom-fields.ts", "src/server/custom-fields.ts"] },
  { key: "The bonus program", ds: ["D130"], doc: "docs/bonus.md", src: ["src/lib/bonus.ts", "src/server/bonus.ts"] },
  { key: "Tripletex", ds: ["D453"], doc: "docs/tripletex.md", src: ["src/server/tripletex.ts", "src/server/tripletex-sync.ts"] },
  { key: "Support", ds: ["D216"], doc: "docs/support.md", src: [] },
  { key: "Cookie consent", ds: ["D58"], doc: null, src: ["src/lib/cookie-consent.ts"] },
  { key: "SMS marketing", ds: ["D565"], doc: "docs/sms-marketing.md", src: ["src/lib/sms.ts", "src/server/sms.ts"] },
  { key: "Combined listings", ds: ["D566"], doc: "docs/combined-listings.md", src: ["src/server/product-groups.ts"] },
  { key: "Duplicating a store", ds: ["D129"], doc: "docs/store-copy.md", src: ["src/lib/store-copy.ts", "src/server/store-copy.ts"] },
  { key: "Dual page", ds: ["D412"], doc: "docs/dual-page.md", src: ["src/lib/dual-page.ts"] },
  { key: "What a visitor loads", ds: ["D211"], doc: "docs/performance.md", src: [] },
  { key: "The docs portal", ds: ["D442"], doc: null, src: ["src/lib/docs-content.ts", "src/server/docs.ts"] },
  { key: "Environmental claims", ds: ["D552"], doc: null, src: ["src/lib/green-claims.ts", "src/server/green-claims.ts"] },
];

function headComment(file) {
  if (!existsSync(path.join(root, file))) return 0;
  const lines = read(file).split("\n");
  // bytes of all comment lines in the file
  let inBlock = false;
  let bytes = 0;
  for (const raw of lines) {
    const l = raw.trim();
    let c = false;
    if (inBlock) {
      c = true;
      if (l.includes("*/")) inBlock = false;
    } else if (l.startsWith("//")) c = true;
    else if (l.startsWith("/*")) {
      c = true;
      if (!l.includes("*/")) inBlock = true;
    }
    if (c) bytes += Buffer.byteLength(raw) + 1;
  }
  return bytes;
}

let tot = { claude: 0, rule: 0, doc: 0, dec: 0, comments: 0 };
console.log("feature | CLAUDE.md line | docs/rules section | feature doc | decisions.md rows | comments in its main files | files in src citing the D id | other docs citing the D id");
for (const s of sample) {
  const line = claude.find((l) => l.startsWith(`- ${s.key}`));
  const cb = line ? Buffer.byteLength(line) : 0;
  const rule = rules.find((r) => r.h.startsWith(s.key));
  const rb = rule ? rule.bytes : 0;
  const db = s.doc && existsSync(path.join(root, s.doc)) ? Buffer.byteLength(read(s.doc)) : 0;
  let decb = 0;
  for (const d of s.ds) for (const l of decisions) if (l.startsWith(`| ${d} |`)) decb += Buffer.byteLength(l);
  const cm = s.src.reduce((a, f) => a + headComment(f), 0);
  let srcFiles = 0;
  let docFiles = 0;
  try {
    srcFiles = execFileSync("rg", ["-l", `\\b${s.ds[0]}\\b`, "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
  } catch {}
  try {
    docFiles = execFileSync("rg", ["-l", `\\b${s.ds[0]}\\b`, "docs", "-g", "*.md"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
  } catch {}
  console.log(`${s.key} (${s.ds.join(",")}) | ${cb} | ${rb} | ${db} | ${decb} | ${cm} | ${srcFiles} | ${docFiles}`);
  tot.claude += cb;
  tot.rule += rb;
  tot.doc += db;
  tot.dec += decb;
  tot.comments += cm;
}
console.log("TOTAL", JSON.stringify(tot), "sum", Object.values(tot).reduce((a, b) => a + b, 0));
