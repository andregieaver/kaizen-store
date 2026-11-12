// For every built route entry (.next/server/app/**/page.js|route.js): the server chunks it loads (R.c lines), their total JS bytes, and which
// third-party libraries are inside them (marker strings). Prints, per library, the number of routes that load it, and size percentiles.
import fs from "node:fs";
import path from "node:path";
const root = "/home/user/kaizen-store/.next/server";
const markers = {
  "stripe SDK": "StripeSignatureVerificationError",
  "opentype.js": "Unsupported OpenType",
  "supabase-js": "supabase-js-node", "supabase auth (GoTrue)": "AuthSessionMissingError", "react-dom/server (renderToString)": "renderToStaticMarkup",
  "seek-bzip": "Bzip2Error",
  "zod": "ZodError",
  "drizzle schema (481 tables)": '"payout_reads"',
  "web-push": "WebPushError",
  "mammoth": "mammoth",
  "unpdf/pdfjs": "pdfjs",
  "simple-icons paths": "M12.017 0C5.396",
};
const cache = new Map();
function chunkInfo(c) {
  if (cache.has(c)) return cache.get(c);
  let s = ""; try { s = fs.readFileSync(path.join(root, c), "utf8"); } catch {}
  const info = { size: s.length, tags: Object.entries(markers).filter(([, v]) => s.includes(v)).map(([k]) => k), sharp: /\.i\(914592\)/.test(s) };
  cache.set(c, info); return info;
}
const rows = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "page.js" || e.name === "route.js") {
      const text = fs.readFileSync(p, "utf8");
      const chunks = [...text.matchAll(/R\.c\("([^"]+)"\)/g)].map((m) => m[1].replace(/^server\//, ""));
      let size = 0; const tags = new Set(); let sharp = false;
      for (const c of chunks) { const i = chunkInfo(c); size += i.size; i.tags.forEach((t) => tags.add(t)); if (i.sharp) sharp = true; }
      if (sharp) tags.add("sharp (a module importing it)");
      rows.push({ route: path.relative(path.join(root, "app"), p), chunks: chunks.length, size, tags });
    }
  }
})(path.join(root, "app"));
console.log("route entries:", rows.length);
const count = {};
for (const r of rows) for (const t of r.tags) count[t] = (count[t] || 0) + 1;
for (const [k, v] of Object.entries(count).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), (100 * v / rows.length).toFixed(0).padStart(3) + "%", k);
const sizes = rows.map((r) => r.size).sort((a, b) => a - b);
const q = (p) => (sizes[Math.floor(p * (sizes.length - 1))] / 1048576).toFixed(1);
console.log(`server JS loaded per route entry (MB): min ${q(0)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} max ${q(1)}`);
const pick = (re) => rows.filter((r) => re.test(r.route)).slice(0, 12).map((r) => `   ${(r.size / 1048576).toFixed(1)} MB ${String(r.chunks).padStart(3)} chunks  ${r.route}  [${[...r.tags].join(", ")}]`).join("\n");
console.log("examples:\n" + pick(/^(s\/\[store\]\/\[market\]\/page\.js|s\/\[store\]\/\[market\]\/checkout\/page\.js|api\/visit\/route\.js|api\/speed\/route\.js|api\/health\/route\.js|api\/stripe\/webhook\/\[storeId\]\/route\.js|api\/cron\/cart-reminders\/route\.js|api\/shop\/tiles\/route\.js|api\/consent\/route\.js|api\/chat\/route\.js)$/));
fs.writeFileSync("/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/dp-route-libs.json", JSON.stringify(rows.map((r) => ({ ...r, tags: [...r.tags] }))));
