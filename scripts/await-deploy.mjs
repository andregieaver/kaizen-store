#!/usr/bin/env node
/**
 * Waits for production to run the pushed commit (wave 11 unit J, D389; PSI 2026-10-28's first finding: production was 56 commits behind
 * while CI was green). After CI asks Vercel's deploy hook for a deployment, this reads `/api/health` (its `commit` is the deployment's
 * `VERCEL_GIT_COMMIT_SHA`) until production reports the commit, or a later one that includes it (another push deployed after this one),
 * and fails the job, saying what production reports, when it does not within the time.
 *
 *   PRODUCTION_URL      the site's address (default https://kaizenaflow.com)
 *   EXPECTED_COMMIT     the commit to wait for (default GITHUB_SHA)
 *   DEPLOY_WAIT_SECONDS how long to wait (default 1200)
 *
 * It reads nothing secret and prints only commits and states.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** What a health answer says of the commit: `live` (it, or a later one that includes it), else `waiting`. */
export function deployVerdict(expected, reported, includes) {
  if (!reported || typeof reported !== "string") return "waiting";
  if (reported === expected) return "live";
  return includes(expected, reported) ? "live" : "waiting";
}

/** Whether `later` includes `commit` in its history, from the repository's own history (fetched once if it is too shallow to tell). */
function includesWith(cwd) {
  let fetched = false;
  return (commit, later) => {
    const ask = () => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", commit, later], { cwd, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    if (ask()) return true;
    if (fetched) return false;
    fetched = true;
    try {
      execFileSync("git", ["fetch", "--quiet", "--depth=200", "origin", "main"], { cwd, stdio: "ignore" });
    } catch {
      return false;
    }
    return ask();
  };
}

async function reportedCommit(url) {
  try {
    const response = await fetch(`${url}/api/health`, { headers: { "Cache-Control": "no-store" }, signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    return typeof body.commit === "string" ? body.commit : null;
  } catch {
    return null;
  }
}

async function main() {
  const url = (process.env.PRODUCTION_URL || "https://kaizenaflow.com").replace(/\/+$/, "");
  const expected = process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA;
  if (!expected) {
    console.error("No commit to wait for: set EXPECTED_COMMIT or GITHUB_SHA.");
    process.exit(1);
  }
  const waitSeconds = Number(process.env.DEPLOY_WAIT_SECONDS || 1200);
  const includes = includesWith(process.cwd());
  const until = Date.now() + waitSeconds * 1000;
  let last = null;
  while (Date.now() < until) {
    last = await reportedCommit(url);
    if (deployVerdict(expected, last, includes) === "live") {
      console.log(last === expected ? `Production runs ${expected}.` : `Production runs ${last}, which includes ${expected}.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  console.error(
    `Production did not report ${expected} within ${Math.round(waitSeconds / 60)} minutes; it reports ${last ?? "nothing (no answer)"}. ` +
      "The deploy hook was asked: look at the deployment in Vercel.",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
