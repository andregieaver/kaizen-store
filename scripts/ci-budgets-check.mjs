#!/usr/bin/env node
// Are the ceilings in scripts/ci-budgets.json still close to what CI does? (bloat review step 1.20; run weekly by .github/workflows/ci-budgets.yml.)
// Lists the last ten completed runs of CI on main, reads each run's timings artifacts, prints each key's median and ceiling, and exits 1 with
// the list from ceilingProblems(): a ceiling more than 25% above its median (10% for the build's memory) or a release key over 600 seconds.
//
//   node scripts/ci-budgets-check.mjs             check (GH_TOKEN, GITHUB_REPOSITORY)
//   node scripts/ci-budgets-check.mjs --suggest   print a ready ci-budgets.json built from the medians (1.25 times each median; the build's memory is read from a Vercel build log by hand, 1.10 times)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { github, timingsOfRun } from "./lib/ci-timings.mjs";
import { ceilingProblems, median } from "./lib/timed.mjs";

const repository = process.env.GITHUB_REPOSITORY ?? "andregieaver/kaizen-store";
const budgetsPath = join(dirname(fileURLToPath(import.meta.url)), "ci-budgets.json");
const budgets = JSON.parse(readFileSync(budgetsPath, "utf8"));
// Every key is a step of the quick gate or of a job the release job waits for, so each holds a deploy back and carries `release: true`.

const { workflow_runs: runs } = await github(`/repos/${repository}/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=10`);
const perKey = new Map();
for (const run of runs) {
  let entries = [];
  try {
    entries = await timingsOfRun(repository, run.id);
  } catch (error) {
    console.error(`ci-budgets-check: run ${run.id} skipped (${error instanceof Error ? error.message : "unknown"})`);
  }
  // A key counts once per run: its slowest entry (the three integration shards have keys of their own).
  const seen = new Map();
  for (const entry of entries) seen.set(entry.key, Math.max(seen.get(entry.key) ?? 0, Number(entry.seconds)));
  for (const [key, seconds] of seen) perKey.set(key, [...(perKey.get(key) ?? []), seconds]);
}

const medians = Object.fromEntries([...perKey].map(([key, values]) => [key, median(values)]));
console.log(`CI runs on main read: ${runs.length}`);
console.log("| key | runs | median s | ceiling s |\n| --- | --- | --- | --- |");
for (const key of [...perKey.keys()].sort()) {
  console.log(`| ${key} | ${perKey.get(key).length} | ${Math.round(medians[key] * 10) / 10} | ${budgets.ceilings?.[key]?.seconds ?? "none yet"} |`);
}

if (process.argv.includes("--suggest")) {
  const ceilings = {};
  for (const key of [...perKey.keys()].sort()) {
    ceilings[key] = { seconds: Math.ceil(medians[key] * 1.25), release: true };
  }
  const suggestion = { ...budgets, ceilings };
  console.log(JSON.stringify(suggestion, null, 2));
  const over = Object.entries(ceilings).filter(([, entry]) => entry.release && entry.seconds > 600);
  if (over.length > 0) console.error(`ci-budgets-check: release keys over 600 s, report them instead of writing them: ${over.map(([key]) => key).join(", ")}`);
  process.exit(0);
}

const problems = ceilingProblems(budgets, medians);
if (problems.length > 0) {
  console.error(`ci-budgets-check: ${problems.length} ceiling(s) to fix:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Every ceiling is within 25% of its median.");
