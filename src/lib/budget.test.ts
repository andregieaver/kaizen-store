import { describe, expect, it } from "vitest";

import { budgetMonthsOf, budgetView, subscriptionMonths } from "./budget";
import type { RecurringCost } from "./recurring-costs";
import { parseMoneyText } from "./work-calc";

const claude: RecurringCost = {
  id: "c1",
  name: "Claude Max",
  matchText: "ANTHROPIC",
  kind: "software",
  vatRate: 0,
  abroad: true,
  every: "month",
  amountMinor: 220_000,
  startedOn: "2026-03-15",
  endedOn: null,
};

describe("budget against actual, and a forecast (D505)", () => {
  it("puts a subscription in the months it costs, without the VAT taken back", () => {
    // Abroad: all of it is cost, from the month it started.
    expect(subscriptionMonths(claude, 2026)).toEqual([0, 0, 220_000, 220_000, 220_000, 220_000, 220_000, 220_000, 220_000, 220_000, 220_000, 220_000]);
    // Bought at home with 25 % VAT: the cost is what is left when the VAT is taken back; ended in September.
    expect(subscriptionMonths({ ...claude, abroad: false, vatRate: 25, amountMinor: 12_500, startedOn: "2025-01-01", endedOn: "2026-09-10" }, 2026)).toEqual([
      10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 0, 0, 0,
    ]);
    // A year's plan falls in the month of its last charge, else of its start.
    const domain = { ...claude, every: "year" as const, amountMinor: 18_000, startedOn: "2024-03-02" };
    expect(subscriptionMonths(domain, 2026)).toEqual([0, 0, 18_000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(subscriptionMonths(domain, 2026, "2025-06-20")).toEqual([0, 0, 0, 0, 0, 18_000, 0, 0, 0, 0, 0, 0]);
  });

  it("forecasts each account from its budget, else its subscriptions, else its months so far", () => {
    const view = budgetView({
      month: 11,
      budgets: [
        { account: 3000, months: Array(12).fill(100_000) },
        { account: 6553, months: Array(12).fill(200_000) },
      ],
      actuals: [
        // Sales: 90 000 a month for ten months, 30 000 so far in November.
        ...Array.from({ length: 10 }, (_, i) => ({ account: 3000, month: i + 1, amount: 90_000 })),
        { account: 3000, month: 11, amount: 30_000 },
        // Software: 250 000 a month (over budget), nothing yet in November.
        ...Array.from({ length: 10 }, (_, i) => ({ account: 6553, month: i + 1, amount: 250_000 })),
        // Office supplies: no budget, no subscription, 12 000 a month on average.
        { account: 6800, month: 2, amount: 60_000 },
        { account: 6800, month: 7, amount: 60_000 },
        // A balance account is never a line.
        { account: 1920, month: 3, amount: 5_000 },
      ],
      subscriptions: [{ account: 7320, months: Array(12).fill(5_000) }],
    });
    expect(view.lines.map((l) => [l.account, l.income, l.budget, l.actual, l.forecast, l.source, l.off])).toEqual([
      // 900 000 + max(30 000, 100 000) + 100 000.
      [3000, true, 1_200_000, 930_000, 1_100_000, "budget", 100_000],
      // 2 500 000 + 200 000 + 200 000.
      [6553, false, 2_400_000, 2_500_000, 2_900_000, "budget", 500_000],
      [6800, false, null, 120_000, 144_000, "run_rate", null],
      [7320, false, null, 0, 10_000, "subscriptions", null],
    ]);
    expect(view.income).toEqual({ budget: 1_200_000, actual: 930_000, forecast: 1_100_000 });
    expect(view.costs).toEqual({ budget: 2_400_000, actual: 2_620_000, forecast: 3_054_000 });
    expect(view.result).toEqual({ budget: -1_200_000, actual: -1_690_000, forecast: -1_954_000 });
  });

  it("holds a year gone by to what it held, and forecasts one not begun from its budget alone", () => {
    const actuals = [{ account: 6553, month: 4, amount: 50_000 }];
    const budgets = [{ account: 6553, months: Array(12).fill(10_000) }];
    expect(budgetView({ month: 13, budgets, actuals, subscriptions: [] }).lines[0]).toMatchObject({ actual: 50_000, forecast: 50_000, off: -70_000 });
    expect(budgetView({ month: 0, budgets, actuals: [], subscriptions: [] }).lines[0]).toMatchObject({ actual: 0, forecast: 120_000, off: 0 });
  });

  it("reads twelve months from the form: one for every month, or each on its own", () => {
    expect(budgetMonthsOf({ each: "2 000", months: [] }, "NOK", parseMoneyText)).toEqual(Array(12).fill(200_000));
    expect(budgetMonthsOf({ each: "2 000", months: ["100", "", "300"] }, "NOK", parseMoneyText)).toEqual([10_000, 0, 30_000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(budgetMonthsOf({ each: "", months: [] }, "NOK", parseMoneyText)).toBeNull();
    expect(budgetMonthsOf({ each: "-5", months: [] }, "NOK", parseMoneyText)).toBeNull();
    expect(budgetMonthsOf({ each: "", months: ["abc"] }, "NOK", parseMoneyText)).toBeNull();
  });
});
