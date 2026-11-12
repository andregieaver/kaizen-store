import path from "node:path"; import fs from "node:fs";
import { info, closure } from "./graph.mjs";
const ROOT = "/home/user/kaizen-store"; const rel = (f) => path.relative(ROOT, f);
const loaded = JSON.parse(fs.readFileSync("/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/loaded.json", "utf8"));
const page = loaded[process.argv[2]]; const mods = page.byModule.filter(([m]) => m.startsWith("src/"));
const set = new Set(mods.map(([m]) => m));
// for each target, which loaded modules import it directly
for (const t of process.argv.slice(3)) {
  const importers = [];
  for (const [m] of mods) { let i; try { i = info(path.join(ROOT, m)); } catch { continue; } if (i.stat.map(rel).some((d) => d.includes(t))) importers.push(m + (i.client ? " [client]" : "")); }
  console.log(t, "<=", importers.join(", ") || "(none among loaded src modules)");
}
console.log("src modules loaded:", mods.length, "bytes", mods.reduce((n, [, b]) => n + b, 0));
