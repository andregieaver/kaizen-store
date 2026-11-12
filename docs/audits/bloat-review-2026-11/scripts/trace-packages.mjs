// node docs/audits/bloat-review-2026-11/scripts/trace-packages.mjs [out.json]: megabytes per kind of package across all traces in .next/server.
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const nextDir = path.join(root, ".next");
const out = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".nft.json")) out.push(p);
  }
}
walk(path.join(nextDir, "server"));
const sizeCache = new Map();
const size = (p) => {
  let s = sizeCache.get(p);
  if (s === undefined) {
    try { const st = fs.statSync(p); s = st.isFile() ? st.size : 0; } catch { s = 0; }
    sizeCache.set(p, s);
  }
  return s;
};
const cats = {
  taxonomy: (f) => f.includes("/src/data/product-taxonomy/"),
  sharp: (f) => /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(sharp|@img)\//.test(f) || f.includes("/@img+") || /\/sharp@/.test(f),
  chromium: (f) => f.includes("@sparticuz") ,
  playwright: (f) => f.includes("playwright-core"),
  reactdom: (f) => /node_modules\/react-dom\//.test(f),
  content: (f) => f.includes("/content/docs/") || /kaizen-store\/content\//.test(f),
  map: (f) => f.endsWith(".map"),
  chunks: (f) => f.includes("/.next/server/chunks/"),
};
const rows = [];
for (const nft of out) {
  const j = JSON.parse(fs.readFileSync(nft, "utf8"));
  const dir = path.dirname(nft);
  const files = [...new Set(j.files.map((f) => path.resolve(dir, f)))];
  const r = { nft: path.relative(nextDir, nft), total: 0, n: files.length };
  for (const k in cats) r[k] = 0;
  for (const f of files) {
    const s = size(f);
    r.total += s;
    for (const k in cats) if (cats[k](f)) r[k] += s;
  }
  rows.push(r);
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(rows));
const MB = (n) => (n / 1e6).toFixed(2);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log("nft files:", rows.length);
for (const k in cats) {
  const w = rows.filter((r) => r[k] > 0);
  console.log(k, "in", w.length, "traces; median MB where present", w.length ? MB(med(w.map((r) => r[k]))) : 0, "max", w.length ? MB(Math.max(...w.map((r) => r[k]))) : 0);
}
console.log("median total MB", MB(med(rows.map((r) => r.total))));
console.log("median without taxonomy+sharp MB", MB(med(rows.map((r) => r.total - r.taxonomy - r.sharp))));
const sorted = [...rows].sort((a, b) => b.total - a.total);
console.log("largest:"); for (const r of sorted.slice(0, 6)) console.log(" ", MB(r.total), r.nft);
console.log("smallest:"); for (const r of sorted.slice(-6)) console.log(" ", MB(r.total), r.nft, "tax", MB(r.taxonomy), "sharp", MB(r.sharp));
const no = rows.filter((r) => r.taxonomy === 0); console.log("without taxonomy:", no.map((r) => r.nft + " " + MB(r.total)).join("; "));
const pick = (s) => rows.filter((r) => r.nft.includes(s));
for (const s of ["middleware.js.nft", "api/health/route", "api/fonts/files", "api/cron/document-pdfs", "app/s/[store]/[market]/page.js.nft", "checkout/page.js.nft"]) for (const r of pick(s)) console.log(s, "=>", r.nft, "total", MB(r.total), "tax", MB(r.taxonomy), "sharp", MB(r.sharp), "chromium", MB(r.chromium), "pw", MB(r.playwright), "react-dom", MB(r.reactdom), "chunks", MB(r.chunks), "n", r.n);
