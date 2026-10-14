import { describe, expect, it } from "vitest";

import { pickupBlock, readyInWords, type PickupOrderFacts } from "./pickup";

const order = (o: Partial<PickupOrderFacts> = {}): PickupOrderFacts => ({
  deliveryMethod: "pickup",
  status: "paid",
  copied: false,
  closed: false,
  waitingForStock: false,
  editPending: false,
  collected: false,
  readyForPickupAt: null,
  ...o,
});

describe("why a pickup order cannot be marked ready or collected", () => {
  it("lets a paid pickup order be marked ready, and collected with or without ready first", () => {
    expect(pickupBlock(order(), "ready")).toBeNull();
    expect(pickupBlock(order(), "collected")).toBeNull();
    expect(pickupBlock(order({ readyForPickupAt: "2026-10-14T10:00:00Z" }), "collected")).toBeNull();
  });

  it("refuses ready a second time, and both once collected", () => {
    expect(pickupBlock(order({ readyForPickupAt: "2026-10-14T10:00:00Z" }), "ready")).toBe("already_ready");
    expect(pickupBlock(order({ collected: true }), "ready")).toBe("collected");
    expect(pickupBlock(order({ status: "fulfilled" }), "collected")).toBe("collected");
  });

  it("refuses another method, an unpaid, copied, cancelled or closed order, units waiting for stock and a change waiting for payment", () => {
    const cases: [Partial<PickupOrderFacts>, string][] = [
      [{ deliveryMethod: "ship" }, "not_pickup"],
      [{ deliveryMethod: "local" }, "not_pickup"],
      [{ status: "pending_payment" }, "unpaid"],
      [{ copied: true }, "copied"],
      [{ status: "cancelled" }, "cancelled"],
      [{ closed: true }, "closed"],
      [{ waitingForStock: true }, "waiting_for_stock"],
      [{ editPending: true }, "edit_pending"],
    ];
    for (const [facts, block] of cases) {
      expect(pickupBlock(order(facts), "ready"), block).toBe(block);
      expect(pickupBlock(order(facts), "collected"), block).toBe(block);
    }
  });
});

describe("how the usual ready time is said", () => {
  it("promises nothing at 0, says hours under two days and whole days (rounded up) after", () => {
    expect(readyInWords(0)).toEqual({ key: "notify" });
    expect(readyInWords(1)).toEqual({ key: "hours", count: 1 });
    expect(readyInWords(47)).toEqual({ key: "hours", count: 47 });
    expect(readyInWords(48)).toEqual({ key: "days", count: 2 });
    expect(readyInWords(49)).toEqual({ key: "days", count: 3 });
    expect(readyInWords(720)).toEqual({ key: "days", count: 30 });
    expect(readyInWords(-5)).toEqual({ key: "notify" });
  });
});
