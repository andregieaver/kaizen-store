import { describe, expect, it } from "vitest";

import { financeStatement } from "./analytics-finance";
import { DEFAULT_ANALYTICS_SETTINGS, EMPTY_TOTALS } from "./analytics-kpi";
import { paymentsByMethod, type PaymentGroupRow } from "./analytics-payments";

const row = (over: Partial<PaymentGroupRow>): PaymentGroupRow => ({
  provider: "stripe",
  methodType: "card",
  wallet: null,
  manualMethod: null,
  currency: "NOK",
  payments: 1,
  receivedMinor: 10_000,
  refundedMinor: 0,
  feeShareMinor: 0,
  feePayments: 1,
  ...over,
});

/** 1 EUR = 11.5 NOK, as the fixtures' stores keep it; SEK has no rate. */
const toMain = (currency: string, minor: number) => (currency === "NOK" ? minor : currency === "EUR" ? Math.round(minor * 11.5) : null);

describe("payments by method (D288)", () => {
  it("groups a wallet over its card, converts each currency, and adds up to the money received", () => {
    const r = paymentsByMethod(
      [
        row({ methodType: "card", wallet: "apple_pay", payments: 2, receivedMinor: 20_000, feeShareMinor: 300, feePayments: 2 }),
        row({ methodType: "card", wallet: "apple_pay", currency: "EUR", payments: 1, receivedMinor: 1_000, feeShareMinor: 15 }),
        row({ methodType: "klarna", payments: 1, receivedMinor: 5_000, refundedMinor: 5_000, feeShareMinor: 75 }),
        row({ provider: "manual", methodType: null, manualMethod: "cash", payments: 1, receivedMinor: 2_000, feePayments: 0 }),
        row({ methodType: null, payments: 1, receivedMinor: 1_000, feeShareMinor: 15 }),
        row({ currency: "SEK", payments: 3, receivedMinor: 9_000 }),
      ],
      toMain,
      200,
    );
    expect(r.lines.map((l) => [l.label, l.payments, l.receivedMinor, l.refundedMinor, l.feesMinor])).toEqual([
      ["Apple Pay", 3, 31_500, 0, 300 + 173 + 3 * 200],
      ["Klarna", 1, 5_000, 5_000, 75 + 200],
      ["Recorded by staff: Cash", 1, 2_000, 0, null],
      ["Unknown", 1, 1_000, 0, 15 + 200],
    ]);
    expect(r.total.receivedMinor).toBe(r.lines.reduce((s, l) => s + l.receivedMinor, 0));
    expect(r.lines.reduce((s, l) => s + (l.share ?? 0), 0)).toBeCloseTo(1);
    expect(r).toMatchObject({ unconverted: 3, missingCurrencies: ["SEK"], unknown: 1 });
  });

  it("is empty with nothing paid", () => {
    expect(paymentsByMethod([], toMain, 200)).toEqual({ lines: [], total: { payments: 0, receivedMinor: 0, refundedMinor: 0, feesMinor: 0 }, unconverted: 0, missingCurrencies: [], unknown: 0, realFeePayments: 0, estimatedFeePayments: 0 });
  });
});

describe("lost disputes in the finance bridge (D288)", () => {
  const totals = { ...EMPTY_TOTALS, orders: 2, grossSalesMinor: 100_000, revenueMinor: 100_000, lineRevenueMinor: 100_000, knownCostRevenueMinor: 100_000, cogsMinor: 40_000 };

  it("takes a lost dispute off contribution profit as its own line, never as a refund, and still adds up", () => {
    const s = financeStatement({ ...totals, lostDisputesMinor: 8_000 }, DEFAULT_ANALYTICS_SETTINGS, 30);
    const line = (key: string) => s.lines.find((l) => l.key === key)?.amountMinor;
    expect(line("lostDisputes")).toBe(-8_000);
    expect(line("refunds")).toBe(0);
    expect(line("contributionProfit")).toBe(100_000 - 40_000 - 8_000);
    expect(s.reconciles).toBe(true);
  });

  it("has no such line when no dispute was lost", () => {
    expect(financeStatement(totals, DEFAULT_ANALYTICS_SETTINGS, 30).lines.some((l) => l.key === "lostDisputes")).toBe(false);
  });
});
