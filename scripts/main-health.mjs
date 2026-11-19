#!/usr/bin/env node
// Who turned main red, and is it green again (D-number in the commit that added it; docs/ci-migrations.md "When main is red").
//
// Runs as the last job of every CI run on main. Many sessions push to main at once and a run takes about 30 minutes, so a broken
// commit is usually buried under other sessions' pushes by the time its run fails, and every later run fails with it. This job keeps
// one open GitHub issue labelled `ci-red` that says, for the newest finished run: which checks failed, which tests (read from the
// failed jobs' logs), and the commits since the last green run with the Claude session that wrote each (its `Claude-Session:` trailer).
// A session checks that issue after its push (and before starting new work on top of a red main); the owner gets GitHub's notice.
// When the newest finished run is green, the issue is closed with a comment. An older run that finishes after a newer one changes
// nothing but its own step summary, so the issue always speaks for the newest run.
//
// Needs GH_TOKEN (actions: read, issues: write), GITHUB_REPOSITORY, GITHUB_RUN_ID. Writes Markdown on stdout for $GITHUB_STEP_SUMMARY.
// Never fails the run: a problem talking to GitHub is printed and the job passes (the checks themselves are the gate).
import { pathToFileURL } from "node:url";

import { headers } from "./lib/ci-timings.mjs";

const API = "https://api.github.com";
export const LABEL = "ci-red";
/** The jobs whose failure makes main red; `release` (deploys) and `timings` (reports) are not checks. */
export const CHECK_JOBS = /^(pending|static|audit|integration( \(\d+\))?|e2e|hosts|signed-in)$/;
const BAD = new Set(["failure", "timed_out", "cancelled", "startup_failure"]);

/** A log line without GitHub's timestamp and without terminal colours. */
export const clean = (line) =>
  line
    .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trimEnd();

/**
 * The failing tests a job's log names: Playwright's numbered failures (`  1) [chromium] › e2e/x.spec.ts:12:3 › title`), Vitest's
 * ` FAIL  file > test` lines, and otherwise the last words a failed step printed before `##[error]Process completed` (a budget
 * script's verdict, a type error). At most `max` lines, each at most 300 characters, without duplicates.
 */
export function failuresIn(log, max = 12) {
  const lines = log.split("\n").map(clean);
  const found = [];
  const add = (text) => {
    const short = text.trim().slice(0, 300);
    if (short && !found.includes(short)) found.push(short);
  };
  for (const line of lines) {
    const pw = /^\s+\d+\) (\[[^\]]+\] › .+)$/.exec(line);
    if (pw) add(pw[1]);
    const vt = /^ FAIL {2}(.+)$/.exec(line);
    if (vt) add(vt[1]);
  }
  if (found.length === 0) {
    lines.forEach((line, index) => {
      if (!line.startsWith("##[error]Process completed")) return;
      // The step's last meaningful lines: skip GitHub's own group markers, blank lines and Node's stack frames.
      const before = lines.slice(Math.max(0, index - 40), index).filter((l) => l.trim() && !l.startsWith("##[") && !/^\s+at /.test(l));
      for (const l of before.slice(-3)) add(l);
    });
    for (const line of lines) {
      const error = /^##\[error\](?!Process completed)(.+)$/.exec(line);
      if (error) add(error[1]);
    }
  }
  return found.slice(0, max);
}

/** The session URL of a commit message's `Claude-Session:` trailer, or null for a commit no session signed. */
export function sessionOf(message) {
  const match = /^Claude-Session:\s*(https:\/\/\S+)/m.exec(message ?? "");
  return match ? match[1] : null;
}

/** The commits since the last green run, newest first, each with its subject and session, and the distinct sessions among them. */
export function suspects(commits) {
  const list = [...commits].reverse().map((c) => ({
    sha: c.sha,
    subject: String(c.commit?.message ?? "").split("\n")[0],
    session: sessionOf(c.commit?.message),
    merge: (c.parents?.length ?? 1) > 1,
  }));
  const sessions = [...new Set(list.filter((c) => !c.merge && c.session).map((c) => c.session))];
  return { list, sessions };
}

/**
 * What to do with the issue: the newest finished run speaks for main. `thisRun` and `runs` carry { id, run_number, status }.
 * Returns "update" (this run failed and is the newest finished one), "close" (it passed and is the newest finished one), or "none".
 */
export function decide({ thisRun, failed, runs }) {
  const newerFinished = runs.some((r) => r.id !== thisRun.id && r.status === "completed" && r.run_number > thisRun.run_number);
  if (newerFinished) return "none";
  return failed ? "update" : "close";
}

/** The failures' fingerprint, kept in the issue's body: a new comment (and GitHub's notice) only when what fails changes. */
export const fingerprint = (failedJobs) =>
  `<!-- main-health: ${failedJobs
    .map((j) => `${j.name.replace(/ \(\d+\)$/, "")}=${j.failures.map((f) => f.replace(/\b[a-z]+-[a-z0-9]{8}\b/g, "")).join("|")}`)
    .sort()
    .join(";")
    .replace(/--/g, "-")} -->`;

