// Writes src/server/ratchet.baseline.json, the numbers the ratchet of code review step 1.2 holds the code to
// (`src/server/ratchet.scan.test.ts`): run it after a change lowers one, and commit the file with the change.
//
//   node scripts/ratchet.mjs
//
// It refuses to raise a number: a file with more unchecked reads than its baseline, a file that had none, or a total that
// went up is said and nothing is written. Make the new read typed (`typedRows()`) or the cast unneeded instead.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ratchetCounts } from "./lib/ratchet-count.mjs";

const root = path.join(import.meta.dirname, "..");
const out = path.join(root, "src", "server", "ratchet.baseline.json");
const now = ratchetCounts(root);
let before = null;
try {
  before = JSON.parse(readFileSync(out, "utf8"));
} catch {
  // No baseline yet: the first is written as things stand.
}
if (before && !process.argv.includes("--first")) {
  const raised = [];
  for (const [file, n] of Object.entries(now.untypedReads)) if (n > (before.untypedReads[file] ?? 0)) raised.push(`${file}: ${before.untypedReads[file] ?? 0} → ${n} unchecked reads`);
  if (now.unknownCasts > before.unknownCasts) raised.push(`as unknown as: ${before.unknownCasts} → ${now.unknownCasts}`);
  if (now.anySuppressed > before.anySuppressed) raised.push(`suppressed any: ${before.anySuppressed} → ${now.anySuppressed}`);
  if (raised.length > 0) {
    console.error(`The ratchet only falls. Not written:\n  ${raised.join("\n  ")}`);
    process.exit(1);
  }
}
writeFileSync(out, `${JSON.stringify(now, null, 2)}\n`);
const reads = Object.values(now.untypedReads).reduce((a, b) => a + b, 0);
console.log(`Wrote ${path.relative(root, out)}: ${reads} unchecked reads in ${Object.keys(now.untypedReads).length} files, ${now.unknownCasts} as unknown as, ${now.anySuppressed} suppressed any.`);
