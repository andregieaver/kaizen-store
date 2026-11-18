#!/usr/bin/env node
// The runner minutes one push of CI used (bloat review step 1.20): the sum of every completed job's minutes, the install seconds of each job
// from the timings it uploaded, and a failure above `runnerMinutes.max` of scripts/ci-budgets.json (no max yet: it says so and passes).
// Writes Markdown on stdout, for $GITHUB_STEP_SUMMARY. Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { github, timingsOfRun } from "./lib/ci-timings.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
if (!repository || !runId) {
  console.error("runner-minutes: GITHUB_REPOSITORY and GITHUB_RUN_ID are needed");
  process.exit(2);
}

/** Minutes between two ISO times, or 0 when either is missing. */
export function minutesBetween(start, end) {
  const a = Date.parse(start ?? "");
  const b = Date.parse(end ?? "");
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 60000 : 0;
}

const budgets = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ci-budgets.json"), "utf8"));
const { jobs } = await github(`/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`);
const done = jobs.filter((job) => job.status === "completed" && job.completed_at);
const rows = done.map((job) => ({ name: job.name, minutes: minutesBetween(job.started_at, job.completed_at) }));
const sum = rows.reduce((total, row) => total + row.minutes, 0);

console.log("### Runner minutes of this push\n");
console.log("| Job | Minutes |\n| --- | --- |");
for (const row of rows) console.log(`| ${row.name} | ${row.minutes.toFixed(1)} |`);
console.log(`| **Total** | **${sum.toFixed(1)}** |\n`);

// Optional: the install seconds of each job, from the timings artifacts (they may not be there yet, or the download may fail).
try {
  const installs = (await timingsOfRun(repository, runId)).filter((entry) => String(entry.label).startsWith("install-"));
  if (installs.length > 0) {
    console.log("| Install | Seconds |\n| --- | --- |");
    for (const entry of installs) console.log(`| ${entry.label} | ${entry.seconds} |`);
    console.log("");
  }
} catch {
  // Skipped silently.
}

const max = budgets.runnerMinutes?.max;
if (typeof max !== "number") {
  console.log("Runner minutes: no ceiling yet");
} else if (sum > max) {
  console.log(`Runner minutes: ${sum.toFixed(1)} is over the ceiling of ${max} (scripts/ci-budgets.json)`);
  console.error(`runner-minutes: ${sum.toFixed(1)} minutes, ceiling ${max} (scripts/ci-budgets.json): find the job that grew, or raise the ceiling with a reason in the commit message`);
  process.exit(1);
}
