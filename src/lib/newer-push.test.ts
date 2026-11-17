import { describe, expect, it } from "vitest";

import { newerPush, startsRun } from "../../scripts/newer-push.mjs";

/** A run whose commit is no longer the head leaves the deploy to the newer run (D710); any doubt means deploy as before. */
describe("startsRun", () => {
  it("follows ci.yml's push paths: words start no run, the docs portal's articles do", () => {
    expect(startsRun("docs/decisions.md")).toBe(false);
    expect(startsRun("docs/parity/rows.json")).toBe(false);
    expect(startsRun("README.md")).toBe(false);
    expect(startsRun("src/lib/notes.md")).toBe(false);
    expect(startsRun("content/docs/a.md")).toBe(true);
    expect(startsRun("next.config.ts")).toBe(true);
    expect(startsRun("src/lib/money.test.ts")).toBe(true);
  });
});

describe("newerPush", () => {
  const sha = "a".repeat(40);
  const head = "b".repeat(40);

  it("leaves the deploy to a newer push that starts its own run", () => {
    expect(newerPush({ sha, head, files: ["src/lib/money.ts"] }).newer).toBe(true);
    expect(newerPush({ sha, head, files: ["docs/decisions.md", "src/lib/money.test.ts"] }).newer).toBe(true);
  });

  it("deploys when this commit is the head, or newer commits change only words", () => {
    expect(newerPush({ sha, head: sha, files: [] }).newer).toBe(false);
    expect(newerPush({ sha, head, files: ["docs/decisions.md"] }).newer).toBe(false);
    expect(newerPush({ sha, head, files: [] }).newer).toBe(false);
  });

  it("deploys when in doubt", () => {
    expect(newerPush({ sha, head: undefined, files: null }).newer).toBe(false);
    expect(newerPush({ sha: undefined, head, files: null }).newer).toBe(false);
    expect(newerPush({ sha, head, files: null }).newer).toBe(false);
  });
});
