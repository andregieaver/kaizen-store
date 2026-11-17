#!/usr/bin/env node
/**
 * When a run leaves its deploy to a newer push's run (D710, `newer-push.mjs`), this makes sure the deploy happens (D741). On 17 November
 * 2026 run 1544 passed, applied its migrations and left the deploy to run 1545, which failed: nothing deployed for hours and nothing said so.
 *
 * It waits, reading what production runs (`/api/health`) and CI's newer push runs on main:
 *   - production runs this commit, or a later one that includes it: done;
 *   - a newer run is still going: wait (it may deploy);
 *   - every newer run has finished and production still lacks this commit: deploy THIS commit, which passed every check, through Vercel's
 *     API (`gitSource` with its sha; the deploy hook would build the head of main, the newer code that failed), then wait for it to be live.
 * Without `VERCEL_TOKEN` it fails the job, saying what to do, so the gap is never silent.
 *
 *   GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_RUN_ID  from Actions
 *   PRODUCTION_URL          the site (default https://kaizenaflow.com)
 *   VERCEL_TOKEN            a Vercel token able to create deployments (a secret; optional)
 *   VERCEL_PROJECT          default kaizen-store
 *   VERCEL_TEAM_ID          default team_ZYCx8tB4iwp6cBCeHKPTAjj8
 *   FALLBACK_WAIT_SECONDS   how long to wait for a decision (default 2400)
 *   GITHUB_OUTPUT           `deployed=true` is appended when this run deployed its commit
 *
 * Prints only commits, run numbers and statuses.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * What to do now: `done` when production includes this commit; `wait` while any newer run is not finished; `deploy` when every newer run
 * has finished and production still lacks it. Pure.
 */
export function fallbackDecision({ live, newerRuns }) {
  if (live) return "done";
  if (newerRuns.some((r) => r.status !== "completed")) return "wait";
  return "deploy";
}

/** Vercel's create-deployment body for one commit of the GitHub repository, to production. Pure. */
export function deploymentBody({ project, repository, sha }) {
  const [org, repo] = repository.split("/");
  return { name: project, project, target: "production", gitSource: { type: "github", org, repo, ref: "main", sha } };
}

async function json(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const sha = process.env.GITHUB_SHA;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const runId = Number(process.env.GITHUB_RUN_ID);
  const site = (process.env.PRODUCTION_URL || "https://kaizenaflow.com").replace(/\/$/, "");
  const waitSeconds = Number(process.env.FALLBACK_WAIT_SECONDS || 2400);
  if (!sha || !repository || !token) {
    console.log("Not in Actions: nothing to do.");
    return;
  }
  const gh = (path) => json(`https://api.github.com/repos/${repository}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });

  /** Whether production runs this commit or a later one that includes it. */
  async function isLive() {
    const health = await json(`${site}/api/health`).catch(() => null);
    const reported = health?.body?.commit;
    if (typeof reported !== "string" || reported.length < 7) return { live: false, reported: null };
    if (reported === sha) return { live: true, reported };
    const compared = await gh(`/compare/${sha}...${reported}`).catch(() => null);
    const status = compared?.body?.status;
    return { live: status === "ahead" || status === "identical", reported };
  }

  /** CI's push runs on main started after this one. */
  async function newerRuns() {
    const runs = await gh(`/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20`);
    const list = Array.isArray(runs.body?.workflow_runs) ? runs.body.workflow_runs : [];
    const mine = list.find((r) => r.id === runId);
    const after = mine ? mine.run_number : Number.POSITIVE_INFINITY;
    return list.filter((r) => r.run_number > after).map((r) => ({ number: r.run_number, status: r.status, conclusion: r.conclusion }));
  }

  const until = Date.now() + waitSeconds * 1000;
  let decision = "wait";
  while (Date.now() < until) {
    const { live, reported } = await isLive();
    const newer = await newerRuns();
    decision = fallbackDecision({ live, newerRuns: newer });
    console.log(`Production runs ${reported?.slice(0, 8) ?? "?"}; newer runs ${newer.map((r) => `${r.number} ${r.conclusion ?? r.status}`).join(", ") || "none"}: ${decision}`);
    if (decision !== "wait") break;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  if (decision === "done") return;
  if (decision === "wait") {
    console.error(`::error::After ${waitSeconds} s the newer runs had not finished and production still lacks ${sha.slice(0, 8)}. Deploy it with the CI workflow's redeploy input once main passes.`);
    process.exit(1);
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    console.error(`::error::Every newer run finished and none deployed ${sha.slice(0, 8)}, which passed every check. Add the secret VERCEL_TOKEN so CI deploys this commit itself, or run the CI workflow with redeploy once main passes.`);
    process.exit(1);
  }
  const project = process.env.VERCEL_PROJECT || "kaizen-store";
  const team = process.env.VERCEL_TEAM_ID || "team_ZYCx8tB4iwp6cBCeHKPTAjj8";
  const made = await json(`https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(team)}&forceNew=1&skipAutoDetectionConfirmation=1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(deploymentBody({ project, repository, sha })),
  });
  if (!made.ok) {
    console.error(`::error::Vercel refused the deployment of ${sha.slice(0, 8)} (${made.status}: ${made.body?.error?.message ?? "no message"}).`);
    process.exit(1);
  }
  console.log(`Asked Vercel to deploy ${sha.slice(0, 8)} to production (deployment ${made.body?.id ?? "?"}).`);
  // The next step waits until production runs it and checks its pages (`await-deploy.mjs`), as after the hook.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "deployed=true\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
