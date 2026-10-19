import { describe, expect, it } from "vitest";

import { feeParts, lineKindOf, payoutFlagged, reconcilePayout, type PayoutFacts, type PayoutLineFacts } from "./payouts";

const paid: PayoutFacts = { amountMinor: 18_850, status: "paid", automatic: true, linesRead: true, linesComplete: true };
const charge = (amount: number, fee: number, orderId: string | null = "o1"): PayoutLineFacts => ({ kind: "charge", amountMinor: amount, feeMinor: fee, netMinor: amount - fee, orderId });
const own: PayoutLineFacts = { kind: "payout", amountMinor: -18_850, feeMinor: 0, netMinor: -18_850, orderId: null };

describe("what a balance transaction is (D290)", () => {
  it("groups Stripe's types", () => {
    expect(lineKindOf("charge", "ch_1")).toBe("charge");
    expect(lineKindOf("payment", "py_1")).toBe("charge");
    expect(lineKindOf("refund", "re_1")).toBe("refund");
    expect(lineKindOf("payment_refund", "pyr_1")).toBe("refund");
    expect(lineKindOf("adjustment", "dp_1")).toBe("dispute");
    expect(lineKindOf("adjustment", "ia_1")).toBe("adjustment");
    expect(lineKindOf("stripe_fee", null)).toBe("fee");
    expect(lineKindOf("payout", "po_1")).toBe("payout");
    expect(lineKindOf("reserve_transaction", null)).toBe("other");
  });

  it("tells Stripe's fee from the application fee", () => {
    expect(feeParts([{ type: "stripe_fee", amount: 290 }, { type: "application_fee", amount: 150 }, { type: "tax", amount: 10 }])).toEqual({ providerFeeMinor: 300, applicationFeeMinor: 150 });
    expect(feeParts(null)).toEqual({ providerFeeMinor: 0, applicationFeeMinor: 0 });
  });
});

describe("whether a payout adds up (D290)", () => {
  it("adds up when its lines' net is the payout and every payment is tied to an order", () => {
    const r = reconcilePayout(paid, [charge(10_000, 450), charge(10_000, 450), { kind: "refund", amountMinor: -250, feeMinor: 0, netMinor: -250, orderId: "o2" }, own]);
    expect(r).toEqual({ state: "reconciles", linesNetMinor: 18_850, differenceMinor: 0, untiedMinor: 0, untiedCount: 0, feesMinor: 900 });
    expect(payoutFlagged(r.state)).toBe(false);
  });

  it("says by how much it does not add up", () => {
    const r = reconcilePayout(paid, [charge(10_000, 450), own]);
    expect(r.state).toBe("difference");
    expect(r.differenceMinor).toBe(18_850 - 9_550);
    expect(payoutFlagged(r.state)).toBe(true);
  });

  it("names money it cannot tie to an order", () => {
    const r = reconcilePayout({ ...paid, amountMinor: 19_350 }, [charge(10_000, 450), charge(10_000, 450, null), { kind: "adjustment", amountMinor: 250, feeMinor: 0, netMinor: 250, orderId: null }]);
    expect(r).toMatchObject({ state: "untied", untiedMinor: 9_550, untiedCount: 1, differenceMinor: 0 });
  });

  it("says when it cannot tell: not read, a manual payout, or too many lines", () => {
    expect(reconcilePayout({ ...paid, linesRead: false }, []).state).toBe("not_read");
    expect(reconcilePayout({ ...paid, automatic: false }, []).state).toBe("manual");
    expect(reconcilePayout({ ...paid, linesComplete: false }, [charge(10_000, 450)]).state).toBe("incomplete");
    expect(reconcilePayout({ ...paid, linesComplete: false }, [charge(10_000, 450)]).differenceMinor).toBe(0);
  });
});
