import { describe, expect, it } from "vitest";

import { t } from "./i18n";
import { BONUS_DEFAULTS, type BonusSettings } from "./bonus";
import {
  adjustmentPhrase,
  adjustmentQuestion,
  bpsToPercentText,
  earnExample,
  formFromSettings,
  isUsableNow,
  moneyIn,
  orderedProblems,
  overviewRows,
  percentLabel,
  percentTextToBps,
  readAdjustment,
  readBonusForm,
  refundNotes,
  rulesSummary,
  signedMoney,
  waitWords,
} from "./bonus-admin";

/** Intl puts a no-break space after the currency; tests compare plain spaces. */
const flat = (text: string) => text.replace(/\u00a0/g, " ");
const NOK = (minor: number) => flat(moneyIn("NOK", "en-GB")(minor));
const on: BonusSettings = { ...BONUS_DEFAULTS, enabled: true };

describe("percent and basis points", () => {
  it("reads what people type, exactly", () => {
    expect(percentTextToBps("5")).toBe(500);
    expect(percentTextToBps("2,5")).toBe(250);
    expect(percentTextToBps("2.75")).toBe(275);
    expect(percentTextToBps(" 4.35 % ")).toBe(435);
    expect(percentTextToBps("0")).toBe(0);
    expect(percentTextToBps("50")).toBe(5000);
  });

  it("refuses what is not a percentage", () => {
    for (const bad of ["", "abc", "-1", "2.555", "1e2", "5,,5", "1 000"]) expect(percentTextToBps(bad), bad).toBeNull();
  });

  it("writes basis points back the way they are typed", () => {
    expect(bpsToPercentText(500)).toBe("5");
    expect(bpsToPercentText(250)).toBe("2.5");
    expect(bpsToPercentText(275)).toBe("2.75");
    expect(percentLabel(500)).toBe("5%");
    for (const bps of [0, 1, 99, 100, 435, 5000]) expect(percentTextToBps(bpsToPercentText(bps))).toBe(bps);
  });
});

describe("the example beside the percentage", () => {
  it("shows what 1,000 earns, rounded down like the program", () => {
    expect(flat(earnExample(500, "NOK", "en-GB").sentence)).toBe("A NOK 1,000.00 order earns NOK 50.00 in credits.");
    expect(flat(earnExample(275, "NOK", "en-GB").earnLabel)).toBe("NOK 27.50");
    expect(flat(earnExample(0, "NOK", "en-GB").earnLabel)).toBe("NOK 0.00");
  });

  it("works for currencies with no decimals", () => {
    expect(earnExample(500, "HUF", "en-GB").earnLabel).toContain("50");
  });
});

