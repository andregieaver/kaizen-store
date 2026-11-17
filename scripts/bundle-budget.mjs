// Every route's first scripts against a baseline (bloat review step 1.2, docs/rules/budgets.md):
//
//   node scripts/bundle-budget.mjs           the check CI's e2e job runs after the build
//   node scripts/bundle-budget.mjs --write   lowers the baseline (new routes added, fallen ones lowered, gone ones removed)
//   node scripts/bundle-budget.mjs --first   writes the baseline as the build stands, only when there is none
//
// It reads .next/diagnostics/route-bundle-stats.json, written by `pnpm build`. There is no flag that raises a figure.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fallen, lowered, MARKERS, markerCounts, missingMarkers, parseStats, problems, ROOM, routeBytes } from "./lib/bundle-budget.mjs";

const root = path.join(import.meta.dirname, "..");
const statsFile = path.join(root, ".next", "diagnostics", "route-bundle-stats.json");
const baselineFile = path.join(import.meta.dirname, "bundle-budget.baseline.json");

if (!existsSync(statsFile)) {
  console.error("No .next/diagnostics/route-bundle-stats.json: run pnpm build first.");
  process.exit(1);
}
let stats;
try {
  stats = parseStats(JSON.parse(readFileSync(statsFile, "utf8")));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const now = { routes: routeBytes(stats), markers: markerCounts(stats, (p) => readFileSync(path.join(root, p), "utf8")) };

// A marker found in no chunk at all means the library or the sentence changed, not that the count is 0.
const chunkDir = path.join(root, ".next", "static", "chunks");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
const everything = walk(chunkDir).map((file) => readFileSync(file, "utf8"));
const absent = missingMarkers(everything);
for (const marker of absent) console.error(`${marker.key}: the marker text is in no chunk; the library or the sentence changed, update MARKERS`);
if (absent.length > 0) process.exit(1);

const text = (value) => `${JSON.stringify(value, null, 1)}\n`;
const mode = process.argv.includes("--first") ? "first" : process.argv.includes("--write") ? "write" : "check";

if (mode === "first") {
  if (existsSync(baselineFile)) {
    console.error("scripts/bundle-budget.baseline.json exists; --first writes only when there is none. Use --write to lower it.");
    process.exit(1);
  }
  writeFileSync(baselineFile, text(now));
  console.log(`Wrote scripts/bundle-budget.baseline.json: ${Object.keys(now.routes).length} routes.`);
  process.exit(0);
}

if (!existsSync(baselineFile)) {
  console.error("No scripts/bundle-budget.baseline.json: run node scripts/bundle-budget.mjs --first after pnpm build.");
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
const bad = problems(now, baseline);

if (mode === "write") {
  const raised = bad.filter((line) => !line.includes("new route at"));
  if (raised.length > 0) {
    console.error(`The bundle budget only falls. Not written:\n  ${raised.join("\n  ")}`);
    process.exit(1);
  }
  const next = lowered(now, baseline);
  const fell = Object.entries(next.routes).filter(([route, bytes]) => baseline.routes[route] !== undefined && bytes < baseline.routes[route]).length;
  writeFileSync(baselineFile, text(next));
  console.log(`Wrote scripts/bundle-budget.baseline.json: ${Object.keys(next.routes).length} routes, ${fell} fell.`);
  process.exit(0);
}

for (const marker of MARKERS) console.log(`${marker.key}: ${now.markers[marker.key]} routes (baseline ${baseline.markers[marker.key] ?? "none"})`);
console.log("Heaviest routes:");
for (const [route, bytes] of Object.entries(now.routes).sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  ${route}: ${bytes} bytes`);
const lines = [...bad, ...fallen(now, baseline)];
for (const line of lines) console.error(line);
if (lines.length > 0) process.exit(1);
console.log(`${Object.keys(now.routes).length} routes within ${ROOM.toLocaleString("en-US")} bytes of the baseline`);
