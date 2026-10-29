import { describe, expect, it } from "vitest";

import { deployVerdict } from "../../scripts/await-deploy.mjs";

/** CI's wait for production to run a pushed commit (D389): the commit itself, or a later deployment that includes it, is live. */
describe("deployVerdict", () => {
  const history: Record<string, string[]> = { later: ["mine", "earlier"], mine: ["earlier"] };
  const includes = (commit: string, later: string) => (history[later] ?? []).includes(commit);

  it("is live when production reports the commit, or one that includes it", () => {
    expect(deployVerdict("mine", "mine", includes)).toBe("live");
    expect(deployVerdict("mine", "later", includes)).toBe("live");
  });

  it("waits while production reports an older commit, another branch's, or nothing", () => {
    expect(deployVerdict("mine", "earlier", includes)).toBe("waiting");
    expect(deployVerdict("mine", "elsewhere", includes)).toBe("waiting");
    expect(deployVerdict("mine", null, includes)).toBe("waiting");
  });
});