describe("the settings form", () => {
  it("starts from the settings in words the owner types", () => {
    expect(formFromSettings(on, "NOK")).toEqual({
      enabled: true,
      earnPercent: "5",
      pendingDays: "14",
      maxRedeemPercent: "50",
      minRedeem: "",
      expires: false,
      expiresMonths: "12",
    });
    const values = formFromSettings({ ...on, minRedeemMinor: 4950, expiresMonths: 18, earnBps: 250 }, "NOK");
    expect(values).toMatchObject({ earnPercent: "2.5", minRedeem: "49,50", expires: true, expiresMonths: "18" });
  });

  it("is read back into the same settings", () => {
    const settings: BonusSettings = {
      enabled: true,
      earnBps: 250,
      pendingDays: 7,
      maxRedeemPercent: 30,
      minRedeemMinor: 10000,
      expiresMonths: 24,
    };
    expect(readBonusForm(formFromSettings(settings, "NOK"), "NOK")).toEqual({ ok: true, settings });
    expect(readBonusForm(formFromSettings(on, "NOK"), "NOK")).toEqual({ ok: true, settings: on });
  });

  it("ignores the months when credits do not expire, and needs them when they do", () => {
    const values = { ...formFromSettings(on, "NOK"), expiresMonths: "nonsense" };
    expect(readBonusForm(values, "NOK")).toMatchObject({ ok: true, settings: { expiresMonths: null } });
    expect(readBonusForm({ ...values, expires: true }, "NOK")).toMatchObject({
      ok: false,
      errors: { expiresMonths: expect.any(String) },
    });
  });

  it("says each problem at its own field, in the contract's words where it has them", () => {
    const read = readBonusForm(
      {
        enabled: true,
        earnPercent: "60",
        pendingDays: "120",
        maxRedeemPercent: "100",
        minRedeem: "lots",
        expires: true,
        expiresMonths: "0",
      },
      "NOK",
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.errors.earnPercent).toBe("Keep credits back at 50% or less.");
    expect(read.errors.pendingDays).toBe("Keep the wait at 90 days or less.");
    expect(read.errors.maxRedeemPercent).toBe("Keep the most at 90% so the order still has something to pay.");
    expect(read.errors.minRedeem).toContain("Write an amount in NOK");
    expect(read.errors.expiresMonths).toBe("Write a number of months from 1 to 60.");
    // The form's order is the order problems are read and focused in.
    expect(orderedProblems(read.errors).map((p) => p.field)).toEqual([
      "earnPercent",
      "pendingDays",
      "maxRedeemPercent",
      "minRedeem",
      "expiresMonths",
    ]);
  });

  it("explains unreadable numbers", () => {
    const read = readBonusForm(
      { ...formFromSettings(on, "NOK"), earnPercent: "five", pendingDays: "", maxRedeemPercent: "a lot" },
      "NOK",
    );
    expect(read).toMatchObject({
      ok: false,
      errors: {
        earnPercent: "Write a percentage such as 5 or 2.5.",
        pendingDays: expect.stringContaining("days"),
        maxRedeemPercent: expect.stringContaining("percentage"),
      },
    });
  });

  it("allows 0% credits back and no wait, and needs at least 1% usable", () => {
    expect(readBonusForm({ ...formFromSettings(on, "NOK"), earnPercent: "0", pendingDays: "0" }, "NOK")).toMatchObject({
      ok: true,
    });
    expect(readBonusForm({ ...formFromSettings(on, "NOK"), maxRedeemPercent: "0" }, "NOK")).toMatchObject({
      ok: false,
      errors: { maxRedeemPercent: "Allow at least 1% of an order." },
    });
  });
});

describe("the rules in words", () => {
  it("says each rule the way a shopper reads it, then the store's own limits", () => {
    expect(rulesSummary({ ...on, minRedeemMinor: 5000, expiresMonths: 12 }, NOK, "NOK").map(flat)).toEqual([
      "You earn 5% back in bonus credits on what you pay for goods, and the credits are usable 14 days after you pay.",
      "Credits come off the price of goods at checkout, up to the store's limit on each order; you pay shipping yourself. Credits you do not use expire 12 months after you earn them, the oldest first.",
      "The store's limit: credits can pay for up to 50% of an order's goods. At least NOK 50.00 is used at a time. 1 credit is worth 1 NOK.",
      "Customers are emailed a reminder before their credits expire.",
    ]);
  });

  it("is the storefront's own English text where shoppers read the same", () => {
    const en = t("en").bonus;
    for (const [earnBps, pendingDays, expiresMonths] of [
      [500, 14, null],
      [250, 0, 12],
      [275, 1, 1],
    ] as const) {
      const lines = rulesSummary({ ...on, earnBps, pendingDays, expiresMonths }, NOK, "NOK");
      const wait = pendingDays === 0 ? en.rightAfterPay : en.afterPay(en.dayCount(pendingDays));
      expect(lines[0]).toBe(en.howEarn(bpsToPercentText(earnBps), wait));
      expect(lines[1]).toBe(expiresMonths === null ? en.howUse : en.howUseExpires(en.monthCount(expiresMonths)));
    }
  });

  it("covers the plain cases", () => {
    const lines = rulesSummary({ ...on, earnBps: 0, pendingDays: 0 }, NOK, "NOK");
    expect(lines[0]).toContain("earn no bonus credits");
    expect(lines).toHaveLength(3);
    expect(waitWords(0)).toBe("right after you pay");
    expect(waitWords(1)).toBe("1 day after you pay");
    expect(rulesSummary({ ...on, expiresMonths: 1 }, NOK, "NOK")[1]).toContain("expire 1 month after");
  });

  it("lays out the overview's figures", () => {
    const rows = overviewRows(
      {
        currency: "NOK",
        outstandingMinor: 150000,
        pendingMinor: 20000,
        earned30dMinor: 50000,
        redeemed30dMinor: 30000,
        expired30dMinor: 0,
        customersWithCredits: 12,
      },
      NOK,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Outstanding credits",
      "Pending",
      "Earned, last 30 days",
      "Used, last 30 days",
      "Expired, last 30 days",
      "Customers with credits",
    ]);
    expect(rows[0].value).toBe("NOK 1,500.00");
    expect(rows[5].value).toBe("12");
  });
});

