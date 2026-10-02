import { describe, expect, it } from "vitest";

import {
  ANALYTICS_DEFAULTS,
  MAX_AMOUNT_MINOR,
  analyticsSettingsText,
  firstOfMonth,
  formatPercentBps,
  isValidDay,
  parseAmountMinor,
  parseAnalyticsSettings,
  parsePercentBps,
  parseSpend,
  parseTarget,
  settingsEntered,
} from "./analytics-settings";

describe("parsePercentBps", () => {
  it("reads whole and hundredths of a percent as basis points", () => {
    expect(parsePercentBps("2,9")).toBe(290);
    expect(parsePercentBps("2.90")).toBe(290);
    expect(parsePercentBps("0,25")).toBe(25);
    expect(parsePercentBps("0.05")).toBe(5);
    expect(parsePercentBps("1")).toBe(100);
    expect(parsePercentBps("100")).toBe(10_000);
    expect(parsePercentBps("100,00")).toBe(10_000);
    expect(parsePercentBps(" 2,9 % ")).toBe(290);
  });

  it("treats empty as 0 and refuses the rest", () => {
    expect(parsePercentBps("")).toBe(0);
    expect(parsePercentBps("   ")).toBe(0);
    for (const bad of ["abc", "-1", "100,01", "101", "2,999", "1,2,3", "1e2", ",", "1 000"]) {
      expect(parsePercentBps(bad), bad).toBeNull();
    }
  });
});

describe("formatPercentBps", () => {
  it("is the field's text, and empty for none", () => {
    expect(formatPercentBps(290)).toBe("2,9");
    expect(formatPercentBps(25)).toBe("0,25");
    expect(formatPercentBps(5)).toBe("0,05");
    expect(formatPercentBps(100)).toBe("1");
    expect(formatPercentBps(10_000)).toBe("100");
    expect(formatPercentBps(0)).toBe("");
    expect(formatPercentBps(-5)).toBe("");
    expect(formatPercentBps(Number.NaN)).toBe("");
  });

  it("round-trips through the parser for every basis point", () => {
    for (let bps = 1; bps <= 10_000; bps += 1) expect(parsePercentBps(formatPercentBps(bps)), String(bps)).toBe(bps);
  });
});

describe("parseAmountMinor", () => {
  it("is 0 for empty, minor units for an amount, null for the rest", () => {
    expect(parseAmountMinor("", "NOK")).toBe(0);
    expect(parseAmountMinor("  ", "NOK")).toBe(0);
    expect(parseAmountMinor("12,50", "NOK")).toBe(1250);
    expect(parseAmountMinor("1 249.5", "EUR")).toBe(124_950);
    expect(parseAmountMinor("abc", "NOK")).toBeNull();
    expect(parseAmountMinor("-5", "NOK")).toBeNull();
  });

  it("refuses an amount above the limit", () => {
    expect(parseAmountMinor(String(MAX_AMOUNT_MINOR / 100), "NOK")).toBe(MAX_AMOUNT_MINOR);
    expect(parseAmountMinor(String(MAX_AMOUNT_MINOR / 100 + 1), "NOK")).toBeNull();
  });
});

