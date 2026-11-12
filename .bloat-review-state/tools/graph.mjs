import fs from "node:fs";
import path from "node:path";
const SRC = "/home/user/kaizen-store/src";
const cache = new Map();
function tryFile(base) {
  for (const cand of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try { if (fs.statSync(cand).isFile()) return cand; } catch {}
  }
  return null;
}
export function info(file) {
  if (cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(file, "utf8");
  const head = text.slice(0, 400);
  const client = /^\s*["']use client["']/m.test(head);
  const stat = [], dyn = [], ext = [];
  // strip block comments roughly
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?from\s+)?["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[2]) continue; // import type
    // "import { type A, type B }" all-type? treat as value unless every specifier is type
    const spec = m[3] ?? "";
    const braces = spec.match(/\{([^}]*)\}/);
    if (braces && !/^\s*\w/.test(spec.replace(/\{[^}]*\}/, "").replace(/from/, "").trim() || "") ) {
      const names = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
    }
    stat.push(m[4]);
  }
  const re2 = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = re2.exec(code))) dyn.push(m[1]);
  const res = (s) => { let base = null; if (s.startsWith("@/")) base = path.join(SRC, s.slice(2)); else if (s.startsWith(".")) base = path.resolve(path.dirname(file), s); else { ext.push(s); return null; } return tryFile(base); };
  const out = { file, client, lines: text.split("\n").length, bytes: text.length, stat: stat.map(res).filter(Boolean), dyn: dyn.map(res).filter(Boolean), ext: [...new Set(ext)] };
  cache.set(file, out);
  return out;
}
/** closure following static imports; options.stopAtClient: do not descend into client modules (server graph) */
export function closure(entry, { stopAtClient = false, followDyn = false } = {}) {
  const seen = new Map(); const q = [entry];
  while (q.length) { const f = q.pop(); if (seen.has(f)) continue; const i = info(f); seen.set(f, i); if (stopAtClient && i.client && f !== entry) continue; for (const d of i.stat) q.push(d); if (followDyn) for (const d of i.dyn) q.push(d); }
  return seen;
}
if ((process.argv[1] ?? "").endsWith("graph.mjs")) {
  for (const e of process.argv.slice(2)) {
    const entry = path.resolve("/home/user/kaizen-store", e);
    const all = closure(entry);
    const lines = [...all.values()].reduce((n, i) => n + i.lines, 0);
    const bytes = [...all.values()].reduce((n, i) => n + i.bytes, 0);
    const ext = new Set([...all.values()].flatMap((i) => i.ext));
    console.log(e, "| modules", all.size, "| lines", lines, "| KB", Math.round(bytes / 1024), "| client modules", [...all.values()].filter((i) => i.client).length, "| ext pkgs", [...ext].join(","));
  }
}
