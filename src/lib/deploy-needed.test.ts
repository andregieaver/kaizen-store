import { describe, expect, it } from "vitest";

import { deployNeeded, testsOnly } from "../../scripts/deploy-needed.mjs";

/** A push that changes only tests is checked but not deployed (bloat review step 0.38); any doubt means deploy. */
describe("testsOnly", () => {
  it("is true when every path is a test", () => {
    expect(testsOnly(["src/lib/money.test.ts", "e2e/search.spec.ts", "src/test/admin-english.ts"])).toBe(true);
    expect(testsOnly(["src/components/a.test.tsx", "e2e-live/a.spec.ts", "test/x.ts"])).toBe(true);
  });

  it("is false for no files, and when one path is not a test", () => {
    expect(testsOnly([])).toBe(false);
    expect(testsOnly(["src/lib/money.test.ts", "src/lib/money.ts"])).toBe(false);
  });

  it("does not count what changes what is built, checked or deployed", () => {
    for (const file of [
      "scripts/next-build.mjs",
      ".github/workflows/ci.yml",
      "package.json",
      "vitest.config.mts",
      "playwright.config.ts",
      "supabase/migrations/x.sql",
      "content/docs/a.md",
    ]) {
      expect(testsOnly([file]), file).toBe(false);
    }
  });
});

describe("deployNeeded", () => {
  it("deploys when production's commit or the files changed are unknown", () => {
    expect(deployNeeded({ files: null, reported: "abc" }).deploy).toBe(true);
    expect(deployNeeded({ files: ["a.test.ts"], reported: null })).toEqual({ deploy: true, why: "production's commit is unknown" });
    expect(deployNeeded({ files: null, reported: null }).deploy).toBe(true);
  });

  it("does not deploy when only tests changed since the commit production runs", () => {
    expect(deployNeeded({ files: ["a.test.ts"], reported: "abc" })).toEqual({ deploy: false, why: "only tests changed since abc" });
  });

  it("deploys when code changed, and when nothing changed (the same commit)", () => {
    expect(deployNeeded({ files: ["a.test.ts", "src/a.ts"], reported: "abc" })).toEqual({ deploy: true, why: "code changed" });
    expect(deployNeeded({ files: [], reported: "abc" }).deploy).toBe(true);
  });
});
