// Transitive package counts per direct dependency, from pnpm-lock.yaml's snapshots section (a small indentation parser, no YAML library).
import fs from "node:fs";
const text = fs.readFileSync("/home/user/kaizen-store/pnpm-lock.yaml", "utf8");
const lines = text.split("\n");
const start = lines.findIndex((l) => l === "snapshots:");
const snaps = new Map(); let cur = null, section = null;
for (let i = start + 1; i < lines.length; i++) {
  const l = lines[i]; if (!l.trim()) continue;
  const ind = l.length - l.trimStart().length;
  if (ind === 2) { cur = l.trim().replace(/:$/, "").replace(/^'|'$/g, ""); snaps.set(cur, []); section = null; }
  else if (ind === 4) { section = l.trim().replace(/:$/, ""); }
  else if (ind === 6 && cur && (section === "dependencies" || section === "optionalDependencies")) {
    const m = l.trim().match(/^'?([^':]+)'?:\s*'?([^']+)'?$/); if (m) snaps.get(cur).push(`${m[1]}@${m[2]}`);
  }
}
// importers: direct deps with versions
const impStart = lines.findIndex((l) => l === "importers:");
const direct = { dependencies: [], devDependencies: [] }; let sec = null, name = null;
for (let i = impStart + 1; i < lines.length && !/^[a-z]/.test(lines[i]); i++) {
  const l = lines[i]; const ind = l.length - l.trimStart().length; const t = l.trim();
  if (ind === 4) sec = t.replace(/:$/, "");
  else if (ind === 6) name = t.replace(/:$/, "").replace(/^'|'$/g, "");
  else if (ind === 8 && t.startsWith("version:") && direct[sec]) direct[sec].push(`${name}@${t.slice(8).trim().replace(/^'|'$/g, "")}`);
}
function closure(key) { const seen = new Set(); const st = [key]; while (st.length) { const k = st.pop(); if (seen.has(k)) continue; seen.add(k); for (const d of snaps.get(k) || []) st.push(d); } return seen; }
const all = { dependencies: new Set(), devDependencies: new Set() };
const rows = [];
for (const sec2 of ["dependencies", "devDependencies"]) for (const d of direct[sec2]) { const c = closure(d); c.forEach((x) => all[sec2].add(x)); rows.push([c.size - 1, sec2 === "dependencies" ? "prod" : "dev", d.replace(/\(.*/, "")]); }
console.log("snapshots:", snaps.size, "direct prod:", direct.dependencies.length, "direct dev:", direct.devDependencies.length);
console.log("packages reachable from prod deps:", all.dependencies.size, "| from dev deps:", all.devDependencies.size, "| dev-only:", [...all.devDependencies].filter((x) => !all.dependencies.has(x)).length);
rows.sort((a, b) => b[0] - a[0]);
for (const r of rows.slice(0, 22)) console.log(String(r[0]).padStart(4), r[1], r[2]);
