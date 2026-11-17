import { describe, expect, it } from "vitest";

import { deploymentBody, fallbackDecision } from "../../scripts/deploy-fallback.mjs";

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
