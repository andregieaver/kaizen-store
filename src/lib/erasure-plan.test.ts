import { describe, expect, it } from "vitest";

import { PLAN_TABLES, buildPlan, countsLine, isEmptyPlan, labelOf, orderDueOn, summarisePlan, type PlanInput, type PlanOrder } from "./erasure-plan";
import { PERSONAL_DATA } from "./personal-data";

const order = (over: Partial<PlanOrder> = {}): PlanOrder => ({ id: "o1", class: "sale", anchorDay: "2026-03-01", host: false, currency: "NOK", totalMinor: 50000, ...over });

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  subject: { kind: "account", customerId: "c1", hasEmail: true },
  counts: {},
  orders: [],
  country: "NO",
  today: "2026-10-04",
  subscriptionsLive: 0,
  savedCards: 0,
  bonus: [],
  openOrders: 0,
  ordersCancelled: 0,
  openReturns: 0,
  warnings: [],
  ...over,
});

describe("when an order's personal data may go", () => {
  it("is 1 January of the anchor year + the seller's country's years + 1 for a sale", () => {
    expect(orderDueOn(order({ anchorDay: "2020-12-31" }), "NO", "2026-10-04")).toBe("2026-01-01");
    expect(orderDueOn(order({ anchorDay: "2020-01-01" }), "NO", "2026-10-04")).toBe("2026-01-01");
    expect(orderDueOn(order({ anchorDay: "2020-06-01" }), "SE", "2026-10-04")).toBe("2028-01-01");
    expect(orderDueOn(order({ anchorDay: "2020-06-01" }), "DK", "2026-10-04")).toBe("2026-01-01");
    expect(orderDueOn(order({ anchorDay: "2020-06-01" }), "DE", "2026-10-04")).toBe("2029-01-01");
    expect(orderDueOn(order({ anchorDay: "2020-06-01" }), "FI", "2026-10-04")).toBe("2031-01-01");
  });

  it("is the seller's country, not the buyer's, and a host's order has its own period", () => {
    expect(orderDueOn(order({ anchorDay: "2020-06-01", host: true }), "NO", "2026-10-04")).toBe("2031-01-01");
  });

  it("is at once for an order that is not a sale or is copied", () => {
    expect(orderDueOn(order({ class: "unpaid", anchorDay: "2026-09-01" }), "NO", "2026-10-04")).toBe("2026-09-01");
    expect(orderDueOn(order({ class: "copied", anchorDay: "2024-01-01" }), "NO", "2026-10-04")).toBe("2024-01-01");
  });
});

