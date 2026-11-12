// Sums the traced files of each cron route from the finished build's .nft.json (read-only).
import fs from "node:fs";
import path from "node:path";
const root = "/home/user/kaizen-store/.next/server/app/api/cron";
const out = [];
for (const name of fs.readdirSync(root)) {
  const nft = path.join(root, name, "route.js.nft.json");
  if (!fs.existsSync(nft)) continue;
  const { files } = JSON.parse(fs.readFileSync(nft, "utf8"));
  let total = 0, chunks = 0, chunkBytes = 0, nm = 0, chromium = 0, data = 0, docs = 0, n = 0;
  const seen = new Set();
  for (const f of files) {
    const p = path.resolve(path.dirname(nft), f);
    if (seen.has(p)) continue; seen.add(p);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    n++; total += st.size;
    if (p.includes("/.next/server/chunks/")) { chunks++; chunkBytes += st.size; }
    if (p.includes("/node_modules/")) nm += st.size;
    if (p.includes("@sparticuz") || p.includes("playwright-core")) chromium += st.size;
    if (p.includes("/src/data/")) data += st.size;
    if (p.includes("/content/docs/")) docs += st.size;
  }
  const mb = (b) => (b / 1048576).toFixed(1);
  out.push({ name, files: n, totalMB: mb(total), serverChunks: chunks, chunksMB: mb(chunkBytes), nodeModulesMB: mb(nm), chromiumMB: mb(chromium), taxonomyDataMB: mb(data), docsMB: mb(docs) });
}
console.table(out);
