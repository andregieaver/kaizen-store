import { describe, expect, it } from "vitest";

import { deploymentBody, fallbackDecision, isDeploying } from "../../scripts/deploy-fallback.mjs";

/** A run that left its deploy to a newer run (D710) makes sure it happens (D741). */
describe("fallbackDecision", () => {
  it("is done once production includes the commit, whatever the newer runs do", () => {
    expect(fallbackDecision({ live: true, newerRuns: [{ status: "in_progress" }] })).toBe("done");
  });

  it("waits while a newer run is still going, since it may deploy", () => {
    expect(fallbackDecision({ live: false, newerRuns: [{ status: "completed", conclusion: "failure" }, { status: "queued" }] })).toBe("wait");
  });

  it("deploys this commit when every newer run has finished and none deployed it", () => {
    expect(fallbackDecision({ live: false, newerRuns: [{ status: "completed", conclusion: "failure" }] })).toBe("deploy");
    expect(fallbackDecision({ live: false, newerRuns: [{ status: "completed", conclusion: "success" }] })).toBe("deploy");
    expect(fallbackDecision({ live: false, newerRuns: [] })).toBe("deploy");
  });

  // D793: runs take about 30 minutes and pushes kept coming, so a newer run was always going and the wait ran out (19 November 2026).
  it("deploys this commit once the wait is over, though newer runs are still going", () => {
    expect(fallbackDecision({ live: false, newerRuns: [{ status: "in_progress", deploying: false }], waited: true })).toBe("deploy");
  });

  it("waits for a newer run that is deploying, even once the wait is over", () => {
    expect(fallbackDecision({ live: false, newerRuns: [{ status: "in_progress", deploying: true }], waited: true })).toBe("wait");
    expect(fallbackDecision({ live: true, newerRuns: [{ status: "in_progress", deploying: true }], waited: true })).toBe("done");
  });
});

describe("isDeploying", () => {
  it("is a pending or release job going, not one waiting in its own fallback, nor another job", () => {
    expect(isDeploying([{ name: "release", status: "in_progress", steps: [{ name: "Apply the migrations", status: "in_progress" }] }])).toBe(true);
    expect(isDeploying([{ name: "pending", status: "queued" }])).toBe(true);
    expect(isDeploying([{ name: "pending", status: "in_progress", steps: [{ name: "A newer run was to deploy, so make sure production gets this commit", status: "in_progress" }] }])).toBe(false);
    expect(isDeploying([{ name: "pending", status: "completed" }, { name: "e2e", status: "in_progress" }])).toBe(false);
    expect(isDeploying([])).toBe(false);
  });
});

describe("deploymentBody", () => {
  it("deploys exactly this commit of the repository to production, never the head of main", () => {
    expect(deploymentBody({ project: "kaizen-store", repository: "andregieaver/kaizen-store", sha: "abc123" })).toEqual({
      name: "kaizen-store",
      project: "kaizen-store",
      target: "production",
      gitSource: { type: "github", org: "andregieaver", repo: "kaizen-store", ref: "main", sha: "abc123" },
    });
  });
});
