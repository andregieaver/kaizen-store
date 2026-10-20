import { describe, expect, it } from "vitest";

import { decimalString, isPaymentProvider, minorFromDecimal, paymentFate, PAYMENT_PROVIDERS, type PaymentState } from "./payment-providers";

const order = { delivery: false, draft: false };

describe("what becomes of an order from a provider's answer (D292)", () => {
  it("completes it when paid, holds or waits when unsettled, and cancels it when the payment fails or lapses", () => {
    expect(paymentFate("paid", "order", order)).toEqual({ kind: "paid" });
    expect(paymentFate("unsettled", "order", order)).toEqual({ kind: "unsettled" });
    expect(paymentFate("failed", "order", order)).toEqual({ kind: "ended", status: "failed", cancel: true });
    expect(paymentFate("expired", "order", order)).toEqual({ kind: "ended", status: "cancelled", cancel: true });
    expect(paymentFate("open", "order", order)).toEqual({ kind: "none" });
  });

  it("keeps a weekly delivery and a staff-made order when their payment ends, and never holds a delivery's card", () => {
    expect(paymentFate("expired", "order", { delivery: true, draft: false })).toEqual({ kind: "ended", status: "cancelled", cancel: false });
    expect(paymentFate("failed", "order", { delivery: false, draft: true })).toEqual({ kind: "ended", status: "failed", cancel: false });
    expect(paymentFate("unsettled", "order", { delivery: true, draft: false })).toEqual({ kind: "none" });
    expect(paymentFate("paid", "order", { delivery: true, draft: false })).toEqual({ kind: "paid" });
  });

  it("settles a change's or an exchange's difference only, never the order", () => {
    for (const purpose of ["edit", "exchange", "terms"] as const) {
      expect(paymentFate("paid", purpose, order)).toEqual({ kind: "settle_change", outcome: "pay" });
      expect(paymentFate("failed", purpose, order)).toEqual({ kind: "settle_change", outcome: "failed" });
      expect(paymentFate("expired", purpose, order)).toEqual({ kind: "settle_change", outcome: "cancelled" });
      for (const state of ["open", "unsettled"] as PaymentState[]) expect(paymentFate(state, purpose, order)).toEqual({ kind: "none" });
    }
  });

  it("knows its providers", () => {
    expect(PAYMENT_PROVIDERS).toEqual(["stripe", "mollie"]);
    expect(isPaymentProvider("mollie")).toBe(true);
    expect(isPaymentProvider("manual")).toBe(false);
  });
});

describe("decimal amounts", () => {
  it("writes minor units as a decimal string by code, and reads one back", () => {
    expect(decimalString(12345)).toBe("123.45");
    expect(decimalString(5)).toBe("0.05");
    expect(decimalString(0)).toBe("0.00");
    expect(decimalString(-250)).toBe("-2.50");
    expect(decimalString(1500, 0)).toBe("1500");
    expect(() => decimalString(1.5)).toThrow();
    expect(minorFromDecimal("123.45")).toBe(12345);
    expect(minorFromDecimal("10")).toBe(1000);
    expect(minorFromDecimal("0.5")).toBe(50);
    expect(minorFromDecimal("-2.50")).toBe(-250);
    expect(minorFromDecimal("1.234")).toBeNull();
    expect(minorFromDecimal("abc")).toBeNull();
    for (const minor of [0, 1, 99, 100, 123456789]) expect(minorFromDecimal(decimalString(minor))).toBe(minor);
  });
});
