import { describe, expect, it } from "vitest";

import {
  adChangeEffect,
  adChangeProblem,
  adChangeWords,
  budgetsOf,
  daysLeftInMonth,
  metaAccountNumber,
  projectedMonthMinor,
  spendMinor,
  type AdBudget,
  type AdChangeFacts,
} from "./ad-budgets";

/** Ad budgets inside the owner's own ad account (D585): reading Meta's answers, the month's projection and the autopilot's rule. */

const budget = (over: Partial<AdBudget> & { id: string }): AdBudget => ({
  kind: "campaign",
  name: `Campaign ${over.id}`,
  campaign: null,
  on: true,
  dailyMinor: 10_000,
  lifetime: false,
  spentMinor: 0,
  ...over,
});

describe("reading Meta", () => {
  it("takes an account number with or without act_", () => {
    expect(metaAccountNumber("act_123456789")).toBe("123456789");
    expect(metaAccountNumber(" 123456789 ")).toBe("123456789");
    expect(metaAccountNumber("123")).toBeNull();
    expect(metaAccountNumber("act_12x456")).toBeNull();
  });

  it("reads spend in major units as minor units, rounded half up", () => {
    expect(spendMinor("123.45", "EUR")).toBe(12_345);
    expect(spendMinor("123.4", "NOK")).toBe(12_340);
    expect(spendMinor("7", "SEK")).toBe(700);
    expect(spendMinor("0.005", "EUR")).toBe(1);
    expect(spendMinor("0.004", "EUR")).toBe(0);
    expect(spendMinor(undefined, "EUR")).toBe(0);
    expect(spendMinor("1e5", "EUR")).toBeNull();
    expect(spendMinor("-3", "EUR")).toBeNull();
  });

  it("lists campaign budgets, and ad set budgets only where the campaign has none", () => {
    const budgets = budgetsOf(
      [
        { id: "100001", name: "Autumn", status: "ACTIVE", daily_budget: "5000" },
        { id: "100002", name: "Brand", status: "PAUSED" },
        { id: "100003", name: "Launch", status: "ACTIVE", lifetime_budget: "90000" },
      ],
      [
        { id: "200001", name: "Autumn set", status: "ACTIVE", campaign_id: "100001", daily_budget: "999" },
        { id: "200002", name: "Brand Norway", status: "ACTIVE", campaign_id: "100002", daily_budget: "2500" },
        { id: "200003", name: "Orphan", status: "ACTIVE", campaign_id: "999999", daily_budget: "2500" },
      ],
      [{ campaign_id: "100001", spend: "120.50" }, { campaign_id: "100002", spend: "3" }],
      "NOK",
    );
    expect(budgets).toEqual([
      { id: "100001", kind: "campaign", name: "Autumn", campaign: null, on: true, dailyMinor: 5000, lifetime: false, spentMinor: 12_050 },
      { id: "100003", kind: "campaign", name: "Launch", campaign: null, on: true, dailyMinor: null, lifetime: true, spentMinor: 0 },
      // Its campaign is paused, so it spends nothing, whatever its own switch says.
      { id: "200002", kind: "ad_set", name: "Brand Norway", campaign: "Brand", on: false, dailyMinor: 2500, lifetime: false, spentMinor: 300 },
    ]);
  });

  it("counts the days left in the account's own time zone, today included", () => {
    expect(daysLeftInMonth(new Date("2026-11-13T12:00:00Z"), "Europe/Oslo")).toBe(18);
    expect(daysLeftInMonth(new Date("2026-11-30T23:30:00Z"), "Europe/Oslo")).toBe(31);
    expect(daysLeftInMonth(new Date("2026-11-30T23:30:00Z"), "America/Los_Angeles")).toBe(1);
    expect(daysLeftInMonth(new Date("2028-02-01T12:00:00Z"), "UTC")).toBe(29);
  });
});

