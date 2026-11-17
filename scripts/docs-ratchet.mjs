// Writes src/lib/docs-budget.baseline.json, the numbers the written rules are held to (`src/lib/docs-budget.scan.test.ts`,
// bloat review step 1.1). A number only falls: there is no flag that raises one.
//
//   node scripts/docs-ratchet.mjs --check   report what rose or fell, write nothing (exit 1 when either)
//   node scripts/docs-ratchet.mjs           lower the baseline to the counts; refuses when something rose
//   node scripts/docs-ratchet.mjs --first   write the baseline as things stand, once (keeps the key claudeOutsideIndex)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { docsCounts, docsFallen, docsProblems } from "./lib/docs-count.mjs";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "src/lib/docs-budget.baseline.json");
const mode = process.argv[2] ?? "";

let old = {};
try {
  old = JSON.parse(readFileSync(file, "utf8"));
} catch {
  old = {};
}

const counts = docsCounts(root);
const written = {
  ...old,
  claude: counts.claude,
  loaded: counts.loaded,
  imports: counts.imports,
  longLines: {
    rules: counts.longLines.rules,
    decisions: counts.longLines.decisions,
    living: counts.longLines.living,
    tableRows: counts.longLines.tableRows,
  },
  bigRules: counts.bigRules,
  bigDecisions: counts.bigDecisions,
};

function figures() {
  const rows = Object.values(counts.longLines.tableRows).reduce((sum, n) => sum + n, 0);
  return `CLAUDE.md ${counts.claude.bytes} bytes, ${counts.claude.lines} lines; loaded ${counts.loaded}; long lines in rules ${counts.longLines.rules}, decisions ${counts.longLines.decisions}, living ${counts.longLines.living}, table rows ${rows}; big rules ${Object.keys(counts.bigRules).length}, big decisions ${Object.keys(counts.bigDecisions).length}`;
}

const save = () => writeFileSync(file, `${JSON.stringify(written, null, 2)}\n`);

if (mode === "--first") {
  if (existsSync(file) && "claude" in old) {
    console.error("The baseline already has its figures. It only falls: run node scripts/docs-ratchet.mjs.");
    process.exit(1);
  }
  save();
  console.log(`Baseline written: ${figures()}`);
} else if (!("claude" in old)) {
  console.error("The baseline has no figures yet: run node scripts/docs-ratchet.mjs --first.");
  process.exit(1);
} else if (mode === "--check") {
  const messages = [...docsProblems(counts, old), ...docsFallen(counts, old)];
  if (messages.length) {
    for (const message of messages) console.error(message);
    process.exit(1);
  }
  console.log(`The written rules are within their budget: ${figures()}`);
} else if (mode === "") {
  const problems = docsProblems(counts, old);
  if (problems.length) {
    console.error("The docs budget only falls. Not written:");
    for (const message of problems) console.error(`  ${message}`);
    process.exit(1);
  }
  save();
  console.log(`Baseline lowered: ${figures()}`);
} else {
  console.error(`Unknown flag ${mode}. Use --check, --first or no flag.`);
  process.exit(1);
}