describe("parseAnalyticsSettings", () => {
  const typed = { paymentFeePercent: "2,9", paymentFeeFixed: "1,80", shippingCost: "49", fixedCostsMonthly: "12 000", ltvLifespanYears: 3 };

  it("turns what was typed into what is kept", () => {
    expect(parseAnalyticsSettings(typed, "NOK")).toEqual({
      ok: true,
      value: { paymentFeeBps: 290, paymentFeeFixedMinor: 180, shippingCostMinor: 4900, fixedCostsMonthlyMinor: 1_200_000, ltvLifespanYears: 3 },
    });
  });

  it("takes empty fields as zero (nothing entered) and needs only the lifespan", () => {
    expect(parseAnalyticsSettings({ ltvLifespanYears: 5 }, "NOK")).toEqual({
      ok: true,
      value: { ...ANALYTICS_DEFAULTS, ltvLifespanYears: 5 },
    });
  });

  it("explains every wrong field at once, in the store's currency", () => {
    const result = parseAnalyticsSettings({ ...typed, paymentFeePercent: "abc", shippingCost: "x", fixedCostsMonthly: "-1" }, "SEK");
    expect(result).toEqual({
      ok: false,
      problems: [
        '"abc" is not a percentage between 0 and 100 with at most two decimals.',
        'Shipping cost per order: "x" is not an amount in SEK.',
        'Fixed costs per month: "-1" is not an amount in SEK.',
      ],
    });
  });

  it("keeps the lifespan between 1 and 10 whole years", () => {
    for (const years of [0, 11, 2.5, -1]) {
      expect(parseAnalyticsSettings({ ...typed, ltvLifespanYears: years }, "NOK").ok, String(years)).toBe(false);
    }
    expect(parseAnalyticsSettings({ ...typed, ltvLifespanYears: 1 }, "NOK").ok).toBe(true);
    expect(parseAnalyticsSettings({ ...typed, ltvLifespanYears: 10 }, "NOK").ok).toBe(true);
    expect(parseAnalyticsSettings({ ...typed, ltvLifespanYears: "3" }, "NOK").ok).toBe(false);
    expect(parseAnalyticsSettings(null, "NOK").ok).toBe(false);
  });

  it("refuses text longer than a field takes", () => {
    expect(parseAnalyticsSettings({ ...typed, shippingCost: "1".repeat(21) }, "NOK").ok).toBe(false);
  });
});

describe("analyticsSettingsText and settingsEntered", () => {
  it("shows zero as an empty field, and reads back what it wrote", () => {
    expect(analyticsSettingsText({ ...ANALYTICS_DEFAULTS }, "NOK")).toEqual({
      paymentFeePercent: "",
      paymentFeeFixed: "",
      shippingCost: "",
      fixedCostsMonthly: "",
      ltvLifespanYears: 3,
    });
    const kept = { paymentFeeBps: 290, paymentFeeFixedMinor: 180, shippingCostMinor: 4900, fixedCostsMonthlyMinor: 1_200_000, ltvLifespanYears: 4 };
    const text = analyticsSettingsText(kept, "NOK");
    expect(text).toMatchObject({ paymentFeePercent: "2,9", paymentFeeFixed: "1,80", shippingCost: "49,00", fixedCostsMonthly: "12000,00" });
    expect(parseAnalyticsSettings(text, "NOK")).toEqual({ ok: true, value: kept });
  });

  it("counts a store as having entered costs only when one assumption is above zero", () => {
    expect(settingsEntered({ ...ANALYTICS_DEFAULTS })).toBe(false);
    expect(settingsEntered({ ...ANALYTICS_DEFAULTS, ltvLifespanYears: 9 })).toBe(false);
    for (const key of ["paymentFeeBps", "paymentFeeFixedMinor", "shippingCostMinor", "fixedCostsMonthlyMinor"] as const) {
      expect(settingsEntered({ ...ANALYTICS_DEFAULTS, [key]: 1 }), key).toBe(true);
    }
  });
});

describe("isValidDay", () => {
  it("accepts real days and refuses the rest", () => {
    expect(isValidDay("2026-10-02")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32", "26-10-02", "2026-1-2", "", "2026-10-02T00:00", "1999-12-31", "2101-01-01"]) {
      expect(isValidDay(bad), bad).toBe(false);
    }
  });
});

