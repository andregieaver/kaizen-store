import { describe, expect, it } from "vitest";

import {
  changeShare,
  effectLines,
  effectsMonth,
  effectTarget,
  effectWindows,
  expectedAfter,
  liftMinor,
  monthDays,
  previousMonth,
  toolOfAction,
  type Effect,
} from "./autopilot-effects";

const effect = (over: Partial<Effect> = {}): Effect => ({
  tool: "set_prices",
  targetKind: "product",
  targetLabel: "Blue mug",
  actedAt: "2026-10-10T09:00:00.000Z",
  currency: "NOK",
  beforeMinor: 100_000,
  afterMinor: 150_000,
  beforeUnits: 10,
  afterUnits: 14,
  storeBeforeMinor: 1_000_000,
  storeAfterMinor: 1_100_000,
  ...over,
});

describe("what an autopilot change was meant to move (D418)", () => {
  it("reads the tool from the audit action and the product from its arguments", () => {
    expect(toolOfAction("store.assistant.set_prices")).toBe("set_prices");
    expect(toolOfAction("product.price_changed")).toBeNull();
    expect(effectTarget("set_prices", { product: " blue-mug " })).toEqual({ kind: "product", ref: "blue-mug" });
    expect(effectTarget("create_product", { title: "Green mug" })).toEqual({ kind: "product", ref: "Green mug" });
    // Anything else, or a product change that names none, is the store's.
    expect(effectTarget("build_page", { product: "x" })).toEqual({ kind: "store" });
    expect(effectTarget("update_product", {})).toEqual({ kind: "store" });
    expect(effectTarget("update_product", null)).toEqual({ kind: "store" });
  });

  it("measures the fourteen store days on each side, leaving the change's own day out", () => {
    expect(effectWindows("2026-10-15")).toEqual({
      before: { from: "2026-10-01", to: "2026-10-14" },
      after: { from: "2026-10-16", to: "2026-10-29" },
      measurableOn: "2026-10-30",
    });
  });
});

describe("a change read against the store's own trend", () => {
  it("expects the product to move as the store did, and calls the rest lift", () => {
    // The store grew 10 %: 1 000 kr before would have been 1 100 kr after; 1 500 kr is 400 kr above.
    expect(expectedAfter(effect())).toBe(110_000);
    expect(liftMinor(effect())).toBe(40_000);
    expect(liftMinor(effect({ afterMinor: 90_000 }))).toBe(-20_000);
  });

  it("reads nothing for a store change, or when the store sold nothing before", () => {
    expect(liftMinor(effect({ targetKind: "store" }))).toBeNull();
    expect(liftMinor(effect({ storeBeforeMinor: 0 }))).toBeNull();
    expect(changeShare(0, 10)).toBeNull();
    expect(changeShare(100, 150)).toBe(0.5);
  });
});

describe("a month of changes", () => {
  it("sums the product changes' sales and lift, counts the store changes and never adds their money", () => {
    const m = effectsMonth("2026-10", 7, [effect(), effect({ afterMinor: 90_000 }), effect({ targetKind: "store", beforeMinor: 5_000_000, afterMinor: 9_000_000 }), effect({ storeBeforeMinor: 0 })], "NOK");
    expect(m).toEqual({ month: "2026-10", actions: 7, measured: 4, products: 3, beforeMinor: 300_000, afterMinor: 390_000, liftMinor: 20_000, above: 1, below: 1, currency: "NOK" });
    expect(effectsMonth("2026-10", 2, [effect({ targetKind: "store" })], "NOK").liftMinor).toBeNull();
    // A product measured in another currency (the main one changed since) is left out of the sums.
    expect(effectsMonth("2026-10", 1, [effect({ currency: "EUR" })], "NOK").products).toBe(0);
  });

  it("knows a month's days and the month before", () => {
    expect(monthDays("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthDays("2028-02").to).toBe("2028-02-29");
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });
});

describe("what a review is told", () => {
  it("writes each change's figures by code, in its own currency", () => {
    const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(0)}`;
    const [product, store] = effectLines([effect(), effect({ targetKind: "store", tool: "build_page", targetLabel: "" })], money);
    expect(product).toBe('- 2026-10-10 set_prices on "Blue mug": the product sold NOK 1000 → NOK 1500 (14 days before → after); the store NOK 10000 → NOK 11000; above the store\'s trend by NOK 400.');
    expect(store).toBe("- 2026-10-10 build_page: the store sold NOK 1000 → NOK 1500 (14 days before → after).");
    expect(effectLines(Array.from({ length: 12 }, () => effect()), money)).toHaveLength(8);
  });
});
