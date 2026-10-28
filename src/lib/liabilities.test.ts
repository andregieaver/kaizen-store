import { describe, expect, it } from "vitest";

import { BONUS_ROLL_KINDS, rollForward } from "./liabilities";

describe("a liability's roll-forward (D381)", () => {
  it("lists the movements in the ledger's order and adds up from opening to closing", () => {
    const roll = rollForward(
      "NOK",
      10_000,
      [
        { kind: "redeem", amountMinor: -3_000 },
        { kind: "earn", amountMinor: 5_000 },
        { kind: "earn", amountMinor: 1_000 },
        { kind: "expire", amountMinor: -500 },
      ],
      12_500,
      BONUS_ROLL_KINDS,
    );
    expect(roll.movements).toEqual([
      { key: "earn", amountMinor: 6_000 },
      { key: "redeem", amountMinor: -3_000 },
      { key: "expire", amountMinor: -500 },
    ]);
    expect(roll).toMatchObject({ addsUp: true, expectedClosingMinor: 12_500 });
  });

  it("keeps a kind it does not know, at the end, and says when the sums do not add up rather than making them", () => {
    const roll = rollForward("EUR", 0, [{ kind: "earn", amountMinor: 100 }, { kind: "something_new", amountMinor: 5 }], 100, BONUS_ROLL_KINDS);
    expect(roll.movements.map((m) => m.key)).toEqual(["earn", "something_new"]);
    expect(roll).toMatchObject({ addsUp: false, expectedClosingMinor: 105, closingMinor: 100 });
  });
});

describe("a liability's row (D381)", () => {
  it("puts each kind in its column for its ledger, and an unknown one in other", async () => {
    const { liabilityRow } = await import("./liabilities");
    const gift = rollForward("EUR", 1_000, [{ kind: "issue", amountMinor: 5_000 }, { kind: "spend", amountMinor: -2_000 }, { kind: "held", amountMinor: -500 }, { kind: "new", amountMinor: 1 }], 3_501, []);
    const row = liabilityRow("gift_cards", gift, 3_000);
    expect(row.columns).toMatchObject({ granted: 5_000, used: -2_500, other: 1, expired: 0 });
    expect(row).toMatchObject({ addsUp: true, differenceMinor: 0, owedNowMinor: 3_000 });
    const bonus = liabilityRow("bonus", rollForward("NOK", 0, [{ kind: "referral", amountMinor: 100 }, { kind: "earn", amountMinor: 50 }], 140, BONUS_ROLL_KINDS), null);
    expect(bonus.columns.granted).toBe(150);
    expect(bonus).toMatchObject({ addsUp: false, differenceMinor: -10 });
  });
});
