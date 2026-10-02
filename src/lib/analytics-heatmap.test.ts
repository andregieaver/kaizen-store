import { describe, expect, it } from "vitest";

import { bandHours, buildHeatmap, intensity, WEEKDAY_LABELS, type HeatmapRow } from "./analytics-heatmap";

const r = (weekday: number, hour: number, orders: number, revenueMinor = orders * 1000): HeatmapRow => ({ weekday, hour, orders, revenueMinor });

describe("buildHeatmap", () => {
  const rows = [r(1, 9, 5), r(1, 10, 3), r(5, 20, 12, 50_000), r(7, 23, 2), r(5, 20, 3, 3000)];
  const map = buildHeatmap(rows);

  it("is always seven days of twenty-four hours", () => {
    expect(map.cells).toHaveLength(7);
    expect(map.cells.every((row) => row.length === 24)).toBe(true);
    expect(WEEKDAY_LABELS).toHaveLength(7);
    expect(WEEKDAY_LABELS[0]).toBe("Mon");
    expect(WEEKDAY_LABELS[6]).toBe("Sun");
  });

  it("puts each order in its weekday (Monday first) and hour", () => {
    expect(map.cells[0][9]).toEqual({ orders: 5, revenueMinor: 5000 });
    expect(map.cells[6][23]).toEqual({ orders: 2, revenueMinor: 2000 });
    expect(map.cells[2][12]).toEqual({ orders: 0, revenueMinor: 0 });
  });

  it("adds rows that repeat a cell", () => {
    expect(map.cells[4][20]).toEqual({ orders: 15, revenueMinor: 53_000 });
  });

  it("totals by weekday, by hour and overall", () => {
    expect(map.rowTotals[0]).toEqual({ orders: 8, revenueMinor: 8000 });
    expect(map.rowTotals[4]).toEqual({ orders: 15, revenueMinor: 53_000 });
    expect(map.rowTotals[1]).toEqual({ orders: 0, revenueMinor: 0 });
    expect(map.colTotals[20]).toEqual({ orders: 15, revenueMinor: 53_000 });
    expect(map.colTotals[9].orders).toBe(5);
    expect(map.total).toEqual({ orders: 25, revenueMinor: 63_000 });
    expect(map.rowTotals.reduce((s, c) => s + c.orders, 0)).toBe(map.total.orders);
    expect(map.colTotals.reduce((s, c) => s + c.orders, 0)).toBe(map.total.orders);
  });

  it("finds the peaks", () => {
    expect(map.peakByOrders).toEqual({ weekday: 5, hour: 20, orders: 15, revenueMinor: 53_000 });
    expect(map.peakByRevenue).toEqual({ weekday: 5, hour: 20, orders: 15, revenueMinor: 53_000 });
    expect(map.peakWeekday).toBe(5);
    expect(map.peakHour).toBe(20);
    expect(map.max).toEqual({ orders: 15, revenueMinor: 53_000 });
  });

  it("has peaks for orders and for revenue apart when they differ", () => {
    const m = buildHeatmap([r(2, 10, 10, 1000), r(3, 11, 2, 90_000)]);
    expect(m.peakByOrders).toMatchObject({ weekday: 2, hour: 10 });
    expect(m.peakByRevenue).toMatchObject({ weekday: 3, hour: 11 });
    expect(m.max).toEqual({ orders: 10, revenueMinor: 90_000 });
  });

  it("breaks a tie by the other measure, then the earlier cell", () => {
    expect(buildHeatmap([r(2, 10, 5, 100), r(3, 11, 5, 900)]).peakByOrders).toMatchObject({ weekday: 3, hour: 11 });
    expect(buildHeatmap([r(2, 10, 5, 100), r(3, 11, 5, 100)]).peakByOrders).toMatchObject({ weekday: 2, hour: 10 });
  });

  it("has no peaks without orders", () => {
    const e = buildHeatmap([]);
    expect(e.peakByOrders).toBeNull();
    expect(e.peakByRevenue).toBeNull();
    expect(e.peakWeekday).toBeNull();
    expect(e.peakHour).toBeNull();
    expect(e.total).toEqual({ orders: 0, revenueMinor: 0 });
    expect(e.max).toEqual({ orders: 0, revenueMinor: 0 });
    expect(e.skipped).toBe(0);
  });

  it("has no revenue peak when orders brought no revenue", () => {
    const m = buildHeatmap([r(1, 1, 3, 0)]);
    expect(m.peakByOrders).not.toBeNull();
    expect(m.peakByRevenue).toBeNull();
  });

  it("leaves out and counts rows that cannot be placed", () => {
    const m = buildHeatmap([r(0, 5, 1), r(8, 5, 1), r(1, 24, 1), r(1, -1, 1), r(1.5, 5, 1), r(1, 5.5, 1), r(1, 5, NaN), { weekday: 1, hour: 1, orders: 1, revenueMinor: Infinity }, r(1, 5, 4)]);
    expect(m.skipped).toBe(8);
    expect(m.total.orders).toBe(4);
  });

  it("takes midnight and the last hour of the last day", () => {
    const m = buildHeatmap([r(1, 0, 1), r(7, 23, 1)]);
    expect(m.cells[0][0].orders).toBe(1);
    expect(m.cells[6][23].orders).toBe(1);
  });

  it("does not share cells between rows", () => {
    const m = buildHeatmap([r(1, 1, 1)]);
    expect(m.cells[1][1].orders).toBe(0);
    expect(m.cells[0][2].orders).toBe(0);
  });
});

