import { describe, expect, it } from "vitest";

import {
  disputeClosed,
  disputeDashboardUrl,
  disputeEventText,
  disputeOutcome,
  disputeReasonWords,
  disputeRecord,
  factsOfCharge,
  methodGroup,
  methodWords,
  reminderDue,
  riskLevelOf,
  riskShown,
} from "./payment-facts";

describe("a charge's facts (D288)", () => {
  it("keeps what Stripe gave, a wallet over its card", () => {
    expect(
      factsOfCharge({
        id: "ch_1",
        payment_method_details: { type: "card", card: { brand: "mastercard", wallet: { type: "google_pay" } } },
        outcome: { risk_level: "highest", risk_score: 91 },
      }),
    ).toEqual({ methodType: "card", wallet: "google_pay", cardBrand: "mastercard", riskLevel: "highest", riskScore: 91, chargeReference: "ch_1" });
  });

  it("leaves out what Stripe did not give or gave in an unexpected shape, and never guesses a risk", () => {
    expect(factsOfCharge({ id: "ch_2" })).toEqual({ methodType: null, wallet: null, cardBrand: null, riskLevel: null, riskScore: null, chargeReference: "ch_2" });
    expect(factsOfCharge({ id: "ch_3", payment_method_details: { type: "<script>" }, outcome: { risk_level: "low", risk_score: 140 } })).toMatchObject({
      methodType: null,
      riskLevel: "unknown",
      riskScore: null,
    });
    expect(riskLevelOf("not_assessed")).toBe("not_assessed");
  });

  it("shows only an elevated or highest risk", () => {
    expect(["normal", "elevated", "highest", "not_assessed", "unknown", null].filter((r) => riskShown(r))).toEqual(["elevated", "highest"]);
  });
});

describe("the report's groups", () => {
  it("groups by wallet, then method, staff's own method, and Unknown for an unread payment", () => {
    expect(methodGroup({ provider: "stripe", methodType: "card", wallet: "apple_pay", manualMethod: null })).toEqual({ key: "wallet:apple_pay", label: "Apple Pay" });
    expect(methodGroup({ provider: "stripe", methodType: "mobilepay", wallet: null, manualMethod: null })).toEqual({ key: "method:mobilepay", label: "MobilePay" });
    expect(methodGroup({ provider: "stripe", methodType: "some_new_method", wallet: null, manualMethod: null }).label).toBe("Some new method");
    expect(methodGroup({ provider: "stripe", methodType: null, wallet: null, manualMethod: null })).toEqual({ key: "unknown", label: "Unknown" });
    expect(methodGroup({ provider: "manual", methodType: null, wallet: null, manualMethod: "bank_transfer" }).label).toBe("Recorded by staff: Bank transfer");
    expect(methodGroup({ provider: "exchange", methodType: null, wallet: null, manualMethod: null }).key).toBe("exchange");
    expect(methodWords({ provider: "stripe", methodType: "card", wallet: null, manualMethod: null, cardBrand: "visa" })).toBe("Card (Visa)");
  });
});

describe("disputes", () => {
  const base = {
    id: "dp_1",
    amount: 49_900,
    currency: "nok",
    reason: "product_not_received",
    status: "needs_response",
    created: 1_760_000_000,
    livemode: false,
    charge: "ch_1",
    payment_intent: { id: "pi_1" },
    evidence_details: { due_by: 1_760_600_000 },
  };

  it("reads a dispute as Stripe sent it, in its own currency", () => {
    expect(disputeRecord(base)).toEqual({
      reference: "dp_1",
      chargeReference: "ch_1",
      intent: "pi_1",
      amountMinor: 49_900,
      currency: "NOK",
      reason: "product_not_received",
      status: "needs_response",
      evidenceDueBy: new Date(1_760_600_000_000),
      outcome: null,
      fundsWithdrawnMinor: null,
      feeMinor: null,
      testMode: true,
      openedAt: new Date(1_760_000_000_000),
    });
  });

  it("counts withdrawn money and fees only in the dispute's currency", () => {
    const lost = disputeRecord({ ...base, status: "lost", balance_transactions: [{ amount: -49_900, fee: 15_000, currency: "nok" }, { amount: -4_300, fee: 1_500, currency: "eur" }] });
    expect(lost).toMatchObject({ outcome: "lost", fundsWithdrawnMinor: 49_900, feeMinor: 15_000 });
    const reinstated = disputeRecord({ ...base, status: "won", balance_transactions: [{ amount: -49_900, fee: 15_000, currency: "nok" }, { amount: 49_900, fee: 0, currency: "nok" }] });
    expect(reinstated).toMatchObject({ outcome: "won", fundsWithdrawnMinor: 0, feeMinor: 15_000 });
    expect(disputeRecord({ ...base, balance_transactions: [{ amount: -4_300, fee: 1_500, currency: "eur" }] })).toMatchObject({ fundsWithdrawnMinor: null, feeMinor: null });
  });

  it("refuses a status it does not know rather than guessing", () => {
    expect(disputeRecord({ ...base, status: "maybe" })).toBeNull();
    expect(disputeRecord({ ...base, amount: 0 })).toBeNull();
  });

  it("closes as won or lost; an inquiry closed or a prevented dispute took nothing", () => {
    expect(disputeOutcome("lost")).toBe("lost");
    expect(disputeOutcome("won")).toBe("won");
    expect(disputeOutcome("warning_closed")).toBe("won");
    expect(disputeOutcome("prevented")).toBe("won");
    expect(disputeOutcome("under_review")).toBeNull();
    expect(disputeClosed("needs_response")).toBe(false);
  });

  it("reminds once, within three days of a deadline that needs a response", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const at = (days: number) => new Date(now.getTime() + days * 86_400_000);
    expect(reminderDue({ status: "needs_response", evidenceDueBy: at(2), remindedAt: null, now })).toBe(true);
    expect(reminderDue({ status: "needs_response", evidenceDueBy: at(4), remindedAt: null, now })).toBe(false);
    expect(reminderDue({ status: "needs_response", evidenceDueBy: at(-1), remindedAt: null, now })).toBe(false);
    expect(reminderDue({ status: "under_review", evidenceDueBy: at(2), remindedAt: null, now })).toBe(false);
    expect(reminderDue({ status: "needs_response", evidenceDueBy: at(2), remindedAt: now, now })).toBe(false);
  });

  it("has words for reasons and history, and a link to the store's Stripe Dashboard", () => {
    expect(disputeReasonWords("fraudulent")).toBe("The cardholder says they did not make the payment");
    expect(disputeReasonWords("brand_new_reason")).toBe("Brand new reason");
    expect(disputeReasonWords(null)).toBe("Unknown");
    const money = (minor: number) => `${minor / 100} kr`;
    expect(disputeEventText("dispute.opened", { amount: 49_900, reason: "duplicate" }, money)).toBe("Disputed 499 kr with the bank: the customer says they were charged twice");
    expect(disputeEventText("dispute.closed", { amount: 49_900, outcome: "lost" }, money)).toBe("Dispute lost: 499 kr taken back by the bank");
    expect(disputeEventText("dispute.closed", { amount: 49_900, outcome: "won" }, money)).toBe("Dispute closed in the store's favour: 499 kr kept");
    expect(disputeDashboardUrl("dp_1", true)).toBe("https://dashboard.stripe.com/test/payments/disputes/dp_1");
  });
});
