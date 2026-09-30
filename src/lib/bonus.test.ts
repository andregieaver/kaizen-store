import { describe, expect, it } from "vitest";

import {
  BONUS_DEFAULTS,
  MIN_CHARGE_MINOR,
  allocateCredit,
  bonusSettingsInput,
  convertCredits,
  earnAmount,
  minChargeMinor,
  planCredit,
  redeemLimit,
  restoreShare,
} from "./bonus";
import { OFFERABLE_CURRENCIES, minorUnitDigits } from "./money";

const rates = new Map([
  ["NOK", { rate: 11.5 }],
  ["SEK", { rate: 11 }],
  ["EUR", { rate: 1 }],
  ["DKK", { rate: null }],
]);

describe("what is earned", () => {
  it("is the percentage of what was paid, rounded down, never negative", () => {
    expect(earnAmount(10_000, 500)).toBe(500);
    expect(earnAmount(9_999, 500)).toBe(499);
    expect(earnAmount(19, 500)).toBe(0);
    expect(earnAmount(10_000, 275)).toBe(275);
    expect(earnAmount(0, 500)).toBe(0);
    expect(earnAmount(-5_000, 500)).toBe(0);
    expect(earnAmount(10_000, 0)).toBe(0);
    expect(earnAmount(Number.NaN, 500)).toBe(0);
  });
});

describe("the most credits usable on an order", () => {
  const base = { eligibleMinor: 50_000, dueMinor: 59_900, balanceMinor: 1_000_000, maxPercent: 50 };
  it("is the owner's percentage of the goods when the customer has more", () => {
    expect(redeemLimit(base)).toBe(25_000);
  });
  it("is what the customer has when that is less", () => {
    expect(redeemLimit({ ...base, balanceMinor: 7_000 })).toBe(7_000);
  });
  it("never leaves less than the provider's least charge to pay", () => {
    // 4 NOK of goods and nothing else due: 3 NOK must be left, so 1 NOK at most.
    expect(
      redeemLimit({ eligibleMinor: 400, dueMinor: 400, balanceMinor: 10_000, maxPercent: 90, minPayableMinor: 300 }),
    ).toBe(100);
    expect(
      redeemLimit({ eligibleMinor: 400, dueMinor: 300, balanceMinor: 10_000, maxPercent: 90, minPayableMinor: 300 }),
    ).toBe(0);
    expect(
      redeemLimit({ eligibleMinor: 400, dueMinor: 100, balanceMinor: 10_000, maxPercent: 90, minPayableMinor: 300 }),
    ).toBe(0);
  });
  it("is nothing below the owner's minimum, and nothing when there is nothing to take it off", () => {
    expect(redeemLimit({ ...base, balanceMinor: 1_999, minRedeemMinor: 2_000 })).toBe(0);
    expect(redeemLimit({ ...base, balanceMinor: 2_000, minRedeemMinor: 2_000 })).toBe(2_000);
    expect(redeemLimit({ ...base, eligibleMinor: 0 })).toBe(0);
    expect(redeemLimit({ ...base, balanceMinor: 0 })).toBe(0);
  });
});

describe("what comes back when part of an order is refunded", () => {
  it("is the refunded share of what was used, rounded down, all of it when all is refunded", () => {
    expect(restoreShare(1_000, 3_000, 9_000)).toBe(333);
    expect(restoreShare(1_000, 9_000, 9_000)).toBe(1_000);
    expect(restoreShare(1_000, 10_000, 9_000)).toBe(1_000);
    expect(restoreShare(0, 3_000, 9_000)).toBe(0);
    expect(restoreShare(1_000, 0, 9_000)).toBe(0);
    expect(restoreShare(1_000, 3_000, 0)).toBe(0);
  });
  it("adds up to the whole however a refund is cut, counted against what came back so far", () => {
    const used = 1_001;
    const total = 7_777;
    let back = 0;
    let refunded = 0;
    for (const part of [1_111, 2_222, 444, 4_000]) {
      refunded += part;
      const target = restoreShare(used, refunded, total);
      back = target;
    }
    expect(refunded).toBe(7_777);
    expect(back).toBe(used);
  });
});

describe("converting credits between currencies", () => {
  it("rounds down or up at the store's rates, and never to a step", () => {
    expect(convertCredits(11_500, "NOK", "EUR", rates)).toBe(1_000);
    expect(convertCredits(1_149, "NOK", "EUR", rates, "down")).toBe(99);
    expect(convertCredits(1_149, "NOK", "EUR", rates, "up")).toBe(100);
    expect(convertCredits(1_000, "EUR", "NOK", rates)).toBe(11_500);
    expect(convertCredits(115, "NOK", "EUR", rates, "down")).toBe(10);
    expect(convertCredits(500, "NOK", "SEK", rates)).toBe(478);
  });
  it("is the same amount for the same currency, and null without a rate", () => {
    expect(convertCredits(123, "NOK", "NOK", rates)).toBe(123);
    expect(convertCredits(123, "NOK", "DKK", rates)).toBeNull();
    expect(convertCredits(123, "NOK", "CHF", rates)).toBeNull();
  });
  it("needs only the rates while every currency has two minor-unit digits (the database converts the same way)", () => {
    for (const currency of OFFERABLE_CURRENCIES) expect(minorUnitDigits(currency)).toBe(2);
  });
});

