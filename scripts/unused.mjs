// Writes src/server/unused.baseline.json, the lists the unused-code budget of bloat review step 1.17 holds the code to
// (`src/server/unused.scan.test.ts`), and prints the counts.
//
//   node scripts/unused.mjs                 the counts and the first 20 of each list
//   node scripts/unused.mjs --write         writes the baseline: it keeps every reason already in the file, removes entries that are no
//                                           longer suspects (and says so), and refuses to add an entry to unusedExports or testOnlyExports
//   node scripts/unused.mjs --write --first also adds new entries (shown in the diff: say why in the commit)
//
// A new entry of the four reason objects (keptForTests, testOnlyFiles, publicUnreferenced, apiUnreferenced) is written with the reason
// 'TODO', and the script exits 1 while any TODO remains: write the reason a reviewer can check. Never list an export in keptForTests to
// silence the scan without one.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { unreferencedApiRoutes, unreferencedPublic, unusedScan } from "./lib/unused-scan.mjs";

const root = path.join(import.meta.dirname, "..");
const file = path.join(root, "src", "server", "unused.baseline.json");
const argv = process.argv.slice(2);
const first = argv.includes("--first");

const scan = unusedScan(root);
const now = {
  unusedExports: scan.unusedExports,
  testOnlyExports: scan.testOnlyExports,
  testOnlyFiles: scan.testOnlyFiles,
  publicUnreferenced: unreferencedPublic(root),
  apiUnreferenced: unreferencedApiRoutes(root),
};
const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;

if (!argv.includes("--write")) {
  console.log(`${now.unusedExports.length} unused exports, ${now.testOnlyExports.length} exports only tests use, ${now.testOnlyFiles.length} files only tests reach, ${now.publicUnreferenced.length} unreferenced public files, ${now.apiUnreferenced.length} unreferenced API routes`);
  for (const [key, list] of Object.entries(now)) {
    if (list.length === 0) continue;
    console.log(`\n${key} (first 20):`);
    for (const item of list.slice(0, 20)) console.log(`  ${item}`);
  }
  process.exit(0);
}

const removed = [];
const problems = [];
const out = { unusedExports: [], testOnlyExports: [], keptForTests: {}, testOnlyFiles: {}, publicUnreferenced: {}, apiUnreferenced: {} };

// Lists: unusedExports and testOnlyExports; an export kept on purpose moves to keptForTests with its reason.
const kept = before?.keptForTests ?? {};
for (const key of ["unusedExports", "testOnlyExports"]) {
  const held = new Set(before?.[key] ?? []);
  for (const item of now[key]) {
    if (key === "testOnlyExports" && kept[item]) continue;
    if (!before || first || held.has(item)) out[key].push(item);
    else problems.push(`${key}: ${item} is new (delete it or use it; a helper only tests need lives in a *-test-support.ts file)`);
  }
  for (const item of held) if (!now[key].includes(item)) removed.push(`${key}: ${item}`);
}
out.testOnlyExports.sort();
// Objects of reasons.
const reasons = { keptForTests: now.testOnlyExports.filter((item) => kept[item]), testOnlyFiles: now.testOnlyFiles, publicUnreferenced: now.publicUnreferenced, apiUnreferenced: now.apiUnreferenced };
for (const [key, list] of Object.entries(reasons)) {
  for (const item of list) out[key][item] = before?.[key]?.[item] ?? "TODO";
  for (const item of Object.keys(before?.[key] ?? {})) if (!list.includes(item)) removed.push(`${key}: ${item}`);
}
if (problems.length > 0) {
  console.error(`The unused code only falls. Not written:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
for (const item of removed) console.log(`removed: ${item}`);
console.log(
  `Wrote ${path.relative(root, file)}: ${out.unusedExports.length} unused exports, ${out.testOnlyExports.length} tests-only exports (+${Object.keys(out.keptForTests).length} kept for tests), ` +
    `${Object.keys(out.testOnlyFiles).length} tests-only files, ${Object.keys(out.publicUnreferenced).length} public files, ${Object.keys(out.apiUnreferenced).length} API routes.`,
);
const todo = Object.entries(reasons).flatMap(([key]) => Object.entries(out[key]).filter(([, r]) => r === "TODO").map(([item]) => `${key}: ${item}`));
if (todo.length > 0) {
  console.error(`A reason is missing (TODO) for:\n  ${todo.join("\n  ")}\nWrite it in ${path.relative(root, file)}.`);
  process.exit(1);
}
