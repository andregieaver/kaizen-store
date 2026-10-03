import { describe, expect, it } from "vitest";

import {
  isWholeOrder,
  lineValue,
  paidForUnits,
  refundFor,
  refundableAfter,
  reviewOverride,
  shippingPaidMinor,
  type RefundInput,
  type RefundLine,
} from "./return-refund";

const line = (over: Partial<RefundLine> = {}): RefundLine => ({
  lineId: "a",
  quantity: 3,
  totalMinor: 3000,
  priorQuantity: 0,
  returnQuantity: 0,
  deductionMinor: 0,
  ...over,
});
const input = (over: Partial<RefundInput> = {}): RefundInput => ({
  kind: "withdrawal",
  lines: [line({ returnQuantity: 1 })],
  shippingPaidMinor: 490,
  whoPaysReturn: "store",
  refundableMinor: 100_000,
  ...over,
});

describe("what the shopper paid for units of a line", () => {
  it("is the line's total shared by units, in exact integers", () => {
    expect(paidForUnits(3000, 3, 1)).toBe(1000);
    expect(paidForUnits(3000, 3, 3)).toBe(3000);
    expect(paidForUnits(1000, 3, 1)).toBe(333);
    expect(paidForUnits(1000, 3, 2)).toBe(666);
    expect(paidForUnits(1000, 3, 0)).toBe(0);
    // Large amounts do not lose a minor unit to floating point.
    expect(paidForUnits(9_007_199_254_740_991, 3, 1)).toBe(3_002_399_751_580_330);
  });

  it("refuses what cannot be", () => {
    expect(() => paidForUnits(1000, 0, 0)).toThrow(RangeError);
    expect(() => paidForUnits(1000, 3, 4)).toThrow(RangeError);
    expect(() => paidForUnits(-1, 3, 1)).toThrow(RangeError);
    expect(() => paidForUnits(1.5, 3, 1)).toThrow(RangeError);
  });
});

