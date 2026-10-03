// The parity tracker's command line (docs/parity/README.md).
//
//   node scripts/parity.mjs           print headline, domains, evidence debt, projection per wave
//   node scripts/parity.mjs write     rewrite the generated sections of docs/shopify-parity.md
//   node scripts/parity.mjs check     validate the rows and fail when the report is out of date
//
// The rules and the arithmetic are in src/lib/parity.ts (pure; node strips its types).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  decisionIds,
  markerProblems,
  outOfDate,
  parseRowFiles,
  renderSections,
  renderText,
  validateRows,
  writeSections,
} from "../src/lib/parity.ts";

const root = path.join(import.meta.dirname, "..");
const rowsDir = path.join(root, "docs", "parity", "rows");
const reportPath = path.join(root, "docs", "shopify-parity.md");
/** The report says what moved after this day. */
const SINCE = "2026-10-02";

const command = process.argv[2] ?? "print";
if (!["print", "write", "check"].includes(command)) {
  console.error(`unknown command "${command}": use print, write or check`);
  process.exit(2);
}

const files = readdirSync(rowsDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({ name, text: readFileSync(path.join(rowsDir, name), "utf8") }));

const parsed = parseRowFiles(files);
const problems = [
  ...parsed.problems,
  ...validateRows(parsed.rows, {
    fileExists: (file) => existsSync(path.join(root, file)),
    knownDecisions: decisionIds(readFileSync(path.join(root, "docs", "decisions.md"), "utf8")),
    today: new Date().toISOString().slice(0, 10),
  }),
];

if (problems.length > 0) {
  console.error(`The tracker breaks ${problems.length} rule${problems.length === 1 ? "" : "s"} (docs/parity/README.md):`);
  for (const p of problems) console.error(`  ${p.id} [${p.rule}] ${p.message}`);
  process.exit(1);
}

const rows = parsed.rows;
const sections = renderSections(rows, SINCE);
const doc = readFileSync(reportPath, "utf8");

if (command === "print") {
  console.log(renderText(rows));
} else {
  const marks = markerProblems(doc, sections);
  if (marks.length > 0) {
    console.error("docs/shopify-parity.md does not match the generator:");
    for (const m of marks) console.error(`  ${m}`);
    process.exit(1);
  }
  if (command === "write") {
    const next = writeSections(doc, sections);
    if (next === doc) console.log("docs/shopify-parity.md is already up to date");
    else {
      writeFileSync(reportPath, next);
      console.log(`rewrote ${outOfDate(doc, sections).length} generated section(s) of docs/shopify-parity.md`);
    }
  } else {
    const stale = outOfDate(doc, sections);
    if (stale.length > 0) {
      console.error(`docs/shopify-parity.md is out of date: ${stale.join(", ")}. Run pnpm parity:write.`);
      process.exit(1);
    }
    console.log(`parity: ${rows.length} rows valid, report up to date`);
  }
}
