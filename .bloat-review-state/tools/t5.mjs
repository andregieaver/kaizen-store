import { execFileSync } from "node:child_process";
import fs from "node:fs";
const pc = await import("@/lib/page-content");
const union = pc.pageBlockUnion; const opts = union.options ?? union.def?.options;
function shapeOf(s) { let cur = s; for (let i = 0; i < 10 && cur; i++) { if (cur.shape) return cur.shape; const d = cur.def ?? cur._zod?.def; cur = d?.in ?? d?.innerType ?? d?.schema ?? d?.out ?? null; } return null; }
const fields = new Map();
for (const o of opts) { const shape = shapeOf(o); const type = shape?.type?.def?.values?.[0] ?? "?"; for (const k of Object.keys(shape ?? {})) fields.set(k, (fields.get(k) ?? []).concat(type)); }
// also row and column fields
const rowShape = shapeOf(pc.pageRowSchema); for (const k of Object.keys(rowShape ?? {})) fields.set(k, (fields.get(k) ?? []).concat("ROW"));
const colShape = shapeOf(pc.pageColumnSchema); for (const k of Object.keys(colShape ?? {})) fields.set(k, (fields.get(k) ?? []).concat("COLUMN"));
// list of all non-test source files outside admin editor + page-content itself
const files = execFileSync("rg", ["--files", "/home/user/kaizen-store/src", "-g", "*.ts", "-g", "*.tsx", "-g", "!*.test.*", "-g", "!**/admin/**", "-g", "!**/page-content.ts", "-g", "!**/page-ai.ts", "-g", "!**/signature/**", "-g", "!**/messages/**", "-g", "!**/admin-messages/**"], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n");
const siteFiles = files.filter((f) => /src\/(components|lib|server|app\/s|app\/\(site\)|app\/api)/.test(f));
const texts = siteFiles.map((f) => fs.readFileSync(f, "utf8"));
const out = [];
for (const [k, types] of fields) {
  const re = new RegExp(`[.?]${k}\\b|\\b${k}[,:}]|["']${k}["']`);
  let n = 0; for (const t of texts) if (re.test(t)) n++;
  out.push([k, n, types.length, types.slice(0, 3).join("/")]);
}
out.sort((a, b) => a[1] - b[1]);
console.log("fields", fields.size, "files scanned", siteFiles.length);
console.log(out.slice(0, 40).map((r) => r.join(" | ")).join("\n"));