describe("spreading credits over the lines", () => {
  it("adds up to the whole and follows what each line can take", () => {
    expect(allocateCredit([10_000, 20_000, 30_000], 6_000)).toEqual([1_000, 2_000, 3_000]);
    const parts = allocateCredit([3_333, 3_333, 3_334], 1_000);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000);
    expect(parts).toEqual([333, 333, 334]);
  });
  it("gives no line more than it can take, nothing to a line that can take none, and no more than all can", () => {
    expect(allocateCredit([0, 100, 0], 50)).toEqual([0, 50, 0]);
    expect(allocateCredit([100, 100], 1_000)).toEqual([100, 100]);
    expect(allocateCredit([100, 100], 0)).toEqual([0, 0]);
    expect(allocateCredit([], 100)).toEqual([]);
    for (const credit of [1, 2, 3, 7, 99, 1_001]) {
      const caps = [333, 0, 1, 667, 5];
      const out = allocateCredit(caps, credit);
      expect(out.reduce((a, b) => a + b, 0)).toBe(
        Math.min(
          credit,
          caps.reduce((a, b) => a + b, 0),
        ),
      );
      out.forEach((part, i) => expect(part).toBeLessThanOrEqual(caps[i]));
    }
  });
});

describe("the plan for an order", () => {
  const order = {
    eligibleMinor: [24_900, 24_900, 0],
    dueMinor: 59_700,
    balanceMinor: 1_000_000,
    maxPercent: 50,
    minRedeemMinor: 0,
    minPayableMinor: 300,
  };
  it("clamps what was asked to what may be used, and spreads it", () => {
    expect(planCredit({ ...order, requestMinor: 10_000_000 })).toEqual({
      maxUsableMinor: 24_900,
      usingMinor: 24_900,
      lines: [12_450, 12_450, 0],
    });
    expect(planCredit({ ...order, requestMinor: 5_000 })).toMatchObject({ maxUsableMinor: 24_900, usingMinor: 5_000 });
    expect(planCredit({ ...order, requestMinor: 0 })).toMatchObject({
      maxUsableMinor: 24_900,
      usingMinor: 0,
      lines: [0, 0, 0],
    });
  });
  it("uses nothing when what was asked is below the owner's minimum", () => {
    expect(planCredit({ ...order, minRedeemMinor: 10_000, requestMinor: 5_000 })).toMatchObject({ usingMinor: 0 });
    expect(planCredit({ ...order, minRedeemMinor: 10_000, requestMinor: 10_000 })).toMatchObject({
      usingMinor: 10_000,
    });
  });
  it("uses nothing when nothing is eligible (a subscription, a part left for the venue, a free product)", () => {
    expect(planCredit({ ...order, eligibleMinor: [0, 0], requestMinor: 1_000 })).toEqual({
      maxUsableMinor: 0,
      usingMinor: 0,
      lines: [0, 0],
    });
  });
});

describe("the provider's least charge", () => {
  it("is known for every currency a store can offer, and the euro's for one it does not know", () => {
    for (const currency of OFFERABLE_CURRENCIES) expect(MIN_CHARGE_MINOR[currency]).toBeGreaterThan(0);
    expect(minChargeMinor("NOK")).toBe(300);
    expect(minChargeMinor("EUR")).toBe(50);
    expect(minChargeMinor("XXX")).toBe(50);
  });
});

describe("the program's settings", () => {
  it("are off by default and accept only what the owner may promise", () => {
    expect(BONUS_DEFAULTS).toMatchObject({
      enabled: false,
      earnBps: 500,
      pendingDays: 14,
      maxRedeemPercent: 50,
      minRedeemMinor: 0,
      expiresMonths: null,
    });
    expect(bonusSettingsInput.safeParse({ ...BONUS_DEFAULTS, enabled: true }).success).toBe(true);
    expect(bonusSettingsInput.safeParse({ ...BONUS_DEFAULTS, earnBps: 5_001 }).success).toBe(false);
    expect(bonusSettingsInput.safeParse({ ...BONUS_DEFAULTS, maxRedeemPercent: 91 }).success).toBe(false);
    expect(bonusSettingsInput.safeParse({ ...BONUS_DEFAULTS, maxRedeemPercent: 0 }).success).toBe(false);
    expect(bonusSettingsInput.safeParse({ ...BONUS_DEFAULTS, pendingDays: 91 }).success).toBe(false);
    expect(bonusSettingsInput.safeParse({ ...BONUS_DEFAULTS, expiresMonths: 0 }).success).toBe(false);
    expect(bonusSettingsInput.safeParse({ ...BONUS_DEFAULTS, earnBps: 2.5 }).success).toBe(false);
  });
});