describe("intensity", () => {
  const max = { orders: 10, revenueMinor: 5000 };
  it("is the share of the largest cell", () => {
    expect(intensity({ orders: 5, revenueMinor: 0 }, max, "orders")).toBe(0.5);
    expect(intensity({ orders: 10, revenueMinor: 0 }, max, "orders")).toBe(1);
    expect(intensity({ orders: 0, revenueMinor: 1250 }, max, "revenue")).toBe(0.25);
  });

  it("is 0 for nothing or when there is nothing to compare with", () => {
    expect(intensity({ orders: 0, revenueMinor: 0 }, max, "orders")).toBe(0);
    expect(intensity({ orders: 5, revenueMinor: 5 }, { orders: 0, revenueMinor: 0 }, "orders")).toBe(0);
    expect(intensity({ orders: -1, revenueMinor: 0 }, max, "orders")).toBe(0);
  });

  it("never goes over 1", () => {
    expect(intensity({ orders: 20, revenueMinor: 0 }, max, "orders")).toBe(1);
  });
});

describe("bandHours", () => {
  const map = buildHeatmap([r(1, 0, 1), r(1, 1, 2), r(1, 8, 4), r(1, 9, 5), r(6, 23, 7), r(6, 22, 1)]);

  it("groups hours into two-hour bands by default", () => {
    const b = bandHours(map);
    expect(b.bandSize).toBe(2);
    expect(b.bands).toHaveLength(12);
    expect(b.bands[0]).toEqual({ startHour: 0, endHour: 2, label: "00–02" });
    expect(b.bands[11]).toEqual({ startHour: 22, endHour: 24, label: "22–24" });
    expect(b.cells.every((row) => row.length === 12)).toBe(true);
    expect(b.cells[0][0].orders).toBe(3);
    expect(b.cells[0][4].orders).toBe(9);
    expect(b.cells[5][11].orders).toBe(8);
  });

  it("keeps the totals", () => {
    const b = bandHours(map);
    expect(b.total).toEqual(map.total);
    expect(b.rowTotals).toEqual(map.rowTotals);
    expect(b.colTotals).toHaveLength(12);
    expect(b.colTotals.reduce((s, c) => s + c.orders, 0)).toBe(map.total.orders);
  });

  it("names the peak band by its first hour", () => {
    const b = bandHours(map);
    expect(b.peakByOrders).toEqual({ weekday: 1, hour: 8, orders: 9, revenueMinor: 9000 });
    expect(b.cells[5][11].orders).toBe(8);
    expect(b.peakHour).toBe(8);
    expect(b.peakWeekday).toBe(1);
    expect(b.max.orders).toBe(9);
  });

  it("takes other sizes that divide the day", () => {
    for (const size of [1, 2, 3, 4, 6, 8, 12, 24]) {
      const b = bandHours(map, size);
      expect(b.bands).toHaveLength(24 / size);
      expect(b.total.orders).toBe(map.total.orders);
    }
    expect(bandHours(map, 24).cells[0]).toEqual([{ orders: 12, revenueMinor: 12_000 }]);
    expect(bandHours(map, 1).cells).toEqual(map.cells);
  });

  it("refuses a size that would cut a band short", () => {
    for (const bad of [0, -2, 5, 7, 25, 1.5, NaN]) expect(() => bandHours(map, bad)).toThrow(RangeError);
  });

  it("carries the skipped count and an empty matrix", () => {
    const e = bandHours(buildHeatmap([r(9, 9, 1)]));
    expect(e.skipped).toBe(1);
    expect(e.peakByOrders).toBeNull();
    expect(e.peakHour).toBeNull();
  });

  it("does not change the map it is given", () => {
    const before = JSON.stringify(map);
    bandHours(map, 4);
    expect(JSON.stringify(map)).toBe(before);
  });
});