describe("firstOfMonth", () => {
  it("gives a month's first day from a month or any day in it", () => {
    expect(firstOfMonth("2026-10")).toBe("2026-10-01");
    expect(firstOfMonth("2026-10-15")).toBe("2026-10-01");
    expect(firstOfMonth(" 2026-02-28 ")).toBe("2026-02-01");
    expect(firstOfMonth("2026-12-31")).toBe("2026-12-01");
  });

  it("refuses what is not a month", () => {
    for (const bad of ["", "2026", "2026-13", "2026-00", "2026-02-30", "October", "2026/10", "2026-10-1"]) {
      expect(firstOfMonth(bad), bad).toBeNull();
    }
  });
});

describe("parseTarget", () => {
  it("is a month's first day with an amount above zero", () => {
    expect(parseTarget({ month: "2026-10", revenueTarget: "500 000" }, "NOK")).toEqual({
      ok: true,
      value: { month: "2026-10-01", revenueTargetMinor: 50_000_000 },
    });
  });

  it("explains what is wrong", () => {
    expect(parseTarget({ month: "soon", revenueTarget: "5" }, "NOK")).toEqual({ ok: false, problems: ["Choose a month."] });
    expect(parseTarget({ month: "2026-10", revenueTarget: "" }, "NOK")).toEqual({ ok: false, problems: ["The target must be more than 0."] });
    expect(parseTarget({ month: "2026-10", revenueTarget: "0" }, "NOK")).toEqual({ ok: false, problems: ["The target must be more than 0."] });
    expect(parseTarget({ month: "2026-10", revenueTarget: "lots" }, "NOK")).toEqual({
      ok: false,
      problems: ['"lots" is not an amount in NOK.'],
    });
    expect(parseTarget(undefined, "NOK").ok).toBe(false);
  });
});

describe("parseSpend", () => {
  const typed = { day: "2026-10-01", channel: "paid_search", campaign: " brand ", amount: "1 500,50", note: " test " };

  it("trims, converts and keeps an empty note as none", () => {
    expect(parseSpend(typed, "NOK")).toEqual({
      ok: true,
      value: { day: "2026-10-01", channel: "paid_search", campaign: "brand", amountMinor: 150_050, note: "test" },
    });
    const bare = parseSpend({ day: "2026-10-01", channel: "email", amount: "10" }, "NOK");
    expect(bare).toEqual({ ok: true, value: { day: "2026-10-01", channel: "email", campaign: "", amountMinor: 1000, note: null } });
  });

  it("refuses a day that does not exist, a channel that is not one and an amount that is not above zero", () => {
    expect(parseSpend({ ...typed, day: "2026-02-30" }, "NOK")).toEqual({ ok: false, problems: ["Choose a day."] });
    expect(parseSpend({ ...typed, channel: "carrier_pigeon" }, "NOK")).toEqual({ ok: false, problems: ["Choose a channel."] });
    expect(parseSpend({ ...typed, amount: "0" }, "NOK")).toEqual({ ok: false, problems: ["The amount must be more than 0."] });
    expect(parseSpend({ ...typed, amount: "" }, "NOK")).toEqual({ ok: false, problems: ["The amount must be more than 0."] });
    expect(parseSpend({ ...typed, amount: "-5" }, "NOK")).toEqual({ ok: false, problems: ['"-5" is not an amount in NOK.'] });
  });

  it("keeps the campaign and the note within their limits", () => {
    expect(parseSpend({ ...typed, campaign: "x".repeat(100) }, "NOK").ok).toBe(true);
    expect(parseSpend({ ...typed, campaign: "x".repeat(101) }, "NOK")).toEqual({ ok: false, problems: ["Keep the campaign name to 100 characters."] });
    expect(parseSpend({ ...typed, note: "x".repeat(501) }, "NOK")).toEqual({ ok: false, problems: ["Keep the note to 500 characters."] });
  });

  it("knows every channel key the database does", () => {
    for (const channel of ["direct", "organic_search", "paid_search", "organic_social", "paid_social", "email", "affiliate", "referral", "other"]) {
      expect(parseSpend({ ...typed, channel }, "NOK").ok, channel).toBe(true);
    }
  });
});
