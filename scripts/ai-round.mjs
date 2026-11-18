// Every agent's round, written to src/server/ai-round.baseline.json (bloat review step 1.19).
//
//   node scripts/ai-round.mjs           lower the baseline after a change that made a round smaller (a rise is refused)
//   node scripts/ai-round.mjs --first   write it whatever rose: a rise on purpose, shown in the diff, its reason in the commit
//
// Run it after a change lowers a round, and commit the baseline with the change. The draw imports server TypeScript, so this
// only runs src/server/ai-round.scan.test.ts in update mode (UPDATE_BASELINE=1, and FIRST=1 with --first) and prints the result.
import { spawnSync } from "node:child_process";

const first = process.argv.includes("--first");
const result = spawnSync("pnpm", ["vitest", "run", "src/server/ai-round.scan.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, UPDATE_BASELINE: "1", ...(first ? { FIRST: "1" } : {}) },
});
if (result.status === 0) console.log(`src/server/ai-round.baseline.json written${first ? " (--first: rises accepted)" : ""}.`);
process.exit(result.status ?? 1);
