import { describe, expect, it } from "vitest";

import { EMAIL_KINDS } from "./personal-data";
import { MARKETING_EMAIL_KINDS, monthFigure, monthOf, TRAFFIC_METRICS, USAGE_METRIC_IDS, utcDay } from "./usage-metrics";

describe("monthFigure", () => {
  it("takes a gauge's latest day, whatever the order", () => {
    const rows = [
      { day: "2026-10-02", value: 5 },
      { day: "2026-10-09", value: 7 },
      { day: "2026-10-05", value: 9 },
    ];
    expect(monthFigure(rows, "storage_bytes")).toBe(7);
  });

  it("sums a counter", () => {
    expect(monthFigure([{ day: "2026-10-01", value: 3 }, { day: "2026-10-02", value: 4 }], "requests")).toBe(7);
  });

  it("gives 0 for an empty month", () => {
    expect(monthFigure([], "storage_bytes")).toBe(0);
    expect(monthFigure([], "emails")).toBe(0);
  });
});

describe("days and months", () => {
  it("works in UTC", () => {
    const late = new Date("2026-10-31T23:30:00Z");
    expect(monthOf(late)).toEqual({ start: "2026-10-01", end: "2026-10-31", key: "2026-10" });
    expect(monthOf(new Date("2028-02-10T00:00:00Z")).end).toBe("2028-02-29");
    expect(utcDay(late)).toBe("2026-10-31");
    expect(utcDay(late, 1)).toBe("2026-11-01");
    expect(utcDay(new Date("2026-01-01T00:10:00Z"), -1)).toBe("2025-12-31");
  });
});

describe("the catalogue", () => {
  it("names only email kinds that exist", () => {
    for (const kind of MARKETING_EMAIL_KINDS) expect(EMAIL_KINDS[kind]).toBeDefined();
  });

  it("keeps the drain's metrics apart", () => {
    expect([...TRAFFIC_METRICS].sort()).toEqual(["egress_bytes", "requests", "server_errors"]);
    expect(USAGE_METRIC_IDS).toContain("storage_bytes");
  });
});
