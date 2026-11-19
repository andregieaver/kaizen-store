import { describe, expect, it } from "vitest";

import { keptStore, monthlyMinor, monthlyTotals, type MoveLine } from "./account-move";

/** Moving an account to one plan (D748 E4 part four): which subscription it keeps, and what it pays a month. */

const line = (over: Partial<MoveLine>): MoveLine => ({ storeId: "s", createdAt: "2026-01-01", running: true, planPosition: 0, monthly: 30000, ...over });

describe("keptStore", () => {
  it("keeps the running subscription on the highest plan", () => {
    expect(keptStore([line({ storeId: "basic", planPosition: 0 }), line({ storeId: "grow", planPosition: 1 }), line({ storeId: "old", planPosition: 3, running: false })])).toBe("grow");
  });

  it("takes the dearest a month where two plans share a position, then the oldest store", () => {
    expect(keptStore([line({ storeId: "advanced", planPosition: 2, monthly: 399000 }), line({ storeId: "plus", planPosition: 2, monthly: 1590000 })])).toBe("plus");
    expect(keptStore([line({ storeId: "b", createdAt: "2026-03-01" }), line({ storeId: "a", createdAt: "2026-02-01" })])).toBe("a");
  });

  it("keeps none when no store's subscription runs", () => {
    expect(keptStore([line({ running: false }), line({ storeId: "t", running: false })])).toBeNull();
    expect(keptStore([])).toBeNull();
  });
});

describe("monthly figures", () => {
  it("counts a yearly price by the month, and adds up per currency", () => {
    expect(monthlyMinor({ interval: "year", amountMinor: 349000 })).toBe(29083);
    expect(
      monthlyTotals([
        { currency: "NOK", interval: "month", amountMinor: 30000 },
        { currency: "NOK", interval: "month", amountMinor: 30000 },
        { currency: "EUR", interval: "year", amountMinor: 12000 },
      ]),
    ).toEqual([
      { currency: "EUR", minor: 1000 },
      { currency: "NOK", minor: 60000 },
    ]);
  });
});
