import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaymentCard, type PaymentCardDispute, type PaymentCardPayment } from "./payment-card";

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const payment = (over: Partial<PaymentCardPayment> = {}): PaymentCardPayment => ({
  id: "p1",
  provider: "stripe",
  amountMinor: 49_900,
  currency: "NOK",
  methodType: "card",
  wallet: "apple_pay",
  cardBrand: "visa",
  manualMethod: null,
  riskLevel: "normal",
  riskScore: 12,
  read: true,
  ...over,
});
const dispute = (over: Partial<PaymentCardDispute> = {}): PaymentCardDispute => ({
  id: "d1",
  reference: "dp_1",
  amountMinor: 49_900,
  currency: "NOK",
  reason: "fraudulent",
  status: "needs_response",
  evidenceDueBy: "2026-10-29T23:59:00.000Z",
  outcome: null,
  feeMinor: null,
  testMode: false,
  ...over,
});

describe("the order's Payment card (D288)", () => {
  it("says how it was paid and shows no risk when Stripe found it normal", () => {
    const words = text(renderToString(h(PaymentCard, { payments: [payment()], disputes: [], money, due: () => "Thu 29 Oct" })));
    expect(words).toContain("Apple Pay (Visa)");
    expect(words).not.toContain("risk");
  });

  it("shows an elevated risk and Unknown for a payment not read yet", () => {
    const words = text(renderToString(h(PaymentCard, { payments: [payment({ riskLevel: "elevated", riskScore: 71 }), payment({ id: "p2", read: false, methodType: null, wallet: null, riskLevel: null })], disputes: [], money, due: () => "" })));
    expect(words).toContain("Stripe: elevated risk (71 of 100)");
    expect(words).toContain("Unknown (not read from Stripe yet)");
  });

  it("shows an open dispute with its reason, deadline and the link to Stripe, and a lost one with its fee", () => {
    const open = renderToString(h(PaymentCard, { payments: [payment()], disputes: [dispute()], money, due: () => "Thu 29 Oct 2026, 23:59" }));
    expect(text(open)).toContain("Disputed");
    expect(text(open)).toContain("The cardholder says they did not make the payment");
    expect(text(open)).toContain("Evidence due Thu 29 Oct 2026, 23:59");
    expect(open).toContain("https://dashboard.stripe.com/payments/disputes/dp_1");
    const lost = text(renderToString(h(PaymentCard, { payments: [], disputes: [dispute({ status: "lost", outcome: "lost", feeMinor: 15_000 })], money, due: () => "" })));
    expect(lost).toContain("Dispute lost");
    expect(lost).toContain("150.00 NOK");
    expect(lost).not.toContain("Evidence due");
  });

  it("draws nothing for an order with no payment", () => {
    expect(renderToString(h(PaymentCard, { payments: [], disputes: [], money, due: () => "" }))).toBe("");
  });
});
