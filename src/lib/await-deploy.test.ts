import { describe, expect, it } from "vitest";

import { deployVerdict, pageLine, pageProblems, SMOKE_CHECKS, smokePages, smokeProblems } from "../../scripts/await-deploy.mjs";

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

/** After the routes, the job itself requests the pages a visitor would meet first, and each must answer 200. */
describe("page checks", () => {
  const none = { vercel: null, next: null };

  it("requests Kaizena Flow's home and the template store's front page unless SMOKE_PAGES says otherwise", () => {
    expect(smokePages(undefined)).toEqual(["/", "/s/demo/no"]);
    expect(smokePages("")).toEqual(["/", "/s/demo/no"]);
    expect(smokePages(" /, /s/demo/no ,https://example.com/x ,")).toEqual(["/", "/s/demo/no", "https://example.com/x"]);
  });

  it("names each page that did not answer 200, and nothing when all did", () => {
    expect(
      pageProblems([
        { address: "/", status: 200, bytes: 10, cache: none },
        { address: "/s/demo/no", status: 200, bytes: 10, cache: none },
      ]),
    ).toEqual([]);
    expect(
      pageProblems([
        { address: "/", status: 500, bytes: 0, cache: none },
        { address: "/s/demo/no", status: null, bytes: 0, cache: none },
      ]),
    ).toEqual(["GET /: 500 (expected 200)", "GET /s/demo/no: no answer (expected 200)"]);
  });

  it("writes one log line with status, bytes and the cache headers", () => {
    expect(pageLine({ address: "/", status: 200, bytes: 48213, cache: { vercel: "HIT", next: null } })).toBe(
      "GET /: 200, 48213 bytes, x-vercel-cache HIT, x-nextjs-cache none",
    );
  });
});
