import { describe, expect, it } from "vitest";

import { refundableOf, splitRefund, type RefundablePayment } from "./refund-split";

const A: RefundablePayment = { id: "a", provider: "stripe", leftMinor: 29_800 };
const B: RefundablePayment = { id: "b", provider: "stripe", leftMinor: 89_900 };

describe("splitRefund", () => {
  it("takes from one payment when it has enough", () => {
    expect(splitRefund([A, B], 10_000)).toEqual([{ paymentId: "a", provider: "stripe", amountMinor: 10_000 }]);
  });

  it("never asks a payment for more than it has left: the rest comes from the next", () => {
    expect(splitRefund([A, B], 119_700)).toEqual([
      { paymentId: "a", provider: "stripe", amountMinor: 29_800 },
      { paymentId: "b", provider: "stripe", amountMinor: 89_900 },
    ]);
  });

  it("skips a payment with nothing left and refuses more than all of them have", () => {
    expect(splitRefund([{ ...A, leftMinor: 0 }, B], 500)).toEqual([{ paymentId: "b", provider: "stripe", amountMinor: 500 }]);
    expect(splitRefund([A, B], 119_701)).toBeNull();
    expect(splitRefund([], 1)).toBeNull();
  });

  it("has no parts for 0 and refuses a negative or fractional amount", () => {
    expect(splitRefund([A], 0)).toEqual([]);
    expect(splitRefund([A], -1)).toBeNull();
    expect(splitRefund([A], 1.5)).toBeNull();
  });

  it("keeps a payment taken outside Kaizen as its own part", () => {
    expect(splitRefund([A, { id: "m", provider: "manual", leftMinor: 1_000 }], 30_000)).toEqual([
      { paymentId: "a", provider: "stripe", amountMinor: 29_800 },
      { paymentId: "m", provider: "manual", amountMinor: 200 },
    ]);
  });

  it("the parts always add up to the amount and each stays within its payment (property)", () => {
    for (let seed = 1; seed < 400; seed += 1) {
      const pays = Array.from({ length: (seed % 4) + 1 }, (_, i) => ({ id: `p${i}`, provider: "stripe" as const, leftMinor: ((seed * (i + 7)) % 5000) - 200 }));
      const amount = (seed * 37) % 9000;
      const parts = splitRefund(pays, amount);
      if (amount > refundableOf(pays)) {
        expect(parts).toBeNull();
        continue;
      }
      expect(parts!.reduce((s, p) => s + p.amountMinor, 0)).toBe(amount);
      for (const p of parts!) {
        expect(p.amountMinor).toBeGreaterThan(0);
        expect(p.amountMinor).toBeLessThanOrEqual(Math.max(0, pays.find((x) => x.id === p.paymentId)!.leftMinor));
      }
    }
  });
});
