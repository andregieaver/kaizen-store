import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
const SRC = "/home/user/kaizen-store/src";
function files(dir, out = []) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) files(p, out); else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p); } return out; }
const isAdmin = (p) => p.startsWith(SRC + "/app/admin/") || p.startsWith(SRC + "/components/admin/");
const roots = [...files(SRC + "/app"), ...files(SRC + "/components")].filter((p) => !isAdmin(p) && !p.startsWith(SRC + "/app/api/"));
const tryFile = (p) => { for (const c of [p, p + ".ts", p + ".tsx", p + "/index.ts", p + "/index.tsx"]) if (existsSync(c) && statSync(c).isFile()) return c; return null; };
const IMPORT = /(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const seen = new Set(); const via = new Map();
const stack = [...roots];
const skipInline = process.argv[2] === "noinline";
while (stack.length) {
  const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
  if (skipInline && f.startsWith(SRC + "/components/inline-edit/")) continue;
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] || m[2]; if (!spec) continue;
    // skip type-only imports
    const stmt = m[0]; if (/^import\s+type\s/.test(stmt)) continue;
    const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(f), spec) : null; if (!base) continue;
    const t = tryFile(base); if (t && !seen.has(t)) { if (isAdmin(t) && !via.has(t)) via.set(t, f); stack.push(t); }
  }
}
const adminReached = [...seen].filter(isAdmin);
console.log("roots", roots.length, "reached files", seen.size, "admin files reached", adminReached.length, "of", [...files(SRC + "/app/admin"), ...files(SRC + "/components/admin")].length);
const classes = JSON.parse(readFileSync("classes.json", "utf8"));
const adminOnly = classes.filter(([c, b, h]) => { const x = h.map((s) => s.replace("~", "")); return x.includes("admin") && !x.some((s) => ["front", "lib", "server", "other", "sql"].includes(s)); });
const toks = new Set(); for (const f of adminReached) for (const t of readFileSync(f, "utf8").split(/[\s"'`]+/)) toks.add(t);
const needed = adminOnly.filter(([c]) => toks.has(c));
console.log("admin-only classes", adminOnly.length, "bytes", adminOnly.reduce((a, x) => a + x[1], 0), "| of which appear in admin files a storefront/site file can import:", needed.length, "bytes", needed.reduce((a, x) => a + x[1], 0));
console.log("entry points into admin code:"); const firsts = new Map(); for (const [t, f] of via) if (!isAdmin(f)) firsts.set(t.replace(SRC + "/", ""), f.replace(SRC + "/", "")); for (const [t, f] of [...firsts].slice(0, 40)) console.log("  ", f, "->", t);
