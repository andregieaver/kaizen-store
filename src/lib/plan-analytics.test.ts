import { describe, expect, it } from "vitest";

import { monthlyMinor, movements, planSummary, share, type BillingLine } from "./plan-analytics";

/** Analytics of Kaizena Flow's plans (D470): a month's worth of each price, the summary of running plans, the moves and the funnel's shares. */

const line = (extra: Partial<BillingLine>): BillingLine => ({ status: "active", planName: "Growth", currency: "NOK", interval: "month", amountMinor: 49900, cancelling: false, ...extra });

describe("plan analytics (D470)", () => {
  it("counts a yearly price as a twelfth of it every month", () => {
    expect(monthlyMinor(49900, "month")).toBe(49900);
    expect(monthlyMinor(479000, "year")).toBe(39917);
  });

  it("adds what running plans bring in a month per currency, a trial nothing yet and a late one still", () => {
    const s = planSummary([
      line({}),
      line({ status: "past_due" }),
      line({ status: "trialing" }),
      line({ status: "active", currency: "EUR", amountMinor: 4900, planName: "Start", cancelling: true }),
      line({ status: "canceled" }),
      line({ status: null, planName: null, currency: null, interval: null, amountMinor: null }),
    ]);
    expect(s.mrr).toEqual([
      { currency: "NOK", mrrMinor: 99800, stores: 2 },
      { currency: "EUR", mrrMinor: 4900, stores: 1 },
    ]);
    expect(s).toMatchObject({ paying: 3, trialing: 1, late: 1, cancelling: 1 });
    expect(s.byPlan.map((p) => [p.plan, p.stores])).toEqual([
      ["Growth", 3],
      ["Start", 1],
    ]);
  });

  it("counts the moves of a period by kind, with what each added or took per currency", () => {
    const m = movements([
      { kind: "started", currency: "NOK", deltaMinor: 49900 },
      { kind: "started", currency: "NOK", deltaMinor: 19900 },
      { kind: "cancelled", currency: "EUR", deltaMinor: -4900 },
    ]);
    expect(m.find((x) => x.kind === "started")).toEqual({ kind: "started", count: 2, byCurrency: [{ currency: "NOK", deltaMinor: 69800 }] });
    expect(m.find((x) => x.kind === "cancelled")).toEqual({ kind: "cancelled", count: 1, byCurrency: [{ currency: "EUR", deltaMinor: -4900 }] });
    expect(m.find((x) => x.kind === "upgraded")?.count).toBe(0);
  });

  it("gives a step's share of the applications, and none when nobody asked", () => {
    expect(share(3, 12)).toBe(25);
    expect(share(0, 0)).toBeNull();
  });
});
