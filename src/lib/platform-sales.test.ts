import { describe, expect, it } from "vitest";

import { saleOf, salesByMonth, type InvoiceLike } from "./platform-sales";

const plan: InvoiceLike = {
  id: "in_plan",
  number: "KF-0042",
  currency: "nok",
  total: 37_375,
  subtotal: 29_900,
  total_excluding_tax: 29_900,
  created: Date.parse("2026-11-01T10:00:00Z") / 1000,
  status_transitions: { paid_at: Date.parse("2026-11-01T10:05:00Z") / 1000 },
  parent: { type: "subscription_details" },
};

describe("what Kaizena Flow itself sold (D507)", () => {
  it("reads a plan's invoice: before VAT, the 25 % MVA, the total and when it was paid", () => {
    expect(saleOf(plan)).toEqual({
      stripeInvoiceId: "in_plan",
      number: "KF-0042",
      kind: "plan",
      currency: "NOK",
      netMinor: 29_900,
      vatMinor: 7_475,
      totalMinor: 37_375,
      paidAt: "2026-11-01T10:05:00.000Z",
    });
  });

  it("knows a premium theme and a domain by the purchase they name, a sale abroad by its VAT of nought, and skips one that charged nothing", () => {
    const theme = { ...plan, id: "in_theme", currency: "eur", total: 4_900, subtotal: 4_900, total_excluding_tax: 4_900, parent: null, metadata: { kaizen_theme_purchase: "p1" } };
    expect(saleOf(theme)).toMatchObject({ kind: "theme", currency: "EUR", netMinor: 4_900, vatMinor: 0 });
    expect(saleOf({ ...theme, id: "in_domain", metadata: { kaizen_domain_purchase: "d1" } })).toMatchObject({ kind: "domain" });
    expect(saleOf({ ...theme, id: "in_other", metadata: {} })).toMatchObject({ kind: "other" });
    // An older invoice without `total_excluding_tax`: its subtotal; one paid without a paid time: when it was made.
    expect(saleOf({ ...plan, total_excluding_tax: null, status_transitions: null })).toMatchObject({ netMinor: 29_900, paidAt: "2026-11-01T10:00:00.000Z" });
    expect(saleOf({ ...plan, total: 0 })).toBeNull();
  });

  it("sums a year by month and currency, each kind before VAT, never adding currencies together", () => {
    const summary = salesByMonth([
      { month: "2026-10", kind: "plan", currency: "NOK", netMinor: 29_900, vatMinor: 7_475, totalMinor: 37_375, creditedMinor: 0 },
      { month: "2026-11", kind: "plan", currency: "NOK", netMinor: 29_900, vatMinor: 7_475, totalMinor: 37_375, creditedMinor: 37_375 },
      { month: "2026-11", kind: "theme", currency: "NOK", netMinor: 49_000, vatMinor: 12_250, totalMinor: 61_250, creditedMinor: 0 },
      { month: "2026-11", kind: "plan", currency: "EUR", netMinor: 2_900, vatMinor: 0, totalMinor: 2_900, creditedMinor: 0 },
    ]);
    expect(summary.months.map((m) => [m.month, m.currency, m.byKind.plan, m.byKind.theme, m.vat, m.total, m.credited])).toEqual([
      ["2026-10", "NOK", 29_900, 0, 7_475, 37_375, 0],
      ["2026-11", "EUR", 2_900, 0, 0, 2_900, 0],
      ["2026-11", "NOK", 29_900, 49_000, 19_725, 98_625, 37_375],
    ]);
    expect(summary.totals.map((t) => [t.currency, t.byKind.plan, t.byKind.theme, t.vat, t.total, t.credited])).toEqual([
      ["EUR", 2_900, 0, 0, 2_900, 0],
      ["NOK", 59_800, 49_000, 27_200, 136_000, 37_375],
    ]);
  });
});