describe("the preview", () => {
  it("restricts a sale before its day, anonymises one on it, and anonymises unpaid and copied orders at once", () => {
    const orders = [
      order({ id: "a", anchorDay: "2025-05-01", totalMinor: 10000 }),
      order({ id: "b", anchorDay: "2026-02-01", totalMinor: 20000 }),
      order({ id: "c", anchorDay: "2020-12-31", totalMinor: 30000 }),
      order({ id: "d", class: "unpaid", anchorDay: "2026-09-30", totalMinor: 40000 }),
      order({ id: "e", class: "copied", anchorDay: "2024-01-01", totalMinor: 50000 }),
    ];
    const plan = buildPlan(input({ orders, counts: { customers: 1 } }));
    const kept = plan.rows.find((r) => r.action === "restricted" && r.table === "orders");
    const gone = plan.rows.find((r) => r.action === "anonymised" && r.table === "orders");
    expect(kept).toMatchObject({ count: 2, keptUntil: { first: "2031-01-01", last: "2032-01-01" } });
    expect(gone?.count).toBe(3);
    expect(plan.rows.find((r) => r.table === "customers")?.action).toBe("deleted");
  });

  it("shows restricted totals per currency and never adds across currencies (a euro view next to the country's own)", () => {
    const orders = [
      order({ id: "a", currency: "NOK", totalMinor: 10000 }),
      order({ id: "b", currency: "EUR", totalMinor: 999 }),
      order({ id: "c", currency: "NOK", totalMinor: 5000 }),
    ];
    const plan = buildPlan(input({ orders }));
    expect(plan.alsoHappens.restrictedTotals).toEqual([
      { currency: "NOK", amountMinor: 15000, count: 2 },
      { currency: "EUR", amountMinor: 999, count: 1 },
    ]);
  });

  it("lists what else happens: subscriptions cancelled, cards detached, credits lost per currency, the opt-out kept", () => {
    const plan = buildPlan(input({ counts: { email_opt_outs: 1, wishlists: 2 }, subscriptionsLive: 2, savedCards: 1, bonus: [{ currency: "NOK", amountMinor: 5000 }, { currency: "EUR", amountMinor: 0 }], openOrders: 1, openReturns: 2, warnings: ["staff_account", "company_main"] }));
    expect(plan.alsoHappens).toMatchObject({ subscriptionsCancelled: 2, savedCardsDetached: 1, bonusForfeited: [{ currency: "NOK", amountMinor: 5000 }], openOrders: 1, openReturns: 2, emailOptOutKept: true });
    expect(plan.warnings).toEqual(["staff_account", "company_main"]);
    expect(plan.rows.find((r) => r.table === "wishlists")?.action).toBe("deleted");
  });

  it("leaves a table out when the person has nothing in it, and calls a person with nothing empty", () => {
    expect(buildPlan(input()).rows).toEqual([]);
    expect(isEmptyPlan(buildPlan(input()))).toBe(true);
    expect(isEmptyPlan(buildPlan(input({ subscriptionsLive: 1 })))).toBe(false);
    expect(isEmptyPlan(buildPlan(input({ counts: { wishlists: 1 } })))).toBe(false);
  });

  it("restricts the documents and says until when, and keeps the order's children out of the table", () => {
    const plan = buildPlan(input({ orders: [order({ anchorDay: "2025-05-01" })], counts: { invoices: 1, credit_notes: 1, order_lines: 4, payments: 1, withdrawal_requests: 1, returns: 1 } }));
    expect(plan.rows.filter((r) => r.action === "restricted").map((r) => r.table).sort()).toEqual(["credit_notes", "invoices", "orders", "returns", "withdrawal_requests"]);
    expect(plan.rows.find((r) => r.table === "invoices")?.keptUntil).toEqual({ first: "2031-01-01", last: "2031-01-01" });
    expect(plan.rows.some((r) => r.table === "order_lines" || r.table === "payments")).toBe(false);
  });

  it("agrees with the register: every row's action is the register's for that table", () => {
    const counts = Object.fromEntries(PLAN_TABLES.map((t) => [t, 1]));
    const plan = buildPlan(input({ counts, orders: [order({ anchorDay: "2025-05-01" })] }));
    const word = { delete: "deleted", anonymise: "anonymised", restrict: "restricted", keep: "kept" } as const;
    for (const row of plan.rows.filter((r) => r.table !== "orders")) {
      const entry = PERSONAL_DATA.find((e) => e.table === row.table)!;
      expect([row.table, row.action]).toEqual([row.table, word[entry.erasure as keyof typeof word]]);
    }
  });

  it("writes down only counts and dates, never a value", () => {
    const plan = buildPlan(input({ orders: [order({ totalMinor: 123456 })], counts: { customers: 1, wishlists: 2 }, subscriptionsLive: 1, savedCards: 1, bonus: [{ currency: "NOK", amountMinor: 777 }] }));
    const summary = summarisePlan(plan);
    const text = JSON.stringify(summary);
    expect(text).not.toContain("123456");
    expect(text).not.toContain("777");
    expect(summary).toMatchObject({ subscriptionsCancelled: 1, savedCardsDetached: 1, keptUntil: { first: "2032-01-01", last: "2032-01-01" } });
    expect(summary.rows).toContainEqual({ table: "customers", action: "deleted", count: 1 });
  });

  it("names the tables for staff and builds the customer page's count line", () => {
    expect(labelOf("customers")).toBe("Account");
    expect(labelOf("unknown_table")).toBe("unknown_table");
    expect(countsLine({ orders: 3, emails: 2, forms: 0 }, [{ key: "orders", label: "orders" }, { key: "emails", label: "emails" }, { key: "forms", label: "forms" }])).toBe("3 orders, 2 emails");
  });
});
