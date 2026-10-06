import { describe, expect, it } from "vitest";

import {
  analyseVariant,
  daysOfStock,
  DEAD_STOCK_DAYS,
  inventoryValue,
  LOW_STOCK_DAYS,
  MIN_SOLD_30D,
  onBackorder,
  sellThrough,
  stockoutAlerts,
  stockWatch,
  STOCKOUT_ALERT_DAYS,
  stockStatus,
  turnover,
  velocity,
  type InventoryRow,
} from "./analytics-inventory";

const row = (over: Partial<InventoryRow> = {}): InventoryRow => ({
  variantId: "v1",
  productId: "p1",
  name: "Mug",
  sku: "MUG-1",
  tracked: true,
  onHand: 100,
  stockPolicy: "deny",
  owed: 0,
  sold7: 0,
  sold30: 0,
  soldPeriod: 0,
  lastSoldDaysAgo: 5,
  ageDays: 400,
  costMinor: 5000,
  lowStockThreshold: null,
  ...over,
});

describe("thresholds", () => {
  it("are the documented ones", () => {
    expect(LOW_STOCK_DAYS).toBe(14);
    expect(STOCKOUT_ALERT_DAYS).toBe(7);
    expect(DEAD_STOCK_DAYS).toBe(90);
    expect(MIN_SOLD_30D).toBe(3);
  });
});

describe("velocity", () => {
  it("is units per day over 7 and 30 days", () => {
    const v = velocity(14, 30);
    expect(v.v7).toBe(2);
    expect(v.v30).toBe(1);
    expect(v.blended).toBeCloseTo(0.6 * 2 + 0.4 * 1, 10);
  });

  it("is zero without sales, and never negative", () => {
    expect(velocity(0, 0)).toEqual({ v7: 0, v30: 0, blended: 0 });
    expect(velocity(-5, -5).blended).toBe(0);
  });

  it("weights a recent burst more than the month", () => {
    // Everything sold in the last week.
    const burst = velocity(7, 7);
    const steady = velocity(7, 30);
    expect(burst.blended).toBeGreaterThan(velocity(7, 7 / 3).blended);
    expect(steady.blended).toBeCloseTo(0.6 * 1 + 0.4 * 1, 10);
  });
});

describe("daysOfStock", () => {
  it("is on hand over the blend", () => {
    expect(daysOfStock(100, 2, 1)).toBeCloseTo(100 / 1.6, 10);
    expect(daysOfStock(10, 1, 1)).toBeCloseTo(10, 10);
  });

  it("is none when nothing sold", () => {
    expect(daysOfStock(100, 0, 0)).toBeNull();
    expect(daysOfStock(0, 0, 0)).toBeNull();
  });

  it("is 0 days with nothing left when things sell, never negative", () => {
    expect(daysOfStock(0, 1, 1)).toBe(0);
    expect(daysOfStock(-5, 1, 1)).toBe(0);
  });

  it("can be worked out from either velocity alone", () => {
    expect(daysOfStock(10, 1, 0)).toBeCloseTo(10 / 0.6, 10);
    expect(daysOfStock(10, 0, 1)).toBeCloseTo(10 / 0.4, 10);
  });
});

describe("sellThrough and turnover", () => {
  it("is sold over sold plus what is left", () => {
    expect(sellThrough(30, 70)).toBe(0.3);
    expect(sellThrough(10, 0)).toBe(1);
    expect(sellThrough(0, 50)).toBe(0);
  });

  it("is none when there was nothing to sell", () => {
    expect(sellThrough(0, 0)).toBeNull();
    expect(sellThrough(-3, -3)).toBeNull();
  });

  it("counts negative stock as none", () => {
    expect(sellThrough(10, -4)).toBe(1);
  });

  it("turns over as a year's cost of goods against stock at cost", () => {
    expect(turnover(1_200_000, 300_000)).toBe(4);
    expect(turnover(0, 300_000)).toBe(0);
  });

  it("has no turnover without stock value", () => {
    expect(turnover(1_200_000, 0)).toBeNull();
    expect(turnover(1_200_000, -1)).toBeNull();
  });
});

describe("inventoryValue", () => {
  it("values tracked stock at cost", () => {
    const v = inventoryValue([row({ onHand: 10, costMinor: 500 }), row({ variantId: "v2", onHand: 4, costMinor: 1000 })]);
    expect(v).toEqual({ valueMinor: 9000, units: 14, unitsWithoutCost: 0, coverage: 1 });
  });

  it("does not value stock with no cost at nothing without saying so", () => {
    const v = inventoryValue([row({ onHand: 10, costMinor: 500 }), row({ variantId: "v2", onHand: 30, costMinor: null })]);
    expect(v.valueMinor).toBe(5000);
    expect(v.unitsWithoutCost).toBe(30);
    expect(v.coverage).toBe(0.25);
  });

  it("leaves out untracked variants and stock that is out or oversold", () => {
    const v = inventoryValue([row({ tracked: false, onHand: 99 }), row({ variantId: "a", onHand: 0 }), row({ variantId: "b", onHand: -3 })]);
    expect(v).toEqual({ valueMinor: 0, units: 0, unitsWithoutCost: 0, coverage: null });
  });

  it("is empty without rows", () => {
    expect(inventoryValue([])).toEqual({ valueMinor: 0, units: 0, unitsWithoutCost: 0, coverage: null });
  });
});

