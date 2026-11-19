#!/usr/bin/env node
/**
 * When a run leaves its deploy to a newer push's run (D710, `newer-push.mjs`), this makes sure the deploy happens (D741). On 17 November
 * 2026 run 1544 passed, applied its migrations and left the deploy to run 1545, which failed: nothing deployed for hours and nothing said so.
 *
 * It waits, reading what production runs (`/api/health`) and CI's newer push runs on main:
 *   - production runs this commit, or a later one that includes it: done;
 *   - a newer run's deploying job (`pending` or `release`, past its own wait) is going: wait, however long it takes (up to `GRACE_SECONDS`
 *     past the wait), as it is about to put out code that includes this commit;
 *   - a newer run is still going: wait (it may deploy), until `FALLBACK_WAIT_SECONDS`;
 *   - every newer run has finished, or the wait is over, and production still lacks this commit: deploy THIS commit through Vercel's API
 *     (`gitSource` with its sha; the deploy hook would build the head of main, the newer code that failed), then wait for it to be live.
 * D793: until 19 November 2026 the wait running out failed the job (runs 44492850303 and 44506837136), leaving production's code behind
 * migrations already applied while pushes kept coming, as a run takes about 30 minutes and a newer one was always going. A release has
 * passed every check and applied its files, so its code goes out rather than wait for newer runs without end.
 * Without `VERCEL_TOKEN` it fails the job, saying what to do, so the gap is never silent.
 *
 *   GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_RUN_ID  from Actions
 *   PRODUCTION_URL          the site (default https://kaizenaflow.com)
 *   VERCEL_TOKEN            a Vercel token able to create deployments (a secret; optional)
 *   VERCEL_PROJECT          default kaizen-store
 *   VERCEL_TEAM_ID          default team_ZYCx8tB4iwp6cBCeHKPTAjj8
 *   FALLBACK_WAIT_SECONDS   how long to wait for newer runs (default 2400)
 *   GRACE_SECONDS           how much longer to wait while a newer run is deploying (default 600)
 *   GITHUB_OUTPUT           `deployed=true` is appended when this run deployed its commit
 *
 * Prints only commits, run numbers and statuses.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * What to do now: `done` when production includes this commit; `wait` while a newer run is deploying, or, until the wait is over, while
 * any newer run is not finished; `deploy` otherwise. Pure.
 */
export function fallbackDecision({ live, newerRuns, waited = false }) {
  if (live) return "done";
  if (newerRuns.some((r) => r.deploying)) return "wait";
  if (!waited && newerRuns.some((r) => r.status !== "completed")) return "wait";
  return "deploy";
}

/** The fallback's own step: a job in it is waiting on others, not deploying. */
export const FALLBACK_STEP = "A newer run was to deploy";

/** Whether one of a run's jobs is putting code out now: `pending` or `release` going, and not in its own fallback wait. Pure. */
export function isDeploying(jobs) {
  return jobs.some(
    (j) =>
      (j.name === "pending" || j.name === "release") &&
      j.status !== "completed" &&
      !(j.steps ?? []).some((s) => s.status === "in_progress" && String(s.name).startsWith(FALLBACK_STEP)),
  );
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
  const graceSeconds = Number(process.env.GRACE_SECONDS || 600);
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
    const newer = list.filter((r) => r.run_number > after);
    return Promise.all(
      newer.map(async (r) => {
        const jobs = r.status === "completed" ? null : await gh(`/actions/runs/${r.id}/jobs?per_page=50`).catch(() => null);
        const list = Array.isArray(jobs?.body?.jobs) ? jobs.body.jobs : [];
        return { number: r.run_number, status: r.status, conclusion: r.conclusion, deploying: isDeploying(list) };
      }),
    );
  }

  const until = Date.now() + waitSeconds * 1000;
  const last = until + graceSeconds * 1000;
  let decision = "wait";
  while (Date.now() < last) {
    const { live, reported } = await isLive();
    const newer = await newerRuns();
    decision = fallbackDecision({ live, newerRuns: newer, waited: Date.now() >= until });
    console.log(
      `Production runs ${reported?.slice(0, 8) ?? "?"}; newer runs ${newer.map((r) => `${r.number} ${r.deploying ? "deploying" : (r.conclusion ?? r.status)}`).join(", ") || "none"}: ${decision}`,
    );
    if (decision !== "wait") break;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  if (decision === "done") return;
  if (decision === "wait") {
    console.error(`::error::A newer run was still deploying after ${waitSeconds + graceSeconds} s and production still lacks ${sha.slice(0, 8)}. Deploy it with the CI workflow's redeploy input.`);
    process.exit(1);
  }
  // A last look: a newer run may have put this commit out while the newer runs were read.
  if ((await isLive()).live) return;

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    console.error(`::error::No newer run deployed ${sha.slice(0, 8)}, which passed its checks. Add the secret VERCEL_TOKEN so CI deploys this commit itself, or run the CI workflow with redeploy once main passes.`);
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
