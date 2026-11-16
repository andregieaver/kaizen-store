#!/usr/bin/env node
/**
 * Decides whether a push changes what is deployed (bloat review step 0.38, TC-14). A push that changes only tests is checked by
 * CI and not deployed: a test file cannot change the app that production runs. The answer is made against the commit production
 * reports at `/api/health`, not against the push's parent, so a tests-only push after a failed or skipped deploy still brings
 * production up to date, and two tests-only pushes in a row are both skipped.
 *
 *   PRODUCTION_URL  the site's address (default https://kaizenaflow.com)
 *   GITHUB_SHA      the commit being pushed
 *   GITHUB_OUTPUT   when set, `deploy=true` or `deploy=false` is appended to this file
 *
 * Any doubt means deploy: production's commit unknown, the files changed not listable, nothing changed. The script exits 0 always,
 * so a failure to decide never fails the job. It reads nothing secret and prints one line.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * What counts as a test: files that no deployed module imports and that the build does not read. Scripts, the workflow, package.json,
 * config, migrations and the docs portal's articles are not here: they change what is built, checked or deployed. src/test holds
 * only Vitest's setup files (vitest.config.mts), and no deployed module imports it.
 */
export const TEST_ONLY = [/\.test\.tsx?$/, /\.spec\.ts$/, /^e2e\//, /^e2e-live\//, /^test\//, /^src\/test\//];

/** True when the list is not empty and every path is a test. */
export function testsOnly(files) {
  return files.length > 0 && files.every((file) => TEST_ONLY.some((pattern) => pattern.test(file)));
}

/** Whether to deploy, and why: `reported` is the commit production runs (null when unknown), `files` the paths changed since it (null when unknown). */
export function deployNeeded({ files, reported }) {
  if (reported === null || reported === undefined) return { deploy: true, why: "production's commit is unknown" };
  if (files === null || files === undefined) return { deploy: true, why: "the files changed could not be listed" };
  if (testsOnly(files)) return { deploy: false, why: `only tests changed since ${reported}` };
  return { deploy: true, why: "code changed" };
}

async function reportedCommit(url) {
  try {
    const response = await fetch(`${url}/api/health`, { headers: { "Cache-Control": "no-store" }, signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    return typeof body.commit === "string" && /^[0-9a-f]{7,64}$/.test(body.commit) ? body.commit : null;
  } catch {
    return null;
  }
}

/** The paths that differ between two commits; null when git cannot say. Two commits are compared by their trees, so a shallow fetch of each is enough. */
function changedFiles(reported, head) {
  try {
    execFileSync("git", ["fetch", "--quiet", "--depth=1", "origin", reported], { stdio: "ignore" });
    const out = execFileSync("git", ["diff", "--name-only", reported, head], { encoding: "utf8" });
    return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  } catch {
    return null;
  }
}

async function main() {
  const url = (process.env.PRODUCTION_URL || "https://kaizenaflow.com").replace(/\/+$/, "");
  const head = process.env.GITHUB_SHA;
  const reported = await reportedCommit(url);
  // The same commit gives an empty list, which is not tests-only: the deploy is then a harmless repeat.
  const files = reported && head ? changedFiles(reported, head) : null;
  const { deploy, why } = deployNeeded({ files, reported });
  console.log(`Deploy: ${deploy ? "yes" : "no"} (${why})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${deploy}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
