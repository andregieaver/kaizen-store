// Writes src/lib/copies.baseline.json, the numbers the copies budget of bloat review step 1.17 holds the code to
// (`src/lib/copies.scan.test.ts`), and prints a report.
//
//   node scripts/copies.mjs                       the four counts, the ten largest exact pairs and near families, and (printed only,
//                                                 never held) the exact copies between test files
//   node scripts/copies.mjs --write               lowers the numbers; nearLines is rewritten every time (its test has 250 lines of room)
//   node scripts/copies.mjs --write --reason "…"  also accepts a rise of exactAcrossFiles, exactInsideFiles, repeatedHelperNames or
//                                                 repeatedHelperDeclarations, or a new twin pair, and keeps the reason (at least 20
//                                                 characters): a twin's under twins[pair].reason, a number's in `raised` with its date
//
// A copy made on purpose is recorded with --reason; a second kind of an existing thing extends the first one's engine with a scope.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { exactCopies, exactCopiesInTests, nearCopies, repeatedHelpers, twinPairs } from "./lib/copy-count.mjs";

const root = path.join(import.meta.dirname, "..");
const file = path.join(root, "src", "lib", "copies.baseline.json");
const argv = process.argv.slice(2);
const reasonAt = argv.indexOf("--reason");
const reason = reasonAt >= 0 ? (argv[reasonAt + 1] ?? "") : "";

const exact = exactCopies(root);
const near = nearCopies(root);
const twins = twinPairs(root);
const helpers = repeatedHelpers(root);
const now = {
  exactAcrossFiles: exact.acrossFiles,
  exactInsideFiles: exact.insideFiles,
  nearLines: near.lines,
  repeatedHelperNames: helpers.names,
  repeatedHelperDeclarations: helpers.declarations,
};

if (!argv.includes("--write")) {
  console.log(`exact copied lines across files ${now.exactAcrossFiles}, inside one file ${now.exactInsideFiles}`);
  console.log(`near copied lines ${now.nearLines} in ${near.families.length} families`);
  console.log(`${twins.length} twin pairs`);
  console.log(`${now.repeatedHelperNames} helpers declared with identical text in 3 or more files, ${now.repeatedHelperDeclarations} declarations`);
  console.log("\nThe ten largest exact pairs (shared windows of 10 lines):");
  for (const p of exact.pairs.slice(0, 10)) console.log(`  ${String(p.windows).padStart(4)}  ${p.a}  <>  ${p.b}`);
  console.log("\nThe ten largest near families (files, places, lines):");
  for (const f of near.families.slice(0, 10)) console.log(`  ${f.files} files, ${f.places} places, ${f.lines} lines: ${f.at.slice(0, 3).join(", ")}`);
  console.log(`\nExact copies between test files (printed only, never held): ${exactCopiesInTests(root)} lines`);
  process.exit(0);
}

let before = null;
if (existsSync(file)) before = JSON.parse(readFileSync(file, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const out = {
  ...now,
  twins: {},
  raised: [...(before?.raised ?? [])],
};
const problems = [];
const mayRaise = reason.trim().length >= 20;
for (const key of ["exactAcrossFiles", "exactInsideFiles", "repeatedHelperNames", "repeatedHelperDeclarations"]) {
  if (before && now[key] > before[key]) {
    if (mayRaise) out.raised.push({ key, from: before[key], to: now[key], reason: reason.trim(), date: today });
    else problems.push(`${key}: ${before[key]} → ${now[key]}`);
  }
}
for (const pair of twins) {
  const kept = before?.twins?.[pair];
  if (kept) out.twins[pair] = kept;
  else if (!before) out.twins[pair] = { reason: reason.trim() || "TODO" };
  else if (mayRaise) out.twins[pair] = { reason: reason.trim() };
  else problems.push(`new twin pair ${pair}`);
}
if (problems.length > 0) {
  console.error(`The copies only fall. Not written:\n  ${problems.join("\n  ")}\nIf the copy is on purpose: node scripts/copies.mjs --write --reason "why, at least 20 characters". Otherwise extend the first one's engine with a scope.`);
  process.exit(1);
}
const gone = Object.keys(before?.twins ?? {}).filter((pair) => !twins.includes(pair));
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `Wrote ${path.relative(root, file)}: exact ${now.exactAcrossFiles} across files and ${now.exactInsideFiles} inside, near ${now.nearLines}, ` +
    `${twins.length} twin pairs${gone.length > 0 ? ` (${gone.length} no longer twins: ${gone.join(", ")})` : ""}, helpers ${now.repeatedHelperNames} names and ${now.repeatedHelperDeclarations} declarations.`,
);
