import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { TermsOwedView } = await import("./terms-owed-view");

const render = (owed: Parameters<typeof TermsOwedView>[0]["owed"]) =>
  renderToString(createElement(TermsOwedView, { base: "/admin/shop", currency: "NOK", locale: "en-GB", owed }));

describe("invoices on payment terms on the Finance page (D293)", () => {
  it("draws nothing when nothing is owed", () => {
    expect(render({ dueMinor: 0, overdueMinor: 0, dueOrders: 0, overdueOrders: 0, unconverted: 0, missingCurrencies: [] })).toBe("");
  });

  it("says what is due and overdue in the main currency, each linking to its orders, and what was left out", () => {
    const html = render({ dueMinor: 125000, overdueMinor: 50000, dueOrders: 3, overdueOrders: 1, unconverted: 2, missingCurrencies: ["SEK"] });
    expect(html).toContain("Invoices on payment terms");
    expect(html).toContain("Due");
    expect(html).toContain("Overdue");
    expect(html).toContain("/admin/shop/orders?pay=terms_due");
    expect(html).toContain("/admin/shop/orders?pay=terms_overdue");
    expect(html).toContain("3 orders");
    expect(html).toContain("1 order");
    expect(html).toContain("2 orders in SEK are left out");
    expect(html).toMatch(/1,250\.00/);
  });
});
