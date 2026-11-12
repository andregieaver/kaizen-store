// How much of each sampled rule's text (6-word runs) also appears in its decision row, its feature doc and its main files. Read-only.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = "/home/user/kaizen-store";
const read = (f) => readFileSync(path.join(root, f), "utf8");
const ruleFiles = ["docs/rules/storefront.md", ...readdirSync(path.join(root, "docs/rules/admin")).filter((f) => f !== "README.md").map((f) => `docs/rules/admin/${f}`)];
const rules = [];
for (const f of ruleFiles) for (const p of read(f).split(/\n(?=## )/)) if (p.startsWith("## ")) rules.push({ f, h: p.split("\n")[0].slice(3), text: p.split("\n").slice(1).join("\n") });
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
  { key: "Cookie consent", ds: ["D58"], doc: null, src: ["src/lib/cookie-consent.ts"] },
  { key: "SMS marketing", ds: ["D565"], doc: "docs/sms-marketing.md", src: ["src/lib/sms.ts", "src/server/sms.ts"] },
  { key: "Combined listings", ds: ["D566"], doc: "docs/combined-listings.md", src: ["src/server/product-groups.ts"] },
  { key: "Duplicating a store", ds: ["D129"], doc: "docs/store-copy.md", src: ["src/lib/store-copy.ts", "src/server/store-copy.ts"] },
  { key: "Dual page", ds: ["D412"], doc: "docs/dual-page.md", src: ["src/lib/dual-page.ts"] },
  { key: "The docs portal", ds: ["D442"], doc: null, src: ["src/lib/docs-content.ts", "src/server/docs.ts"] },
  { key: "Environmental claims", ds: ["D552"], doc: null, src: ["src/lib/green-claims.ts", "src/server/green-claims.ts"] },
];

const words = (t) => t.toLowerCase().replace(/[`*_()\[\]{}"'.,;:!?|<>/\\=-]+/g, " ").split(/\s+/).filter(Boolean);
const N = 5;
const shingles = (t) => {
  const w = words(t);
  const s = new Set();
  for (let i = 0; i + N <= w.length; i++) s.add(w.slice(i, i + N).join(" "));
  return s;
};
const share = (a, b) => {
  if (!a.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / a.size;
};

let sums = { dec: 0, doc: 0, src: 0, any: 0, n: 0, docN: 0 };
console.log(`feature | rule 5-word runs | also in its decision rows | also in its feature doc | also in its main files | in any of them`);
for (const s of sample) {
  const rule = rules.find((r) => r.h.startsWith(s.key));
  if (!rule) continue;
  const rs = shingles(rule.text);
  const dec = shingles(s.ds.flatMap((d) => decisions.filter((l) => l.startsWith(`| ${d} |`))).join("\n"));
  const doc = s.doc && existsSync(path.join(root, s.doc)) ? shingles(read(s.doc)) : null;
  const src = shingles(s.src.filter((f) => existsSync(path.join(root, f))).map(read).join("\n"));
  const any = new Set([...dec, ...(doc ?? []), ...src]);
  const a = share(rs, dec), b = doc ? share(rs, doc) : null, c = share(rs, src), d = share(rs, any);
  console.log(`${s.key} | ${rs.size} | ${(a * 100).toFixed(0)}% | ${b === null ? "-" : (b * 100).toFixed(0) + "%"} | ${(c * 100).toFixed(0)}% | ${(d * 100).toFixed(0)}%`);
  sums.dec += a; sums.src += c; sums.any += d; sums.n++;
  if (b !== null) { sums.doc += b; sums.docN++; }
}
console.log(`MEAN | | ${((100 * sums.dec) / sums.n).toFixed(0)}% | ${((100 * sums.doc) / sums.docN).toFixed(0)}% | ${((100 * sums.src) / sums.n).toFixed(0)}% | ${((100 * sums.any) / sums.n).toFixed(0)}%`);
