import { describe, expect, it } from "vitest";

import { CHECK_JOBS, decide, failuresIn, fingerprint, report, sessionOf, suspects } from "../../scripts/main-health.mjs";

/** Lines as GitHub's job logs hold them: a timestamp, then the step's output with its colours. */
const log = (...lines: string[]) => lines.map((line) => `2026-11-19T13:21:20.1234567Z ${line}`).join("\n");

describe("failuresIn", () => {
  it("names Playwright's numbered failures once, however often the summary repeats them", () => {
    const text = log(
      "  1) [signed-in] › e2e/signed-in/theme-switch.spec.ts:168:5 › switches through every launch theme ",
      "    Error: expect(received).toEqual(expected) // deep equality",
      "  1 failed",
      "\x1b[31m  1) [signed-in] › e2e/signed-in/theme-switch.spec.ts:168:5 › switches through every launch theme \x1b[39m",
      "##[error]Process completed with exit code 1.",
    );
    expect(failuresIn(text)).toEqual(["[signed-in] › e2e/signed-in/theme-switch.spec.ts:168:5 › switches through every launch theme"]);
  });

  it("names Vitest's FAIL lines", () => {
    const text = log(
      " \x1b[31mFAIL\x1b[39m  src/server/analytics-visits.int.test.ts > recording a page view > limits the new rows one address can start",
      "AssertionError: expected { recorded: true } to deeply equal { recorded: false, reason: 'burst' }",
      "##[error]AssertionError: expected { recorded: true } to deeply equal { recorded: false, reason: 'burst' }",
    );
    expect(failuresIn(text)).toEqual(["src/server/analytics-visits.int.test.ts > recording a page view > limits the new rows one address can start"]);
  });

  it("falls back to what a failed step printed last, as a budget script's verdict", () => {
    const text = log(
      "##[group]Run node scripts/timed.mjs server-budget -- node scripts/server-budget.mjs",
      "##[endgroup]",
      "server-budget: large store home, cold sent 22 statements, over its max of 3. The ten most repeated:",
      "  3 x select id, kind from commerce.terms where store_id =",
      "    at main (file:///x/scripts/server-budget.mjs:10:3)",
      "##[error]Process completed with exit code 1.",
    );
    const found = failuresIn(text);
    expect(found[0]).toBe("server-budget: large store home, cold sent 22 statements, over its max of 3. The ten most repeated:");
    expect(found.some((line) => line.includes(" at main"))).toBe(false);
  });

  it("returns nothing for a log that names no failure", () => {
    expect(failuresIn(log("  710 passed (11.5m)"))).toEqual([]);
  });
});

describe("sessionOf and suspects", () => {
  const commit = (sha: string, message: string, parents = 1) => ({ sha, commit: { message }, parents: Array.from({ length: parents }, () => ({})) });

  it("reads the Claude-Session trailer and lists each session once, newest commit first, leaving merges out of the sessions", () => {
    expect(sessionOf("Fix\n\nCo-Authored-By: Claude\nClaude-Session: https://claude.ai/code/session_A")).toBe("https://claude.ai/code/session_A");
    expect(sessionOf("Decision D797 claimed: x")).toBeNull();
    const { list, sessions } = suspects([
      commit("a1", "First\n\nClaude-Session: https://claude.ai/code/session_A"),
      commit("b2", "Merge remote-tracking branch 'origin/main' into x\n\nClaude-Session: https://claude.ai/code/session_M", 2),
      commit("c3", "Second\n\nClaude-Session: https://claude.ai/code/session_B"),
      commit("d4", "Third\n\nClaude-Session: https://claude.ai/code/session_A"),
    ]);
    expect(list.map((c) => c.sha)).toEqual(["d4", "c3", "b2", "a1"]);
    expect(sessions).toEqual(["https://claude.ai/code/session_A", "https://claude.ai/code/session_B"]);
  });
});

describe("decide", () => {
  const run = (id: number, status = "completed") => ({ id, run_number: id, status });

  it("lets only the newest finished run speak for main", () => {
    const thisRun = run(10, "in_progress");
    expect(decide({ thisRun, failed: true, runs: [run(11, "in_progress"), thisRun, run(9)] })).toBe("update");
    expect(decide({ thisRun, failed: false, runs: [thisRun, run(9)] })).toBe("close");
    // A newer run already finished: an older run's result changes nothing, red or green.
    expect(decide({ thisRun, failed: false, runs: [run(11), thisRun] })).toBe("none");
    expect(decide({ thisRun, failed: true, runs: [run(11), thisRun] })).toBe("none");
  });
});

describe("the issue's words", () => {
  const failedJobs = [{ name: "integration (3)", html_url: "https://x/job/1", failures: ["src/a.int.test.ts > b"] }];

  it("names the run, the failing test, the range and its sessions", () => {
    const body = report({
      repository: "o/r",
      run: { run_number: 1677, html_url: "https://x/run" },
      sha: "30d4c6f9869d5f1d",
      failedJobs,
      green: { run_number: 1666, html_url: "https://x/green", head_sha: "56076aa5035938ba" },
      suspected: { list: [{ sha: "a067d25bef56", subject: "Server budget", session: "https://claude.ai/code/session_A", merge: false }], sessions: ["https://claude.ai/code/session_A"] },
    });
    expect(body).toContain("[run 1677](https://x/run) at `30d4c6f`");
    expect(body).toContain("`src/a.int.test.ts > b`");
    expect(body).toContain("[run 1666](https://x/green)");
    expect(body).toContain("- https://claude.ai/code/session_A");
  });

  it("keeps the same fingerprint for the same failures in another shard or with another random store name", () => {
    const again = [{ name: "integration (1)", html_url: "https://x/job/2", failures: ["src/a.int.test.ts > b"] }];
    expect(fingerprint(again)).toBe(fingerprint(failedJobs));
    const perf = (slug: string) => [{ name: "e2e", html_url: "", failures: [`cart: router requests /s/${slug}/cart`] }];
    expect(fingerprint(perf("betaling-mwnkr9ch"))).toBe(fingerprint(perf("betaling-mwnkrjqi")));
    expect(fingerprint(failedJobs)).not.toBe(fingerprint(perf("x")));
    expect(fingerprint(failedJobs)).toMatch(/^<!-- main-health: .* -->$/);
  });

  it("counts the checks, not the jobs that deploy or report", () => {
    for (const name of ["pending", "static", "audit", "integration (2)", "e2e", "hosts", "signed-in"]) expect(CHECK_JOBS.test(name)).toBe(true);
    for (const name of ["release", "timings", "main-health", "redeploy"]) expect(CHECK_JOBS.test(name)).toBe(false);
  });
});
