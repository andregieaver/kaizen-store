#!/usr/bin/env node
// One recorder for every check and build (bloat review step 1.20, docs/ci-migrations.md):
//
//   node scripts/timed.mjs <label> [--warm-if=<path>] [--unit] [--playwright-report=<path>] -- <command...>
//
// It runs the command, prints its seconds (and adds a row to $GITHUB_STEP_SUMMARY and a JSON line to $TIMINGS_FILE), fails above the
// label's ceiling in scripts/ci-budgets.json, and exits with the command's own code. A failing command is reported and exits first, before any
// other check, so a failure can never turn green here: this gates production deploys.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { filesDiffer, overCeiling, parseVitestDuration, retriedTests, setupShareProblem } from "./lib/timed.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const head = split === -1 ? argv : argv.slice(0, split);
const command = split === -1 ? [] : argv.slice(split + 1);
const label = head.find((arg) => !arg.startsWith("--"));
const option = (name) => head.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const warmIf = option("warm-if");
const playwrightReport = option("playwright-report");
const unit = head.includes("--unit");

if (!label || command.length === 0) {
  console.error("usage: node scripts/timed.mjs <label> [--warm-if=<path>] [--unit] [--playwright-report=<path>] -- <command...>");
  process.exit(2);
}

const HEADER = "| Check | Run | Seconds | Ceiling |\n| --- | --- | --- | --- |";
const summary = (text, row = false) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    const first = row && !(existsSync(file) && readFileSync(file, "utf8").includes(HEADER));
    appendFileSync(file, `${first ? `${HEADER}\n` : ""}${text}\n`);
  } catch {
    // The summary is a convenience: a check never fails for it.
  }
};

// The test files vitest.config.mts includes (every src .test.ts but the .int.test.ts ones), as absolute paths.
function testFilesOnDisk() {
  const base = join(root, "src");
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".test.ts") && !file.endsWith(".int.test.ts") && !file.split(/[\\/]/).includes("node_modules"))
    .map((file) => join(base, file));
}

const warm = warmIf ? existsSync(resolve(warmIf)) : null;
const key = warmIf ? `${label}:${warm ? "warm" : "cold"}` : label;
const started = Date.now();
let captured = "";

const child = spawn(command[0], command.slice(1), {
  stdio: unit ? ["inherit", "pipe", "inherit"] : "inherit",
  shell: process.platform === "win32",
});
if (unit) {
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    captured += chunk.toString();
  });
}

let done = false;
function finish(code, signal, error) {
  if (done) return;
  done = true;
  const seconds = Math.round(((Date.now() - started) / 1000) * 10) / 10;
  let budgets = {};
  try {
    budgets = JSON.parse(readFileSync(join(root, "scripts", "ci-budgets.json"), "utf8"));
  } catch {
    // No budget file: nothing to hold the seconds against.
  }
  const ceiling = overCeiling(key, seconds, budgets);
  const ceilingText = ceiling ? `${ceiling.ceiling} s` : "no ceiling yet";
  const line = `timed: ${key} took ${seconds} s (${ceilingText})`;
  console.log(line);
  summary(`| ${label} | ${warmIf ? (warm ? "warm" : "cold") : ""} | ${seconds} | ${ceiling ? ceiling.ceiling : ""} |`, true);
  if (process.env.TIMINGS_FILE) {
    try {
      appendFileSync(
        process.env.TIMINGS_FILE,
        `${JSON.stringify({ label, key, seconds, sha: process.env.GITHUB_SHA ?? null, at: new Date().toISOString() })}\n`,
      );
    } catch {
      // As for the summary.
    }
  }

  // A command that did not succeed keeps its failure, before any other check.
  if (error) console.error(`timed: ${key} could not start (${error.message})`);
  if (error || signal || code !== 0) process.exit(error || signal ? 1 : (code ?? 1));

  const notes = [];
  if (unit) {
    const parsed = parseVitestDuration(captured);
    const share = setupShareProblem(parsed);
    if (share) notes.push(share);
    try {
      const report = JSON.parse(readFileSync(join(root, ".vitest-report.json"), "utf8"));
      const ran = (report.testResults ?? []).map((result) => relative(root, result.name));
      const { notRun, notOnDisk } = filesDiffer(ran, testFilesOnDisk().map((file) => relative(root, file)));
      if (notRun.length > 0 || notOnDisk.length > 0) {
        notes.push("Test files that did not run:");
        for (const file of notRun) notes.push(`- ${file} (on disk, not run)`);
        for (const file of notOnDisk) notes.push(`- ${file} (ran, not on disk)`);
      }
    } catch {
      notes.push("timed: no vitest report");
    }
  }
  if (playwrightReport) {
    try {
      const retried = retriedTests(JSON.parse(readFileSync(resolve(playwrightReport), "utf8")));
      if (retried.length > 0) {
        notes.push("Passed only on a retry:");
        for (const title of retried) notes.push(`- ${title}`);
      }
    } catch {
      notes.push("timed: no Playwright report");
    }
  }
  for (const note of notes) console.log(note);
  if (notes.length > 0) summary(`\n${notes.join("\n")}\n`);

  if (ceiling?.over) {
    console.error(
      `timed: ${key} took ${seconds} s, ceiling ${ceiling.ceiling} s (scripts/ci-budgets.json): find what got slower, or raise the ceiling with a reason in the commit message`,
    );
    process.exit(1);
  }
  process.exit(0);
}

child.on("error", (error) => finish(1, null, error));
child.on("close", (code, signal) => finish(code, signal, null));
