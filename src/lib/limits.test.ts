import { describe, expect, it } from "vitest";

import { effectiveLimit, fromTyped, GIB, LIMIT_KEYS, LIMITS, limitState, parseLimitsForm, roomLeft, toTyped, wouldPass } from "./limits";
import { USAGE_METRICS } from "./usage-metrics";

describe("effectiveLimit", () => {
  it("takes the override, then the plan, then the platform default", () => {
    expect(effectiveLimit({ override: { value: 1 }, plan: { value: 2 }, platform: { value: 3 } })).toEqual({ value: 1, origin: "override" });
    expect(effectiveLimit({ plan: { value: 2 }, platform: { value: 3 } })).toEqual({ value: 2, origin: "plan" });
    expect(effectiveLimit({ platform: { value: 3 } })).toEqual({ value: 3, origin: "platform" });
  });

  it("tells a row meaning unlimited from no row", () => {
    expect(effectiveLimit({ override: { value: null }, plan: { value: 2 } })).toEqual({ value: null, origin: "override" });
    expect(effectiveLimit({})).toEqual({ value: null, origin: "none" });
  });
});

describe("limitState", () => {
  it("is near from 80 %, reached at 100 % and over above", () => {
    expect(limitState(79, 100)).toBe("ok");
    expect(limitState(80, 100)).toBe("near");
    expect(limitState(100, 100)).toBe("reached");
    expect(limitState(101, 100)).toBe("over");
  });

  it("is always ok when unlimited, and a limit of 0 allows nothing", () => {
    expect(limitState(10 ** 12, null)).toBe("ok");
    expect(limitState(0, 0)).toBe("reached");
    expect(limitState(1, 0)).toBe("over");
  });
});

describe("refusing", () => {
  it("refuses only past a hard limit", () => {
    expect(wouldPass("products", 9, 10, 1)).toBe(false);
    expect(wouldPass("products", 10, 10, 1)).toBe(true);
    expect(wouldPass("products", 10, null, 1)).toBe(false);
    expect(wouldPass("requests_month", 10 ** 9, 10, 1)).toBe(false);
  });

  it("says what is left", () => {
    expect(roomLeft(3, 10)).toBe(7);
    expect(roomLeft(12, 10)).toBe(0);
    expect(roomLeft(12, null)).toBe(Infinity);
  });
});

describe("typed values", () => {
  it("reads gigabytes, dollars and counts", () => {
    expect(fromTyped("storage_bytes", "10")).toBe(10 * GIB);
    expect(fromTyped("storage_bytes", "0,5")).toBe(GIB / 2);
    expect(fromTyped("ai_cost_month_micros", "12.5")).toBe(12_500_000);
    expect(fromTyped("products", "500")).toBe(500);
    expect(fromTyped("products", "1.5")).toBeNull();
    expect(fromTyped("products", "-1")).toBeNull();
    expect(fromTyped("products", "lots")).toBeNull();
    expect(toTyped("storage_bytes", 10 * GIB)).toBe("10");
    expect(toTyped("ai_cost_month_micros", 12_500_000)).toBe("12.5");
  });
});

describe("the catalogue", () => {
  it("compares each limit with a metric of the right kind", () => {
    for (const key of LIMIT_KEYS) {
      const def = LIMITS[key];
      if (def.metric === null) continue;
      expect(USAGE_METRICS[def.metric], key).toBeDefined();
      expect(def.period, key).toBe(USAGE_METRICS[def.metric].kind === "gauge" ? "now" : "month");
    }
  });

  it("never refuses traffic", () => {
    expect(LIMITS.requests_month.enforce).toBe("soft");
    expect(LIMITS.egress_bytes_month.enforce).toBe("soft");
  });
});

describe("parseLimitsForm", () => {
  it("reads a value, an unlimited tick and an empty cell, and names a cell typed wrong", () => {
    const data = new FormData();
    data.set("v:default:storage_bytes", "5");
    data.set("u:p1:products", "on");
    data.set("v:p1:staff_seats", "three");
    const { cells, problems } = parseLimitsForm(data, ["p1"]);
    expect(cells.find((c) => c.planId === null && c.key === "storage_bytes")?.cell).toEqual({ kind: "value", value: 5 * GIB });
    expect(cells.find((c) => c.planId === "p1" && c.key === "products")?.cell).toEqual({ kind: "unlimited" });
    expect(cells.find((c) => c.planId === "p1" && c.key === "custom_domains")?.cell).toEqual({ kind: "unset" });
    expect(problems).toEqual(["staff_seats"]);
  });
});