describe("the cumulative rule for partial quantities", () => {
  it("gives the odd minor units to the last units: three returns of a line of three add up to the total exactly", () => {
    // 1000 for 3 units: 333 + 333 + 334.
    const parts = [0, 1, 2].map((prior) => lineValue({ quantity: 3, totalMinor: 1000, priorQuantity: prior, returnQuantity: 1 }));
    expect(parts).toEqual([333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("is the same however the line is split over returns", () => {
    const total = 1001;
    const q = 7;
    const splits = [[7], [1, 6], [6, 1], [3, 4], [2, 2, 3], [1, 1, 1, 1, 1, 1, 1], [5, 2]];
    for (const split of splits) {
      let prior = 0;
      let sum = 0;
      for (const n of split) {
        sum += lineValue({ quantity: q, totalMinor: total, priorQuantity: prior, returnQuantity: n });
        prior += n;
      }
      expect([split, sum]).toEqual([split, total]);
    }
  });

  it("never gives more than the total for any prefix, and never a negative part", () => {
    for (const total of [0, 1, 2, 99, 1000, 4999, 123_457]) {
      for (const q of [1, 2, 3, 5, 7, 12]) {
        let prior = 0;
        let sum = 0;
        for (let i = 0; i < q; i++) {
          const part = lineValue({ quantity: q, totalMinor: total, priorQuantity: prior, returnQuantity: 1 });
          expect(part).toBeGreaterThanOrEqual(0);
          sum += part;
          prior += 1;
          expect(sum).toBeLessThanOrEqual(total);
          expect(sum).toBe(paidForUnits(total, q, prior));
        }
        expect(sum).toBe(total);
      }
    }
  });

  it("is 0 for a line not in the return, and refuses more units than the line holds", () => {
    expect(lineValue({ quantity: 3, totalMinor: 3000, priorQuantity: 1, returnQuantity: 0 })).toBe(0);
    expect(() => lineValue({ quantity: 3, totalMinor: 3000, priorQuantity: 2, returnQuantity: 2 })).toThrow(RangeError);
  });

  it("refunds what was paid after discounts, never the list price", () => {
    // 2 x 1000 list, 15% off in total (300 off): the line was paid 1700, so one unit is 850.
    expect(lineValue({ quantity: 2, totalMinor: 1700, priorQuantity: 0, returnQuantity: 1 })).toBe(850);
  });
});

describe("the refund", () => {
  it("is the goods returned, nothing else, for part of an order", () => {
    const r = refundFor(input({ lines: [line({ returnQuantity: 2 })] }));
    expect(r).toMatchObject({ goodsMinor: 2000, deductionsMinor: 0, wholeOrder: false, shippingRefundMinor: 0, returnShippingMinor: 0, sumMinor: 2000, amountMinor: 2000, cappedBy: null });
    expect(r.lines).toEqual([{ lineId: "a", returnQuantity: 2, valueMinor: 2000, deductionMinor: 0, deductionClamped: false, netMinor: 2000 }]);
    expect(r.working).toEqual([{ key: "goods", amountMinor: 2000 }]);
  });

  it("adds the original standard delivery only when the whole order is withdrawn", () => {
    const whole = refundFor(input({ lines: [line({ returnQuantity: 3 }), line({ lineId: "b", quantity: 1, totalMinor: 500, returnQuantity: 1 })] }));
    expect(whole).toMatchObject({ wholeOrder: true, goodsMinor: 3500, shippingRefundMinor: 490, amountMinor: 3990 });
    expect(whole.working.map((w) => w.key)).toEqual(["goods", "shipping"]);

    const part = refundFor(input({ lines: [line({ returnQuantity: 3 }), line({ lineId: "b", quantity: 1, totalMinor: 500, returnQuantity: 0 })] }));
    expect(part).toMatchObject({ wholeOrder: false, shippingRefundMinor: 0, amountMinor: 3000 });
  });

  it("does not refund the extra for a faster option than the cheapest standard delivery", () => {
    const r = refundFor(input({ lines: [line({ returnQuantity: 3 })], shippingPaidMinor: 1990, standardShippingMinor: 490 }));
    expect(r.shippingRefundMinor).toBe(490);
    // A standard price above what was paid (a free-shipping order) never refunds more than was paid.
    expect(refundFor(input({ lines: [line({ returnQuantity: 3 })], shippingPaidMinor: 0, standardShippingMinor: 490 })).shippingRefundMinor).toBe(0);
    expect(refundFor(input({ lines: [line({ returnQuantity: 3 })], shippingPaidMinor: 300, standardShippingMinor: 490 })).shippingRefundMinor).toBe(300);
  });

  it("completes the order across returns: the delivery comes with the one that makes it whole, once", () => {
    const first = refundFor(input({ lines: [line({ returnQuantity: 2 })] }));
    expect(first.wholeOrder).toBe(false);
    const second = refundFor(input({ lines: [line({ priorQuantity: 2, returnQuantity: 1 })] }));
    expect(second).toMatchObject({ wholeOrder: true, goodsMinor: 1000, shippingRefundMinor: 490, amountMinor: 1490 });
    // Delivery already given back is not given twice.
    expect(refundFor(input({ lines: [line({ priorQuantity: 2, returnQuantity: 1 })], shippingRefundedMinor: 490 })).shippingRefundMinor).toBe(0);
    expect(refundFor(input({ lines: [line({ priorQuantity: 2, returnQuantity: 1 })], shippingRefundedMinor: 100 })).shippingRefundMinor).toBe(390);
  });

  it("is never whole while a line the law excluded stays with the shopper, nor for a voluntary return", () => {
    const withExcluded = refundFor(input({ lines: [line({ returnQuantity: 3 }), line({ lineId: "b", quantity: 1, totalMinor: 500 })] }));
    expect(withExcluded.wholeOrder).toBe(false);
    expect(withExcluded.shippingRefundMinor).toBe(0);
    const voluntary = refundFor(input({ kind: "return", lines: [line({ returnQuantity: 3 })] }));
    expect(voluntary).toMatchObject({ wholeOrder: false, shippingRefundMinor: 0, amountMinor: 3000 });
  });

  it("takes a deduction for diminished value off a line, never more than its value", () => {
    const r = refundFor(input({ lines: [line({ returnQuantity: 2, deductionMinor: 300 })] }));
    expect(r).toMatchObject({ goodsMinor: 2000, deductionsMinor: 300, amountMinor: 1700 });
    expect(r.working).toEqual([
      { key: "goods", amountMinor: 2000 },
      { key: "deductions", amountMinor: -300 },
    ]);
    const clamped = refundFor(input({ lines: [line({ returnQuantity: 1, deductionMinor: 5000 })] }));
    expect(clamped.lines[0]).toMatchObject({ valueMinor: 1000, deductionMinor: 1000, deductionClamped: true, netMinor: 0 });
    expect(clamped.amountMinor).toBe(0);
  });

  it("takes the return shipping off only when the shopper pays it", () => {
    const shopper = refundFor(input({ whoPaysReturn: "shopper", returnShippingMinor: 590, lines: [line({ returnQuantity: 2 })] }));
    expect(shopper).toMatchObject({ returnShippingMinor: 590, amountMinor: 1410 });
    expect(shopper.working.map((w) => w.key)).toEqual(["goods", "return_shipping"]);
    const store = refundFor(input({ whoPaysReturn: "store", returnShippingMinor: 590, lines: [line({ returnQuantity: 2 })] }));
    expect(store).toMatchObject({ returnShippingMinor: 0, amountMinor: 2000 });
  });

  it("is never negative", () => {
    const r = refundFor(input({ whoPaysReturn: "shopper", returnShippingMinor: 5000, lines: [line({ returnQuantity: 1 })] }));
    expect(r).toMatchObject({ sumMinor: -4000, amountMinor: 0, cappedBy: "zero" });
  });

  it("is never more than what is left to refund through Stripe", () => {
    // The whole order, delivery included: 3000 + 490.
    const r = refundFor(input({ lines: [line({ returnQuantity: 3 })], refundableMinor: 2500 }));
    expect(r).toMatchObject({ sumMinor: 3490, amountMinor: 2500, cappedBy: "refundable" });
    expect(refundFor(input({ lines: [line({ returnQuantity: 3 })], refundableMinor: 0 }))).toMatchObject({ amountMinor: 0, cappedBy: "refundable" });
    expect(refundFor(input({ lines: [line({ returnQuantity: 3 })], refundableMinor: 3490 }))).toMatchObject({ amountMinor: 3490, cappedBy: null });
  });

  it("makes returns of a whole order add up to the order and never to more", () => {
    // An order: A 3 units for 1000 (333.33 each), B 2 units for 999; delivery 490; returned in awkward pieces.
    const a = { quantity: 3, totalMinor: 1000 };
    const b = { quantity: 2, totalMinor: 999 };
    const steps: [number, number][] = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    let priorA = 0;
    let priorB = 0;
    let shipped = 0;
    let sum = 0;
    for (const [qa, qb] of steps) {
      const r = refundFor({
        kind: "withdrawal",
        lines: [
          { lineId: "a", ...a, priorQuantity: priorA, returnQuantity: qa, deductionMinor: 0 },
          { lineId: "b", ...b, priorQuantity: priorB, returnQuantity: qb, deductionMinor: 0 },
        ],
        shippingPaidMinor: 490,
        shippingRefundedMinor: shipped,
        whoPaysReturn: "store",
        refundableMinor: 10_000_000,
      });
      sum += r.amountMinor;
      shipped += r.shippingRefundMinor;
      priorA += qa;
      priorB += qb;
      expect(sum).toBeLessThanOrEqual(1000 + 999 + 490);
    }
    expect(priorA).toBe(3);
    expect(priorB).toBe(2);
    expect(sum).toBe(1000 + 999 + 490);
  });

  it("checks what it is given", () => {
    expect(() => refundFor(input({ shippingPaidMinor: -1 }))).toThrow(RangeError);
    expect(() => refundFor(input({ refundableMinor: 1.5 }))).toThrow(RangeError);
    expect(() => refundFor(input({ lines: [line({ returnQuantity: 1, deductionMinor: -1 })] }))).toThrow(RangeError);
    expect(() => refundFor(input({ lines: [line({ priorQuantity: 3, returnQuantity: 1 })] }))).toThrow(RangeError);
  });
});

describe("what completes the order for the delivery (settled withdrawals, earlier or later)", () => {
  it("counts the other withdrawals whose goods are settled, whichever was made first", () => {
    // A line of 3 units: this return takes 1; another withdrawal (made LATER) holds the other 2 and its goods are back.
    const later = [line({ returnQuantity: 1, priorQuantity: 0, completedByOthers: 2 })];
    expect(isWholeOrder(later)).toBe(true);
    expect(refundFor(input({ lines: later })).shippingRefundMinor).toBe(490);
    // The same with those 2 units on a withdrawal whose goods are not settled yet: not whole, so no delivery yet.
    const unsettled = [line({ returnQuantity: 1, priorQuantity: 2, completedByOthers: 0 })];
    expect(isWholeOrder(unsettled)).toBe(false);
    expect(refundFor(input({ lines: unsettled })).shippingRefundMinor).toBe(0);
  });

  it("gives the delivery back once in all: what an earlier return refunded of it is taken off", () => {
    const lines = [line({ returnQuantity: 1, priorQuantity: 2, completedByOthers: 2 })];
    expect(refundFor(input({ lines })).shippingRefundMinor).toBe(490);
    expect(refundFor(input({ lines, shippingRefundedMinor: 490 })).shippingRefundMinor).toBe(0);
    expect(refundFor(input({ lines, shippingRefundedMinor: 490 })).amountMinor).toBe(1000);
  });
});

describe("whole order", () => {
  it("needs every line back in full, with this return bringing something", () => {
    expect(isWholeOrder([{ quantity: 2, priorQuantity: 1, returnQuantity: 1 }])).toBe(true);
    expect(isWholeOrder([{ quantity: 2, priorQuantity: 2, returnQuantity: 0 }])).toBe(false);
    expect(isWholeOrder([{ quantity: 2, priorQuantity: 0, returnQuantity: 1 }])).toBe(false);
    expect(isWholeOrder([])).toBe(false);
  });
});

describe("delivery as paid, and what is left", () => {
  it("is the order's total less its lines", () => {
    expect(shippingPaidMinor(4490, [3000, 1000])).toBe(490);
    expect(shippingPaidMinor(4000, [3000, 1000])).toBe(0);
    expect(shippingPaidMinor(3900, [3000, 1000])).toBe(0);
  });

  it("is what was paid less what was refunded", () => {
    expect(refundableAfter(4490, 1000)).toBe(3490);
    expect(refundableAfter(100, 500)).toBe(0);
  });
});

describe("adjusting the final amount", () => {
  const ok = { computedMinor: 2000, refundableMinor: 5000 };

  it("allows the computed amount as it is, with no reason", () => {
    expect(reviewOverride({ ...ok, requestedMinor: 2000, reason: "" })).toEqual({ ok: true, amountMinor: 2000, changed: false });
  });

  it("allows a change down or up inside 0 and what is left, with a reason", () => {
    expect(reviewOverride({ ...ok, requestedMinor: 1500, reason: "Box was dented" })).toEqual({ ok: true, amountMinor: 1500, changed: true });
    expect(reviewOverride({ ...ok, requestedMinor: 4000, reason: "Goodwill" })).toEqual({ ok: true, amountMinor: 4000, changed: true });
    expect(reviewOverride({ ...ok, requestedMinor: 0, reason: "Nothing due" })).toMatchObject({ ok: true, amountMinor: 0 });
    expect(reviewOverride({ ...ok, requestedMinor: 5000, reason: "Goodwill" })).toMatchObject({ ok: true });
  });

  it("lets a withdrawal's amount be raised but never lowered: deductions go through the inspection, with their note (Art. 14(2))", () => {
    expect(reviewOverride({ ...ok, kind: "withdrawal", requestedMinor: 1500, reason: "Box was dented" })).toEqual({ ok: false, problem: "below_working" });
    expect(reviewOverride({ ...ok, kind: "withdrawal", requestedMinor: 0, reason: "No" })).toEqual({ ok: false, problem: "below_working" });
    expect(reviewOverride({ ...ok, kind: "withdrawal", requestedMinor: 2000, reason: "" })).toEqual({ ok: true, amountMinor: 2000, changed: false });
    expect(reviewOverride({ ...ok, kind: "withdrawal", requestedMinor: 2500, reason: "Goodwill" })).toEqual({ ok: true, amountMinor: 2500, changed: true });
    expect(reviewOverride({ ...ok, kind: "withdrawal", requestedMinor: 2500, reason: "" })).toEqual({ ok: false, problem: "reason_needed" });
    // A voluntary return is the store's own offer: it can go lower.
    expect(reviewOverride({ ...ok, kind: "return", requestedMinor: 1500, reason: "Box was dented" })).toEqual({ ok: true, amountMinor: 1500, changed: true });
  });

  it("refuses a change without a reason, a negative or fractional amount, and more than is left", () => {
    expect(reviewOverride({ ...ok, requestedMinor: 1500, reason: "  " })).toEqual({ ok: false, problem: "reason_needed" });
    expect(reviewOverride({ ...ok, requestedMinor: -1, reason: "x" })).toEqual({ ok: false, problem: "negative" });
    expect(reviewOverride({ ...ok, requestedMinor: 10.5, reason: "x" })).toEqual({ ok: false, problem: "not_whole_number" });
    expect(reviewOverride({ ...ok, requestedMinor: 5001, reason: "x" })).toEqual({ ok: false, problem: "over_refundable" });
    expect(reviewOverride({ ...ok, requestedMinor: 1500, reason: "x".repeat(501) })).toEqual({ ok: false, problem: "reason_too_long" });
  });
});