describe("stockStatus", () => {
  it("is untracked before anything", () => {
    expect(stockStatus(row({ tracked: false, onHand: 0 }))).toBe("untracked");
  });

  it("is out when nothing is left, including oversold", () => {
    expect(stockStatus(row({ onHand: 0 }))).toBe("out");
    expect(stockStatus(row({ onHand: -2 }))).toBe("out");
    expect(stockStatus(row({ onHand: 0, lastSoldDaysAgo: 400 }))).toBe("out");
  });

  it("is dead when stock sits unsold for 90 days", () => {
    expect(stockStatus(row({ lastSoldDaysAgo: 90 }))).toBe("dead");
    expect(stockStatus(row({ lastSoldDaysAgo: 89 }))).toBe("ok");
    expect(stockStatus(row({ lastSoldDaysAgo: 365 }))).toBe("dead");
  });

  it("is dead when it never sold and has been on offer 90 days", () => {
    expect(stockStatus(row({ lastSoldDaysAgo: null, ageDays: 90 }))).toBe("dead");
    expect(stockStatus(row({ lastSoldDaysAgo: null, ageDays: 89 }))).toBe("ok");
    expect(stockStatus(row({ lastSoldDaysAgo: null, ageDays: 3 }))).toBe("ok");
  });

  it("is low at the store's own level", () => {
    expect(stockStatus(row({ onHand: 5, lowStockThreshold: 5 }))).toBe("low");
    expect(stockStatus(row({ onHand: 6, lowStockThreshold: 5 }))).toBe("ok");
    expect(stockStatus(row({ onHand: 0, lowStockThreshold: 5 }))).toBe("out");
  });

  it("is low when it lasts 14 days or fewer at the current pace", () => {
    // 30 sold in 30 days and 7 in the week: blended 0.6 + 0.4 = 1 a day.
    expect(stockStatus(row({ onHand: 14, sold7: 7, sold30: 30 }))).toBe("low");
    expect(stockStatus(row({ onHand: 15, sold7: 7, sold30: 30 }))).toBe("ok");
  });

  it("does not call stock low on too few sales", () => {
    expect(stockStatus(row({ onHand: 1, sold7: 1, sold30: 1 }))).toBe("ok");
    expect(stockStatus(row({ onHand: 1, sold7: 2, sold30: MIN_SOLD_30D - 1 }))).toBe("ok");
    expect(stockStatus(row({ onHand: 1, sold7: 3, sold30: MIN_SOLD_30D }))).toBe("low");
  });

  it("is ok when nothing sold recently but not for long", () => {
    expect(stockStatus(row({ onHand: 3, sold7: 0, sold30: 0, lastSoldDaysAgo: 40 }))).toBe("ok");
  });

  it("puts dead before low", () => {
    expect(stockStatus(row({ onHand: 2, lowStockThreshold: 5, lastSoldDaysAgo: 200 }))).toBe("dead");
  });
});

describe("analyseVariant", () => {
  it("gathers a variant's figures", () => {
    const a = analyseVariant(row({ onHand: 16, sold7: 7, sold30: 30, soldPeriod: 30, costMinor: 500 }));
    expect(a.velocity.blended).toBeCloseTo(1, 10);
    expect(a.daysOfStock).toBeCloseTo(16, 10);
    expect(a.status).toBe("ok");
    expect(a.valueMinor).toBe(8000);
    expect(a.sellThrough).toBeCloseTo(30 / 46, 10);
  });

  it("gives no days of stock without enough sales or tracking", () => {
    expect(analyseVariant(row({ sold7: 1, sold30: 1 })).daysOfStock).toBeNull();
    expect(analyseVariant(row({ tracked: false, sold7: 10, sold30: 40 })).daysOfStock).toBeNull();
    expect(analyseVariant(row({ tracked: false })).sellThrough).toBeNull();
    expect(analyseVariant(row({ tracked: false })).valueMinor).toBeNull();
  });

  it("gives no value without a cost or stock", () => {
    expect(analyseVariant(row({ costMinor: null })).valueMinor).toBeNull();
    expect(analyseVariant(row({ onHand: 0 })).valueMinor).toBeNull();
  });
});

