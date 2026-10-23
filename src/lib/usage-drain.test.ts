import { describe, expect, it } from "vitest";

import { parseDrainBody, slugInPath, trafficTotals } from "./usage-drain";

const entry = (over: Record<string, unknown> = {}, proxy: Record<string, unknown> = {}) => ({
  id: `id-${Math.random()}`,
  source: "lambda",
  environment: "production",
  requestId: "r1",
  timestamp: Date.UTC(2026, 9, 23, 12),
  proxy: { timestamp: Date.UTC(2026, 9, 23, 12), method: "GET", host: "shop.kaizenstore.site", path: "/no/home?token=secret", statusCode: 200, clientIp: "120.75.16.101", userAgent: ["Mozilla/5.0"], referer: "https://elsewhere.example", ...proxy },
  ...over,
});

const stores = (host: string, path: string) => (host === "shop.kaizenstore.site" ? "store-1" : host === "kaizenaflow.com" ? (slugInPath(path) === "demo" ? "store-2" : null) : undefined);

describe("parseDrainBody", () => {
  it("reads a JSON array and NDJSON, and leaves out build lines and other environments", () => {
    const array = JSON.stringify([entry(), { id: "b", source: "build", host: "x", timestamp: 1 }, entry({ environment: "preview", requestId: "r9" })]);
    expect(parseDrainBody(array)).toHaveLength(1);
    const ndjson = [entry(), entry({ requestId: "r2" })].map((e) => JSON.stringify(e)).join("\n") + "\nnot json";
    expect(parseDrainBody(ndjson)).toHaveLength(2);
    expect(parseDrainBody("")).toEqual([]);
  });

  it("keeps nothing of the visitor", () => {
    const [read] = parseDrainBody(JSON.stringify([entry()]));
    expect(Object.keys(read).sort()).toEqual(["at", "host", "path", "request", "status"]);
    expect(JSON.stringify(read)).not.toMatch(/120\.75|Mozilla|elsewhere/);
  });
});

describe("trafficTotals", () => {
  it("counts a request once however many lines it logged, and 5xx as errors", () => {
    const entries = parseDrainBody(JSON.stringify([entry(), entry(), entry({ requestId: "r2" }, { statusCode: 503 }), entry({ requestId: "r3" }, { statusCode: 404 })]));
    const { totals } = trafficTotals(entries, stores);
    expect(totals).toEqual([{ storeId: "store-1", day: "2026-10-23", requests: 3, serverErrors: 1, estimated: false }]);
  });

  it("finds a store under /s/ on Kaizena Flow's host, gives the rest of that host to no store, and drops unknown hosts", () => {
    const entries = parseDrainBody(
      JSON.stringify([
        entry({ requestId: "a" }, { host: "kaizenaflow.com", path: "/s/demo/no" }),
        entry({ requestId: "b" }, { host: "kaizenaflow.com", path: "/themes" }),
        entry({ requestId: "c" }, { host: "unknown.example" }),
      ]),
    );
    const { totals, unknownHosts } = trafficTotals(entries, stores);
    expect(totals.map((t) => [t.storeId, t.requests])).toEqual([["store-2", 1], [null, 1]]);
    expect(unknownHosts).toBe(1);
    expect(JSON.stringify(totals)).not.toMatch(/\/s\/|themes|token/);
  });

  it("scales a sample and marks it estimated", () => {
    const entries = parseDrainBody(JSON.stringify([entry({ requestId: "a" }), entry({ requestId: "b" })]));
    expect(trafficTotals(entries, stores, 0.5).totals[0]).toMatchObject({ requests: 4, estimated: true });
  });

  it("splits days in UTC", () => {
    const late = Date.UTC(2026, 9, 23, 23, 59);
    const entries = parseDrainBody(JSON.stringify([entry({ requestId: "a" }, { timestamp: late }), entry({ requestId: "b" }, { timestamp: late + 2 * 60_000 })]));
    expect(trafficTotals(entries, stores).totals.map((t) => t.day)).toEqual(["2026-10-23", "2026-10-24"]);
  });
});

describe("slugInPath", () => {
  it("reads only a store's slug", () => {
    expect(slugInPath("/s/demo")).toBe("demo");
    expect(slugInPath("/s/demo/no/products?x=1")).toBe("demo");
    expect(slugInPath("/themes/s/demo")).toBeNull();
  });
});
