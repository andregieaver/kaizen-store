import { describe, expect, it } from "vitest";

import { deployVerdict, SMOKE_CHECKS, smokeProblems } from "../../scripts/await-deploy.mjs";

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

/** After the deploy, each route for outsiders is called without a token and must refuse it (D440: a route that cannot load answers 500). */
describe("smokeProblems", () => {
  it("names each route that did not refuse as it should, and nothing when all did", () => {
    expect(smokeProblems(SMOKE_CHECKS.map((c) => ({ ...c, status: c.expect })))).toEqual([]);
    expect(
      smokeProblems([
        { method: "GET", path: "/api/admin/v1/orders", expect: 401, status: 500 },
        { method: "POST", path: "/api/mcp", expect: 401, status: null },
      ]),
    ).toEqual(["GET /api/admin/v1/orders: 500 (expected 401)", "POST /api/mcp: no answer (expected 401)"]);
  });

  it("calls the Admin API and the MCP", () => {
    expect(SMOKE_CHECKS.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/admin/v1/orders", "POST /api/mcp"]);
  });
});