describe("stockoutAlerts", () => {
  it("lists what is gone and what will be within a week", () => {
    const alerts = stockoutAlerts([
      row({ variantId: "ok", name: "Fine", onHand: 500, sold7: 7, sold30: 30 }),
      row({ variantId: "gone", name: "Gone", onHand: 0, sold7: 7, sold30: 30 }),
      // 1 a day, 5 left: 5 days.
      row({ variantId: "soon", name: "Soon", onHand: 5, sold7: 7, sold30: 30 }),
      // 1 a day, 7 left: exactly 7 days.
      row({ variantId: "edge", name: "Edge", onHand: 7, sold7: 7, sold30: 30 }),
      row({ variantId: "late", name: "Late", onHand: 8, sold7: 7, sold30: 30 }),
    ]);
    expect(alerts.map((a) => [a.row.variantId, a.kind])).toEqual([
      ["gone", "out"],
      ["soon", "soon"],
      ["edge", "soon"],
    ]);
    expect(alerts[0].days).toBe(0);
    expect(alerts[1].days).toBeCloseTo(5, 10);
  });

  it("raises nothing for slow sellers, untracked variants or what never sold", () => {
    expect(
      stockoutAlerts([
        row({ variantId: "slow", onHand: 0, sold30: 2 }),
        row({ variantId: "none", onHand: 0, sold30: 0 }),
        row({ variantId: "untracked", tracked: false, onHand: 0, sold30: 30 }),
      ]),
    ).toEqual([]);
  });

  it("takes another window", () => {
    const rows = [row({ onHand: 10, sold7: 7, sold30: 30 })];
    expect(stockoutAlerts(rows)).toEqual([]);
    expect(stockoutAlerts(rows, 14)).toHaveLength(1);
    expect(stockoutAlerts(rows, 0)).toEqual([]);
  });

  it("puts the soonest first, and the faster seller first among equals", () => {
    const alerts = stockoutAlerts([
      row({ variantId: "b", name: "B", onHand: 0, sold30: 4 }),
      row({ variantId: "a", name: "A", onHand: 0, sold30: 40 }),
      row({ variantId: "c", name: "C", onHand: 2, sold7: 7, sold30: 30 }),
    ]);
    expect(alerts.map((a) => a.row.variantId)).toEqual(["a", "b", "c"]);
  });

  it("does not change its input", () => {
    const rows = [row({ variantId: "z", onHand: 0, sold30: 5 }), row({ variantId: "a", onHand: 0, sold30: 9 })];
    stockoutAlerts(rows);
    expect(rows.map((r) => r.variantId)).toEqual(["z", "a"]);
  });
});

describe("backorders and the owner's own level (D172)", () => {
  it("counts a negative on hand as nothing in every figure and never as a negative value", () => {
    const owedRow = row({ onHand: -4, stockPolicy: "continue", owed: 4, sold7: 3, sold30: 9, soldPeriod: 9 });
    const analysed = analyseVariant(owedRow);
    expect(analysed.status).toBe("out");
    expect(analysed.valueMinor).toBeNull();
    expect(analysed.daysOfStock).toBe(0);
    expect(analysed.sellThrough).toBe(1);
    expect(inventoryValue([owedRow])).toEqual({ valueMinor: 0, units: 0, unitsWithoutCost: 0, coverage: null });
  });

  it("says a variant is on backorder only when it keeps selling with nothing on hand", () => {
    expect(onBackorder(row({ onHand: 0, stockPolicy: "continue" }))).toBe(true);
    expect(onBackorder(row({ onHand: -2, stockPolicy: "continue" }))).toBe(true);
    expect(onBackorder(row({ onHand: 1, stockPolicy: "continue" }))).toBe(false);
    expect(onBackorder(row({ onHand: 0, stockPolicy: "deny" }))).toBe(false);
    expect(onBackorder(row({ onHand: 0, stockPolicy: "continue", tracked: false }))).toBe(false);
    // Still out in every count, whatever it is called.
    expect(stockStatus(row({ onHand: 0, stockPolicy: "continue" }))).toBe("out");
  });

  it("judges a variant with a level of its own by the level, and out and dead first", () => {
    expect(stockStatus(row({ onHand: 8, lowStockThreshold: 10, sold30: 0 }))).toBe("low");
    expect(stockStatus(row({ onHand: 11, lowStockThreshold: 10, sold30: 0 }))).toBe("ok");
    expect(stockStatus(row({ onHand: 10, lowStockThreshold: 10, sold30: 0 }))).toBe("low");
    expect(stockStatus(row({ onHand: 0, lowStockThreshold: 10 }))).toBe("out");
    expect(stockStatus(row({ onHand: 8, lowStockThreshold: 10, lastSoldDaysAgo: 120 }))).toBe("dead");
  });

  it("adds up what the owner's settings add: units owed, variants on backorder, variants at or below their level", () => {
    const watch = stockWatch([
      row({ variantId: "a", onHand: -4, stockPolicy: "continue", owed: 4 }),
      row({ variantId: "b", onHand: 0, stockPolicy: "continue", owed: 0 }),
      row({ variantId: "c", onHand: 2, stockPolicy: "continue", owed: 1 }),
      row({ variantId: "d", onHand: 5, lowStockThreshold: 5 }),
      row({ variantId: "e", onHand: 0, lowStockThreshold: 0 }),
      row({ variantId: "f", onHand: 6, lowStockThreshold: 5 }),
      row({ variantId: "g", onHand: -9, owed: 9, tracked: false }),
    ]);
    expect(watch).toEqual({ owedUnits: 5, onBackorder: 2, belowLevel: 2 });
    expect(stockWatch([])).toEqual({ owedUnits: 0, onBackorder: 0, belowLevel: 0 });
  });
});
