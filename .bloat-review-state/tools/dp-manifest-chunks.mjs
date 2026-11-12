// Lists the client chunks a route's client-reference manifest names, with sizes and library markers.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const next = "/home/user/kaizen-store/.next";
const file = process.argv[2];
const text = fs.readFileSync(file, "utf8");
const chunks = new Set([...text.matchAll(/static\/chunks\/[A-Za-z0-9_\-.~]+\.js/g)].map((m) => m[0]));
const markers = { three: "WebGLRenderer", tiptap: "ProseMirror", codemirror: "cm-editor", dndkit: "DndContext", mediabunny: "mediabunny", stripejs: "js.stripe.com", supabase: "supabase", zod: "ZodError", lit: "lit-html", webvitals: "web-vitals", qr: "QRCode", reactdom: "react-dom", "stripe-connect": "connect-js" };
let total = 0, gz = 0; const rows = [];
for (const c of chunks) {
  const p = path.join(next, c); if (!fs.existsSync(p)) continue;
  const b = fs.readFileSync(p); const s = b.toString("latin1");
  const tags = Object.entries(markers).filter(([, v]) => s.includes(v)).map(([k]) => k);
  const g = zlib.gzipSync(b).length; total += b.length; gz += g; rows.push([b.length, g, path.basename(c), tags.join(",")]);
}
rows.sort((a, b) => b[0] - a[0]);
console.log(`chunks=${rows.length} raw=${(total / 1024).toFixed(0)}KB gzip=${(gz / 1024).toFixed(0)}KB  (all chunks the manifest names, lazy ones included)`);
for (const r of rows.slice(0, +(process.argv[3] || 14))) console.log(r.join("\t"));