describe("a customer's credits", () => {
  it("shows signed amounts", () => {
    expect(flat(signedMoney(5000, "NOK", "en-GB"))).toBe("+NOK 50.00");
    expect(flat(signedMoney(-2000, "NOK", "en-GB"))).toBe("−NOK 20.00");
    expect(flat(signedMoney(0, "NOK", "en-GB"))).toBe("NOK 0.00");
  });

  it("knows a grant that can be used yet", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(isUsableNow({ kind: "earn", availableAt: "2026-10-15T00:00:00Z" }, now)).toBe(false);
    expect(isUsableNow({ kind: "earn", availableAt: "2026-09-15T00:00:00Z" }, now)).toBe(true);
    expect(isUsableNow({ kind: "redeem", availableAt: null }, now)).toBeNull();
    expect(isUsableNow({ kind: "earn", availableAt: null }, now)).toBeNull();
  });
});

describe("an adjustment", () => {
  it("adds with a plain or plus-signed amount and takes away with a minus", () => {
    expect(readAdjustment("50", "Goodwill after a late parcel", "NOK")).toEqual({
      ok: true,
      amountMinor: 5000,
      note: "Goodwill after a late parcel",
    });
    expect(readAdjustment("+49,50", "  Correction ", "NOK")).toEqual({
      ok: true,
      amountMinor: 4950,
      note: "Correction",
    });
    expect(readAdjustment("-20", "Wrong order", "NOK")).toMatchObject({ ok: true, amountMinor: -2000 });
    expect(readAdjustment("−20,5", "Wrong order", "NOK")).toMatchObject({ ok: true, amountMinor: -2050 });
  });

  it("refuses an empty, unreadable or zero amount, and a missing or long reason", () => {
    expect(readAdjustment("", "Because", "NOK")).toMatchObject({ ok: false, field: "amount" });
    expect(readAdjustment("lots", "Because", "NOK")).toMatchObject({ ok: false, field: "amount" });
    expect(readAdjustment("-", "Because", "NOK")).toMatchObject({ ok: false, field: "amount" });
    expect(readAdjustment("0", "Because", "NOK")).toMatchObject({
      ok: false,
      field: "amount",
      problem: "The amount cannot be 0.",
    });
    expect(readAdjustment("10", "ab", "NOK")).toMatchObject({ ok: false, field: "note" });
    expect(readAdjustment("10", "   ", "NOK")).toMatchObject({ ok: false, field: "note" });
    expect(readAdjustment("10", "x".repeat(201), "NOK")).toMatchObject({ ok: false, field: "note" });
    expect(readAdjustment("10", "x".repeat(200), "NOK")).toMatchObject({ ok: true });
  });

  it("asks the right question", () => {
    expect(adjustmentQuestion(5000, "Ann", NOK)).toBe("Add NOK 50.00 in credits to Ann?");
    expect(adjustmentQuestion(-2000, "Ann", NOK)).toBe("Take NOK 20.00 in credits from Ann?");
    expect(adjustmentPhrase("50", "ann@example.com")).toBe("Add 50 in bonus credits to ann@example.com");
    expect(adjustmentPhrase("-20", "ann@example.com")).toBe("Take 20 in bonus credits from ann@example.com");
  });
});

describe("what a refund does to an order's credits", () => {
  it("says nothing for an order with none", () => {
    expect(refundNotes(null, NOK)).toEqual([]);
    expect(refundNotes({ usedMinor: 0, earnedMinor: 0, availableAt: null }, NOK)).toEqual([]);
  });

  it("describes used credits coming back by the refunded share, and earned ones taken back", () => {
    const notes = refundNotes({ usedMinor: 10000, earnedMinor: 2500, availableAt: null }, NOK, {
      refundedMinor: 5000,
      totalMinor: 20000,
    });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("NOK 100.00 in credits was used");
    expect(notes[0]).toContain("NOK 25.00 so far");
    expect(notes[1]).toContain("takes back the credits the refunded part earned");
    expect(notes[1]).toContain("already used stay used");
  });
});
