import { describe, expect, it } from "vitest";

import { paymentIntentOf, platformPayoutState, reconcilePlatformPayout, type PlatformPayoutLine } from "./platform-payouts";

const paid = { amountMinor: 36_100, status: "paid" as const, automatic: true, linesRead: true, linesComplete: true };

describe("Kaizena Flow's own payouts (D509)", () => {
  it("adds a payout up from its lines, money for a sale tied to one", () => {
    const lines: PlatformPayoutLine[] = [
      { kind: "charge", amountMinor: 37_375, feeMinor: 1_275, netMinor: 36_100, saleId: "s1" },
      { kind: "payout", amountMinor: -36_100, feeMinor: 0, netMinor: -36_100, saleId: null },
    ];
    expect(reconcilePlatformPayout(paid, lines)).toMatchObject({ state: "reconciles", linesNetMinor: 36_100, feesMinor: 1_275, differenceMinor: 0 });
    expect(reconcilePlatformPayout(paid, [{ ...lines[0], saleId: null }, lines[1]])).toMatchObject({ state: "untied", untiedCount: 1, untiedMinor: 36_100 });
    expect(reconcilePlatformPayout({ ...paid, amountMinor: 36_000 }, lines)).toMatchObject({ state: "difference", differenceMinor: -100 });
    expect(reconcilePlatformPayout({ ...paid, linesRead: false }, [])).toMatchObject({ state: "not_read" });
    expect(reconcilePlatformPayout({ ...paid, automatic: false }, [])).toMatchObject({ state: "manual" });
  });

  it("says the same from the lines' totals as the list reads them", () => {
    expect(platformPayoutState({ ...paid, linesNetMinor: 36_100, untiedCount: 0 })).toBe("reconciles");
    expect(platformPayoutState({ ...paid, linesNetMinor: 36_100, untiedCount: 2 })).toBe("untied");
    expect(platformPayoutState({ ...paid, linesNetMinor: 1, untiedCount: 0 })).toBe("difference");
    expect(platformPayoutState({ ...paid, linesComplete: false, linesNetMinor: 1, untiedCount: 0 })).toBe("incomplete");
    expect(platformPayoutState({ ...paid, linesRead: false, linesNetMinor: 0, untiedCount: 0 })).toBe("not_read");
    expect(platformPayoutState({ ...paid, automatic: false, linesRead: false, linesNetMinor: 0, untiedCount: 0 })).toBe("manual");
  });

  it("finds the payment a line was for by its payment intent", () => {
    expect(paymentIntentOf({ object: "charge", id: "ch_1", payment_intent: "pi_1" })).toBe("pi_1");
    expect(paymentIntentOf({ object: "refund", id: "re_1", payment_intent: { id: "pi_2" } })).toBe("pi_2");
    expect(paymentIntentOf({ object: "dispute", id: "dp_1", payment_intent: null, charge: { id: "ch_3", payment_intent: "pi_3" } })).toBe("pi_3");
    expect(paymentIntentOf({ object: "payout", id: "po_1" })).toBeNull();
    expect(paymentIntentOf("ch_1")).toBeNull();
    expect(paymentIntentOf(null)).toBeNull();
  });
});
