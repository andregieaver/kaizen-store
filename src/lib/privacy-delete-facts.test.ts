import { describe, expect, it } from "vitest";

import type { ErasurePlan, PlanRow } from "./erasure-plan";
import { deleteFactsOf } from "./privacy-delete-facts";

const plan = (over: Partial<ErasurePlan["alsoHappens"]> = {}, rows: PlanRow[] = []): ErasurePlan => ({
  subject: { kind: "account", customerId: "c1", hasEmail: true },
  rows,
  alsoHappens: {
    subscriptionsCancelled: 0,
    savedCardsDetached: 0,
    bonusForfeited: [],
    restrictedTotals: [],
    openOrders: 0,
    ordersCancelled: 0,
    openReturns: 0,
    emailOptOutKept: false,
    ...over,
  },
  warnings: [],
});
const kept = (count: number, first: string, last: string): PlanRow => ({
  table: "orders",
  label: "Orders kept for the bookkeeping rules",
  count,
  action: "restricted",
  reason: "r",
  keptUntil: { first, last },
});

describe("what the delete page tells a shopper", () => {
  it("counts the kept orders and writes the LAST day they go, so it never says data goes sooner than it does", () => {
    const facts = deleteFactsOf(plan({}, [kept(3, "2031-01-01", "2033-01-01")]), "nb-NO", null);
    expect(facts.keptOrders).toBe(3);
    expect(facts.keptUntil).toBe("1. januar 2033");
    expect(deleteFactsOf(plan({}, [kept(1, "2031-01-01", "2031-01-01")]), "en-GB", null).keptUntil).toBe("1 January 2031");
  });

  it("says nothing is kept when no order is (anonymised-now orders are not 'kept')", () => {
    const anonymised: PlanRow = { table: "orders", label: "x", count: 4, action: "anonymised", reason: "r" };
    const facts = deleteFactsOf(plan({}, [anonymised]), "en-GB", null);
    expect(facts.keptOrders).toBe(0);
    expect(facts.keptUntil).toBeNull();
  });

  it("carries subscriptions, saved cards and the opt-out block from the plan", () => {
    const facts = deleteFactsOf(plan({ subscriptionsCancelled: 2, savedCardsDetached: 1, emailOptOutKept: true }), "sv-SE", null);
    expect(facts).toMatchObject({ subscriptions: 2, cards: 1, optOutKept: true, bonus: null });
  });

  it("shows credits as the shopper sees them in My account (the market's currency), the plan's own currency only as the fallback", () => {
    const forfeited = [{ currency: "NOK", amountMinor: 50000 }];
    // A euro view of a NOK store: the shown amount, never the stored NOK figure.
    expect(deleteFactsOf(plan({ bonusForfeited: forfeited }), "en-IE", { currency: "EUR", amountMinor: 4200 }).bonus).toBe("€42.00");
    expect(deleteFactsOf(plan({ bonusForfeited: forfeited }), "nb-NO", null).bonus).toMatch(/500,00/);
    // No credits in the plan: nothing is said, whatever the page read.
    expect(deleteFactsOf(plan(), "en-IE", { currency: "EUR", amountMinor: 4200 }).bonus).toBeNull();
  });
});
