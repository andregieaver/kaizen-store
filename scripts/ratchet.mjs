// Writes src/server/ratchet.baseline.json, the numbers the ratchet of code review step 1.2 holds the code to
// (`src/server/ratchet.scan.test.ts`): run it after a change lowers one, and commit the file with the change.
//
//   node scripts/ratchet.mjs
//
// It also counts, per file, the writes that address a store's row by its id alone (code review step 1.3): a write that names the
// store (`and store_id = …`, or the file's `owned()`) does not count.
//
// And, per file, the uses of `store_id is not distinct from` (step 0.23): a store's rows are filtered with `owned(storeId)`.
//
// And the source files over 100 KB and over 2,000 lines (bloat review step 1.24): read by window, so the counts only fall.
//
// And the files that import next/link directly (bloat review step 2.6): a link goes through PolicyLink or AdminLink, and the list only falls.
//
// And five counts of the admin's hand-made repeats (bloat review step 1.17): action files off storeAction()/platformAction(), tables, native selects, literal Europe/Oslo and confirm( calls.
// And, per file, the admin's hand-made field boxes and pill links (code review step 1.12, D818: `adminFiles.rawFields`, `adminFiles.pillLinks`), the kit in src/components/admin/ui aside.
// And, per file, the admin's forms bound to an action by hand (code review step 1.15, D829: `adminFiles.rawActionForms`), ActionForm and QuietActionForm aside.
// And, per file, the admin's hand-written empty blocks and bare lines of nothing (code review step 2.9, D845: `adminFiles.emptyBlocks`, `adminFiles.emptyLines`), EmptyState aside.
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
  for (const [file, n] of Object.entries(now.byIdWrites)) if (n > (before.byIdWrites?.[file] ?? 0)) raised.push(`${file}: ${before.byIdWrites?.[file] ?? 0} → ${n} writes by id without the store`);
  if (before.notDistinctStore) for (const [file, n] of Object.entries(now.notDistinctStore)) if (n > (before.notDistinctStore[file] ?? 0)) raised.push(`${file}: ${before.notDistinctStore[file] ?? 0} → ${n} uses of store_id is not distinct from`);
  if (before.pageDocumentReads) for (const [file, n] of Object.entries(now.pageDocumentReads)) if (n > (before.pageDocumentReads[file] ?? 0)) raised.push(`${file}: ${before.pageDocumentReads[file] ?? 0} → ${n} reads of a whole page document`);
  if (before.pagesTagRefreshes) for (const [file, n] of Object.entries(now.pagesTagRefreshes)) if (n > (before.pagesTagRefreshes[file] ?? 0)) raised.push(`${file}: ${before.pagesTagRefreshes[file] ?? 0} → ${n} refreshes of a store's whole pages tag`);
  for (const file of Object.keys(now.directLinks)) if (!(before.directLinks ?? now.directLinks)[file]) raised.push(`${file}: imports next/link directly; use PolicyLink or AdminLink`);
  if (now.unknownCasts > before.unknownCasts) raised.push(`as unknown as: ${before.unknownCasts} → ${now.unknownCasts}`);
  if (now.anySuppressed > before.anySuppressed) raised.push(`suppressed any: ${before.anySuppressed} → ${now.anySuppressed}`);
  if (now.filesOver100Kb > (before.filesOver100Kb ?? now.filesOver100Kb)) raised.push(`source files over 100 KB: ${before.filesOver100Kb} → ${now.filesOver100Kb}; split the file or move code out`);
  if (now.filesOver2000Lines > (before.filesOver2000Lines ?? now.filesOver2000Lines)) raised.push(`source files over 2,000 lines: ${before.filesOver2000Lines} → ${now.filesOver2000Lines}; split the file or move code out`);
  for (const [key, n] of Object.entries(now.adminRepeats)) {
    const was = before.adminRepeats?.[key];
    if (was !== undefined && n > was) raised.push(`admin ${key}: ${was} → ${n}; use the shared part (see src/server/ratchet.scan.test.ts), or accept it on purpose with node scripts/ratchet.mjs --first`);
  }
  for (const [key, files] of Object.entries(now.adminFiles)) {
    const was = before.adminFiles?.[key];
    if (was) for (const [file, n] of Object.entries(files)) if (n > (was[file] ?? 0)) raised.push(`${file}: ${was[file] ?? 0} → ${n} ${key}; use the admin kit (src/components/admin/ui), or accept it on purpose with node scripts/ratchet.mjs --first`);
  }
  if (raised.length > 0) {
    console.error(`The ratchet only falls. Not written:\n  ${raised.join("\n  ")}`);
    process.exit(1);
  }
}
// Keys another writer keeps in the same file (the query budget of step 1.10, written by its integration test) are carried over as they were.
writeFileSync(out, `${JSON.stringify({ ...(before ?? {}), ...now }, null, 2)}\n`);
const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
console.log(
  `Wrote ${path.relative(root, out)}: ${sum(now.untypedReads)} unchecked reads in ${Object.keys(now.untypedReads).length} files, ` +
    `${sum(now.byIdWrites)} writes by id without the store in ${Object.keys(now.byIdWrites).length} files, ${now.unknownCasts} as unknown as, ` +
    `${now.anySuppressed} suppressed any, ${now.filesOver100Kb} files over 100 KB, ${now.filesOver2000Lines} over 2,000 lines, ` +
    `${sum(now.notDistinctStore)} store_id is not distinct from in ${Object.keys(now.notDistinctStore).length} files; ` +
    `${sum(now.pageDocumentReads)} whole page documents read in ${Object.keys(now.pageDocumentReads).length} files, ${sum(now.pagesTagRefreshes)} refreshes of a store's whole pages tag in ${Object.keys(now.pagesTagRefreshes).length} files; ${Object.keys(now.directLinks).length} files import next/link directly; admin repeats: ${Object.entries(now.adminRepeats).map(([k, v]) => `${k} ${v}`).join(", ")}; admin files: ${Object.entries(now.adminFiles).map(([k, files]) => `${k} ${sum(files)} in ${Object.keys(files).length}`).join(", ")}.`,
);