describe("the month's projection", () => {
  it("adds every daily budget that is on for each day left", () => {
    expect(projectedMonthMinor(50_000, [budget({ id: "1" }), budget({ id: "2", on: false })], 10)).toBe(150_000);
  });

  it("cannot tell while a lifetime budget runs", () => {
    expect(projectedMonthMinor(0, [budget({ id: "1", dailyMinor: null, lifetime: true })], 10)).toBeNull();
    expect(projectedMonthMinor(0, [budget({ id: "1", dailyMinor: null, lifetime: true, on: false })], 10)).toBe(0);
  });
});

describe("the autopilot's rule for a budget change", () => {
  const facts = (over: Partial<AdChangeFacts> = {}): AdChangeFacts => ({
    budgets: [budget({ id: "1", dailyMinor: 10_000 }), budget({ id: "2", dailyMinor: 5_000, on: false })],
    spentMinor: 100_000,
    daysLeft: 10,
    currency: "EUR",
    limitMinor: 300_000,
    ...over,
  });

  it("always lets a change that cannot spend more through", () => {
    expect(adChangeProblem(facts({ limitMinor: null }), { id: "1", dailyMinor: 5_000 }, 20)).toBeNull();
    expect(adChangeProblem(facts({ limitMinor: null }), { id: "1", on: false }, 20)).toBeNull();
    expect(adChangeEffect(facts(), { id: "1", dailyMinor: 5_000 })?.raises).toBe(false);
  });

  it("asks for a raise without a monthly limit", () => {
    expect(adChangeProblem(facts({ limitMinor: null }), { id: "1", dailyMinor: 11_000 }, 20)).toMatch(/No monthly limit/);
  });

  it("asks for a raise larger than the owner's percentage", () => {
    expect(adChangeProblem(facts(), { id: "1", dailyMinor: 12_000 }, 20)).toBeNull();
    expect(adChangeProblem(facts(), { id: "1", dailyMinor: 12_100 }, 20)).toBe("It raises a daily budget by 21 %, more than your limit of 20 %.");
  });

  it("asks when the month would pass the limit", () => {
    // 100 000 spent + 10 days × (10 000 + 5 000) = 250 000: within 300 000.
    expect(adChangeProblem(facts(), { id: "2", on: true }, 20)).toBeNull();
    // 100 000 + 10 × (10 000 + 15 000) = 350 000.
    expect(adChangeProblem(facts(), { id: "2", on: true, dailyMinor: 15_000 }, 20)).toBe(
      "At these budgets the ads would spend about €3,500.00 this month, more than your limit of €3,000.00.",
    );
  });

  it("asks to switch on a budget while a lifetime budget runs, and for one it does not know", () => {
    const withLifetime = facts({ budgets: [...facts().budgets, budget({ id: "3", dailyMinor: null, lifetime: true })] });
    expect(adChangeProblem(withLifetime, { id: "2", on: true }, 20)).toMatch(/lifetime budget/);
    expect(adChangeProblem(facts(), { id: "9", on: false }, 20)).toBe("That budget is not in the ad account.");
  });

  it("words a change from its figures", () => {
    const before = budget({ id: "1", name: "Autumn", dailyMinor: 10_000 });
    expect(adChangeWords(before, { ...before, dailyMinor: 12_000 }, "EUR")).toBe('Set the daily budget of the campaign "Autumn" from €100.00 to €120.00.');
    expect(adChangeWords(before, { ...before, on: false }, "EUR")).toBe('Pause the campaign "Autumn".');
    const set = budget({ id: "2", kind: "ad_set", name: "Norway", on: false, dailyMinor: 5_000 });
    expect(adChangeWords(set, { ...set, on: true, dailyMinor: 6_000 }, "NOK").replace(/\u00a0/g, " ")).toBe('Set the daily budget of the ad set "Norway" from NOK 50.00 to NOK 60.00 and switch it on.');
  });
});
