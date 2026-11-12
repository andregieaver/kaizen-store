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
 *   SMOKE_PAGES         the pages to request once production runs it, separated by commas, each a path or a full https:// address
 *                       (default `/,/s/demo/no`: Kaizena Flow's home and the template store's Norwegian front page)
 *
 * Once production runs it, the routes that answer outsiders are each called once without a token (`SMOKE_CHECKS`): each must refuse
 * with 401. A route whose module cannot load answers 500 to everyone on Vercel, where every function starts fresh, while a local server
 * that served other pages first loads it in another order and works (D440: the Admin API's import cycle); this is where that shows.
 * Then `SMOKE_PAGES` are requested, one after the other and each twice, and each must answer 200: the job, not a visitor, pays the
 * first draw of these pages, and the log shows each one's status, bytes and cache headers.
 *
 * It reads nothing secret and prints only commits, paths and statuses.
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

/** Routes for outsiders, called without a token after a deploy: each must answer with its refusal, never a 500. */
export const SMOKE_CHECKS = [
  { method: "GET", path: "/api/admin/v1/orders", expect: 401 },
  { method: "POST", path: "/api/mcp", expect: 401 },
];

/** The checks whose status was not the one expected, as `METHOD path: status (expected n)` lines; empty when all hold. */
export function smokeProblems(results) {
  return results.filter((r) => r.status !== r.expect).map((r) => `${r.method} ${r.path}: ${r.status ?? "no answer"} (expected ${r.expect})`);
}

async function smokeResults(url) {
  return Promise.all(
    SMOKE_CHECKS.map(async (check) => {
      try {
        const response = await fetch(`${url}${check.path}`, {
          method: check.method,
          headers: { "Cache-Control": "no-store", ...(check.method === "POST" ? { "Content-Type": "application/json" } : {}) },
          body: check.method === "POST" ? "{}" : undefined,
          signal: AbortSignal.timeout(15_000),
        });
        return { ...check, status: response.status };
      } catch {
        return { ...check, status: null };
      }
    }),
  );
}

/** The pages to request after a deploy, from the SMOKE_PAGES variable: paths or full https:// addresses, trimmed, empty ones dropped. */
export function smokePages(value) {
  const pages = (value ?? "")
    .split(",")
    .map((page) => page.trim())
    .filter((page) => page.length > 0);
  return pages.length > 0 ? pages : ["/", "/s/demo/no"];
}

/** The page requests whose status was not 200, as `GET address: status (expected 200)` lines; empty when all answered 200. */
export function pageProblems(results) {
  return results.filter((r) => r.status !== 200).map((r) => `GET ${r.address}: ${r.status ?? "no answer"} (expected 200)`);
}

/** One log line for a page request: status, bytes and the two cache headers. */
export function pageLine(result) {
  return `GET ${result.address}: ${result.status}, ${result.bytes} bytes, x-vercel-cache ${result.cache.vercel ?? "none"}, x-nextjs-cache ${result.cache.next ?? "none"}`;
}

/** Requests each page in turn (not at once, so the first request starts the proxy and the page function alone). No cookie, no token. */
async function pageResults(url, pages) {
  const results = [];
  for (const address of pages) {
    try {
      const response = await fetch(address.startsWith("/") ? `${url}${address}` : address, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "kaizena-flow-deploy-check" },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.arrayBuffer();
      results.push({
        address,
        status: response.status,
        bytes: body.byteLength,
        cache: { vercel: response.headers.get("x-vercel-cache"), next: response.headers.get("x-nextjs-cache") },
      });
    } catch {
      results.push({ address, status: null, bytes: 0, cache: { vercel: null, next: null } });
    }
  }
  return results;
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
      // Twice at most, a minute apart: a function still starting may answer late once.
      let problems = smokeProblems(await smokeResults(url));
      if (problems.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        problems = smokeProblems(await smokeResults(url));
      }
      if (problems.length > 0) {
        console.error(`Production runs the commit, but a route refuses no one as it should:\n${problems.join("\n")}`);
        process.exit(1);
      }
      console.log(`Each route for outsiders refuses a call without a token (${SMOKE_CHECKS.length}).`);
      const pages = smokePages(process.env.SMOKE_PAGES);
      let results = await pageResults(url, pages);
      if (pageProblems(results).length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        results = await pageResults(url, pages);
      }
      for (const result of results) console.log(pageLine(result));
      const pageIssues = pageProblems(results);
      if (pageIssues.length > 0) {
        console.error(`Production runs the commit, but a page does not answer 200:\n${pageIssues.join("\n")}`);
        process.exit(1);
      }
      console.log("Second request:");
      for (const result of await pageResults(url, pages)) console.log(pageLine(result));
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
