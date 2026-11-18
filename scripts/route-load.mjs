// What each server entry loads (bloat review step 1.8): the files it reaches by static value imports, the largest import cycle in
// src/server, and the forbidden modules each entry reaches today. The twin of scripts/ratchet.mjs for src/server/route-load.baseline.json,
// held by src/server/route-load.graph.test.ts.
//
//   node scripts/route-load.mjs           print the counts
//   node scripts/route-load.mjs --write   lower the baseline; it refuses to raise anything (prints the lines, exits 1, writes nothing)
//   node scripts/route-load.mjs --first   write whatever is there (the first baseline, or a rise accepted on purpose, shown in the diff)
//
// A route.ts over 1,500 files is a heavy handler: it needs a reason in the baseline, written by hand (a new one is written with 'TODO',
// and the script exits 1 while any reason is TODO).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { routeLoadCounts } from "./lib/route-load.mjs";

const root = path.join(import.meta.dirname, "..");
const out = path.join(root, "src", "server", "route-load.baseline.json");
const now = routeLoadCounts(root);

console.log("| Entry | Files reached | Forbidden reached today |\n|---|---|---|");
for (const [name, files] of Object.entries(now.entries)) console.log(`| ${name} | ${files.toLocaleString("en")} | ${now.exceptions[name].join(", ") || "none"} |`);
console.log(`\nLargest import cycle in src/server: ${now.largestCycle} files. Route handlers over 1,500 files: ${Object.keys(now.handlers).length}.`);

const write = process.argv.includes("--write") || process.argv.includes("--first");
if (!write) process.exit(0);

let before = null;
try {
  before = JSON.parse(readFileSync(out, "utf8"));
} catch {
  // No baseline yet: --first writes the first.
}
if (before && !process.argv.includes("--first")) {
  const raised = [];
  if (now.largestCycle > before.largestCycle) raised.push(`largest import cycle: ${before.largestCycle} → ${now.largestCycle}`);
  for (const [name, files] of Object.entries(now.entries)) {
    const was = before.entries[name];
    if (was !== undefined && files > was) raised.push(`${name}: ${was} → ${files} files`);
    for (const item of now.exceptions[name]) if (!(before.exceptions[name] ?? []).includes(item)) raised.push(`${name} reaches ${item}`);
  }
  for (const [file, files] of Object.entries(now.handlers)) if (!before.heavyHandlers[file]) raised.push(`${file}: ${files} files, a new handler over 1,500`);
  if (raised.length > 0) {
    console.error(`The route load only falls. Not written:\n  ${raised.join("\n  ")}\nImport the helper from the file that defines it, or load the module with import() where it is used; or accept it on purpose with node scripts/route-load.mjs --first.`);
    process.exit(1);
  }
}
const heavyHandlers = Object.fromEntries(
  Object.entries(now.handlers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, files]) => [file, { files, reason: before?.heavyHandlers?.[file]?.reason ?? "TODO" }]),
);
writeFileSync(out, `${JSON.stringify({ largestCycle: now.largestCycle, entries: now.entries, exceptions: now.exceptions, heavyHandlers }, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, out)}.`);
const todo = Object.entries(heavyHandlers).filter(([, h]) => h.reason === "TODO");
if (todo.length > 0) {
  console.error(`Give each of these a reason in the baseline, one sentence on why it loads over 1,500 files:\n  ${todo.map(([file]) => file).join("\n  ")}`);
  process.exit(1);
}
