// Writes src/lib/surface-budget.baseline.json, the numbers the surface budget of bloat review step 1.18 holds the product to
// (`src/lib/surface-budget.scan.test.ts`): fourteen counts of what every store carries whether it uses it or not (scheduled jobs,
// every-minute routes, pages, route handlers, tables, links, AI tools, feature ids), the indexes and triggers of the eight hot
// tables, and the twins kept on purpose. The counts import TypeScript modules, so they run inside vitest; this is a thin wrapper.
//
//   node scripts/surface-budget.mjs                 lowers the baseline (refuses while any count is above it)
//   node scripts/surface-budget.mjs --raise D123    raises it, only when decision D123 has an 'Idle cost:' line
//   node scripts/surface-budget.mjs --first         writes the first baseline
//
// A new job, page, table, link or tool adds cost to every store: write its decision with an 'Idle cost:' line (per request, per
// scheduled run, per cold start; 'none' where none), then run it with --raise.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
let mode = "lower";
if (args.includes("--first")) mode = "first";
else if (args.includes("--raise")) {
  const id = args[args.indexOf("--raise") + 1] ?? "";
  if (!/^D\d+$/.test(id)) {
    console.error("Usage: node scripts/surface-budget.mjs [--first | --raise D<number>]\n  --raise needs the decision's id, for example --raise D123.");
    process.exit(1);
  }
  mode = `raise:${id}`;
}
const result = spawnSync("pnpm", ["exec", "vitest", "run", "src/lib/surface-budget.scan.test.ts"], { stdio: "inherit", env: { ...process.env, SURFACE_BUDGET: mode } });
process.exit(result.status ?? 1);
