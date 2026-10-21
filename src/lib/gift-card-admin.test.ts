import { describe, expect, it } from "vitest";

import { cardState, EXPIRY_CHOICES, expiryWords, liabilityLines } from "./gift-card-admin";

/** The owner's view of gift cards (D300 F4): a card's state from its row and balance, and the liability's sums per currency. */
describe("a gift card's state", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const card = { status: "active", sentAt: "2026-10-01T00:00:00Z", expiresAt: "2029-10-01T00:00:00Z", balanceMinor: 5_000 };

  it("is read from the row, the balance and the time, in order", () => {
    expect(cardState(card, now)).toBe("active");
    expect(cardState({ ...card, balanceMinor: 0 }, now)).toBe("spent");
    expect(cardState({ ...card, expiresAt: "2026-10-20T00:00:00Z" }, now)).toBe("expired");
    expect(cardState({ ...card, sentAt: null }, now)).toBe("waiting");
    // Deactivated wins over anything else, and a card never sent waits before it can be spent or expire.
    expect(cardState({ ...card, status: "deactivated", balanceMinor: 0 }, now)).toBe("deactivated");
    expect(cardState({ ...card, sentAt: null, expiresAt: "2026-10-20T00:00:00Z" }, now)).toBe("waiting");
    expect(cardState({ ...card, expiresAt: null }, now)).toBe("active");
  });
});

describe("the expiry choices", () => {
  it("are in the database's range, or never, in words", () => {
    for (const months of EXPIRY_CHOICES) if (months !== null) expect(months >= 12 && months <= 120).toBe(true);
    expect(EXPIRY_CHOICES).toContain(null);
    expect([expiryWords(12), expiryWords(36), expiryWords(18), expiryWords(null)]).toEqual(["1 year", "3 years", "18 months", "Never"]);
  });
});

describe("the liability's lines", () => {
  it("keep each currency on its own, never added across, spent and expired as amounts out", () => {
    const lines = liabilityLines(
      [
        { currency: "NOK", kind: "issue", amountMinor: 80_000 },
        { currency: "NOK", kind: "spend", amountMinor: -12_500 },
        { currency: "NOK", kind: "refund", amountMinor: 2_500 },
        { currency: "NOK", kind: "adjust", amountMinor: -1_000 },
        { currency: "eur ", kind: "issue", amountMinor: 5_000 },
        { currency: "EUR", kind: "expire", amountMinor: -700 },
        { currency: "EUR", kind: "void", amountMinor: -300 },
      ],
      [{ currency: "NOK", amountMinor: 69_000, cards: 2 }],
    );
    expect(lines).toEqual([
      { currency: "NOK", outstandingMinor: 69_000, cards: 2, issuedMinor: 80_000, spentMinor: 12_500, refundedMinor: 2_500, adjustedMinor: -1_000, expiredMinor: 0, voidedMinor: 0 },
      { currency: "EUR", outstandingMinor: 0, cards: 0, issuedMinor: 5_000, spentMinor: 0, refundedMinor: 0, adjustedMinor: 0, expiredMinor: 700, voidedMinor: 300 },
    ]);
    expect(liabilityLines([], [])).toEqual([]);
  });
});
