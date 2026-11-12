// Which third-party libraries are inside the server chunks a route's entry loads (R.c lines), by marker strings.
import fs from "node:fs";
const entry = process.argv[2];
const page = fs.readFileSync(entry, "utf8");
const chunks = [...page.matchAll(/R\.c\("([^"]+)"\)/g)].map((m) => m[1].replace(/^server\//, ""));
const markers = { stripe: "api.stripe.com", "opentype.js": "Unsupported OpenType", "supabase-js": "supabase-js", "seek-bzip": "BZh", zod: "ZodError", "drizzle pg-core": "PgColumn", schema: '"payout_reads"', "web-push": "web-push", unpdf: "pdfjs", mammoth: "mammoth", "playwright": "playwright", "react-dom/server": "renderToReadableStream", "ai manager tools (owner-tools)": "OWNER_TOOLS", };
let total = 0; const found = {};
for (const c of chunks) { let s; try { s = fs.readFileSync(c, "utf8"); } catch { continue; } total += s.length; for (const [k, v] of Object.entries(markers)) if (s.includes(v)) (found[k] ||= []).push(`${c.split("/").pop().slice(0, 40)}(${(s.length / 1024).toFixed(0)}KB)`); }
console.log(entry, "chunks=" + chunks.length, "JS=" + (total / 1048576).toFixed(1) + "MB");
for (const [k, v] of Object.entries(found)) console.log("  " + k.padEnd(30), v.slice(0, 3).join(" "));