/** The issue's body (and the comment for a new red run): the run, what failed, and who to ask. */
export function report({ repository, run, sha, failedJobs, green, suspected }) {
  const short = (s) => s.slice(0, 7);
  const out = [];
  out.push(`**Main is red** in [run ${run.run_number}](${run.html_url}) at \`${short(sha)}\` (${new Date().toISOString().slice(0, 16)}Z).`, "");
  out.push("### What failed", "");
  for (const job of failedJobs) {
    out.push(`- **${job.name}** ([log](${job.html_url}))`);
    for (const test of job.failures) out.push(`  - \`${test.replace(/`/g, "'")}\``);
    if (job.failures.length === 0) out.push("  - (no test named in the log: open it)");
  }
  out.push("");
  if (green) {
    out.push(`### Commits since the last green run ([run ${green.run_number}](${green.html_url}), \`${short(green.head_sha)}\`)`, "");
    for (const c of suspected.list.slice(0, 40)) {
      out.push(`- [\`${short(c.sha)}\`](https://github.com/${repository}/commit/${c.sha}) ${c.subject.replace(/[<>]/g, "")}${c.session ? ` (${c.session})` : ""}${c.merge ? " (merge)" : ""}`);
    }
    if (suspected.list.length > 40) out.push(`- … and ${suspected.list.length - 40} more`);
    out.push("");
    out.push("### Sessions with a commit in that range", "");
    for (const s of suspected.sessions) out.push(`- ${s}`);
    if (suspected.sessions.length === 0) out.push("- (none signed)");
  } else {
    out.push("No green run was found among the last ones on main, so no range of commits is named.");
  }
  out.push(
    "",
    "### What to do",
    "",
    "- A session listed above whose change touches a failing test fixes it (or reverts its commit) before it pushes anything else, and says so in a comment here.",
    "- A failing test that has nothing to do with any commit in the range is a flake: fix the test so it cannot fail that way (a fixed clock, a wait on the real condition), never skip or retry it into green.",
    "- This issue closes itself when the newest finished run on main is green.",
  );
  return out.join("\n");
}

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.status === 204 ? null : response.json();
}

async function jobLog(repository, jobId) {
  // The API answers with a redirect to a signed URL; fetch drops the token on the way (another origin).
  const response = await fetch(`${API}/repos/${repository}/actions/jobs/${jobId}/logs`, { headers: headers(), signal: AbortSignal.timeout(60_000) });
  return response.ok ? response.text() : "";
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!repository || !runId) {
    console.error("main-health: GITHUB_REPOSITORY and GITHUB_RUN_ID are needed");
    return;
  }
  const run = await api(`/repos/${repository}/actions/runs/${runId}`);
  const { jobs } = await api(`/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`);
  const checks = jobs.filter((job) => CHECK_JOBS.test(job.name));
  const failedJobs = [];
  for (const job of checks.filter((j) => BAD.has(j.conclusion))) {
    failedJobs.push({ name: job.name, html_url: job.html_url, failures: failuresIn(await jobLog(repository, job.id)) });
  }
  const failed = failedJobs.length > 0;

  const { workflow_runs: runs } = await api(`/repos/${repository}/actions/workflows/${run.workflow_id}/runs?branch=main&event=push&per_page=40`);
  const action = decide({ thisRun: run, failed, runs });

  console.log(`### Main's health\n`);
  console.log(failed ? `This run failed: ${failedJobs.map((j) => j.name).join(", ")}.` : "Every check of this run passed.");
  if (action === "none") {
    console.log("\nA newer run on main has already finished, so the `ci-red` issue speaks for that one and is left as it is.");
    return;
  }

  const [open] = await api(`/repos/${repository}/issues?labels=${LABEL}&state=open&per_page=1`);
  if (action === "close") {
    if (open) {
      await api(`/repos/${repository}/issues/${open.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `Green again: [run ${run.run_number}](${run.html_url}) at \`${run.head_sha.slice(0, 7)}\` passed every check.` }),
      });
      await api(`/repos/${repository}/issues/${open.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
      console.log(`\nClosed #${open.number}: main is green.`);
    }
    return;
  }

  const green = runs.find((r) => r.status === "completed" && r.conclusion === "success" && r.run_number < run.run_number) ?? null;
  const compared = green ? await api(`/repos/${repository}/compare/${green.head_sha}...${run.head_sha}?per_page=100`) : { commits: [] };
  const mark = fingerprint(failedJobs);
  const body = `${report({ repository, run, sha: run.head_sha, failedJobs, green, suspected: suspects(compared.commits ?? []) })}\n\n${mark}`;
  const title = `Main is red: ${failedJobs.map((j) => j.name).join(", ")} (run ${run.run_number})`;
  if (open) {
    await api(`/repos/${repository}/issues/${open.number}`, { method: "PATCH", body: JSON.stringify({ title, body }) });
    // The same failures as the issue already names: the body follows the newest run, with no new comment.
    if (!String(open.body ?? "").includes(mark)) {
      await api(`/repos/${repository}/issues/${open.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    }
    console.log(`\nUpdated #${open.number}.`);
  } else {
    await api(`/repos/${repository}/labels`, {
      method: "POST",
      body: JSON.stringify({ name: LABEL, color: "d73a4a", description: "CI on main is failing (kept by scripts/main-health.mjs)" }),
    }).catch(() => {}); // There already.
    const issue = await api(`/repos/${repository}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels: [LABEL] }) });
    console.log(`\nOpened #${issue.number}.`);
  }
  console.log(`\n${body}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.log(`main-health could not report: ${error.message}`);
  });
}
