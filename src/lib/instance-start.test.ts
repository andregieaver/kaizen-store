import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { INSTANCE_KINDS, coldStartRows, instanceStartFields, type InstanceKind } from "./instance-start";

const helper = readFileSync("src/server/instance-start.ts", "utf8");

describe("a cold start's line and row (bloat review step 1.16)", () => {
  it("has five fields and nothing else, each a number, a kind or null", () => {
    const fields = instanceStartFields("beacon", { registerMs: 812.4, firstMs: 1500.6, rssBytes: 300 * 1048576, uiBytes: 4096 });
    expect(Object.keys(fields).sort()).toEqual(["firstMs", "kind", "registerMs", "rssMb", "uiBytes"]);
    for (const value of Object.values(fields)) {
      expect(value === null || typeof value === "number" || INSTANCE_KINDS.includes(value as InstanceKind)).toBe(true);
    }
    expect(fields).toEqual({ kind: "beacon", registerMs: 812, firstMs: 1501, rssMb: 300, uiBytes: 4096 });
    expect(instanceStartFields("job", { registerMs: null, firstMs: -5, rssBytes: 0, uiBytes: 0 })).toMatchObject({ registerMs: null, firstMs: 0 });
    expect(instanceStartFields("job", { registerMs: 1e9, firstMs: 1e9, rssBytes: 1e18, uiBytes: 0 })).toMatchObject({ registerMs: 600000, firstMs: 600000, rssMb: 100000 });
  });

  it("is written by a helper that is given no request data", () => {
    // The function's own name says "request"; nothing else may.
    const text = helper.replaceAll("noteFirstRequest", "").toLowerCase();
    for (const word of ["request", "headers", "cookies", "url", "pathname", "storeId", "accountId"]) {
      expect(text, word).not.toContain(word.toLowerCase());
    }
    expect(helper).toMatch(/export function noteFirstRequest\(kind: InstanceKind, later: \(work: \(\) => Promise<void>\) => void\): void/);
  });

  it("stays a leaf module: its only static imports are the pure module and the log", () => {
    const imports = [...helper.matchAll(/^import .* from "(.*)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./log", "@/lib/instance-start"]);
  });
});

describe("cold starts by kind", () => {
  const beacons = Array.from({ length: 10 }, (_, i) => ({ day: i < 5 ? "2026-11-01" : "2026-11-02", kind: "beacon" as const, firstMs: (i + 1) * 100 }));

  it("gives a day, the median and the 95th percentile by nearest rank", () => {
    expect(coldStartRows(beacons)).toEqual([{ kind: "beacon", perDay: 5, p50: 500, p95: 1000, overHealth: null }]);
  });

  it("gives the proxy's and the beacons' distance from the health check", () => {
    const rows = coldStartRows([...beacons, { day: "2026-11-01", kind: "health", firstMs: 80 }, { day: "2026-11-02", kind: "store", firstMs: 300 }]);
    expect(rows.map((r) => r.kind)).toEqual(["health", "beacon", "store"]);
    expect(rows.find((r) => r.kind === "beacon")?.overHealth).toBe(420);
    expect(rows.find((r) => r.kind === "store")).not.toHaveProperty("overHealth");
  });
});
