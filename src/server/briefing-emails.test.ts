import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

import { askAboutAlert } from "@/lib/alert-ask";
import { analyticsEn } from "@/lib/admin-messages/analytics.en";
import type { Alert } from "@/lib/analytics-alerts";

import { aboveFloor, analyticsAlertsEmail, briefingTargetLines, summaryEmail } from "./staff-alerts";

/** The briefing and the analytics alert emails (wave 8 unit D, D348): built from the facts given, each item with its page, nothing per customer. */

const store = {
  id: "s",
  slug: "shop",
  name: "Shop",
  details: { legalName: "Shop AS", organisationNumber: "123", postalAddress: "Gate 1", contactEmail: "a@b.no", country: "NO" },
  markets: [],
  localization: {},
} as never;
const figures = {
  from: "2026-10-19",
  to: "2026-10-25",
  orders: 12,
  netSalesMinor: 480_000,
  refundsMinor: 0,
  currency: "NOK",
  unconverted: 0,
  missingCurrencies: [],
  returnsRequested: 0,
  openReturns: 0,
  toSend: 2,
  lowStock: 1,
  supportWaiting: null,
  before: { orders: 9, netSalesMinor: 360_000 },
};
const alert: Alert = {
  id: "refund-rate",
  severity: "warning",
  text: "Refunds of Wool sweater are three times the usual.",
  href: "/analytics/products?sort=refunds",
  action: "See the product",
  evidence: [{ label: "Refund rate", value: "30 %", baseline: "10 %" }],
  size: 2,
};
const card = {
  target: { id: "t", metric: "orders" as const, period: "quarter" as const, startsOn: "2026-10-01", endsOn: "2026-12-31", targetValue: 300 },
  progress: {
    metric: "orders" as const,
    status: "on_track" as const,
    targetValue: 300,
    actual: 120,
    expected: 118,
    projected: 305,
    pct: 0.4,
    shareElapsed: 0.39,
    weekdayWeighted: false,
    daysInPeriod: 92,
    daysLeft: 56,
    tooEarly: false,
    missing: null,
    ended: false,
  },
  unconverted: 0,
  missingCurrencies: [],
};

describe("the briefing (D348)", () => {
  it("sets the figures beside the period before and lists the alerts, the checkup and the targets, each with its page", () => {
    const targets = briefingTargetLines([card], "NOK", "en");
    expect(targets).toEqual([{ label: "Orders, Q4 2026", value: "120 of 300" }]);
    const email = summaryEmail(store, "weekly", figures, "en", {
      alerts: [alert],
      checkup: [{ key: "late_orders", count: 2, what: "2 paid order(s) have waited.", page: "/orders?show=to-send" }],
      targets,
      note: "Refunds of one product stand out.",
    });
    expect(email.subject).toBe("Shop: your weekly briefing for 2026-10-19 to 2026-10-25");
    expect(email.text).toContain("Paid orders: 12 (before: 9)");
    // A change in the figures is handed to the AI manager (D416): the home page opens it with the alert's words.
    expect(email.text).toContain("Refunds of Wool sweater are three times the usual.: Ask the AI manager (http");
    expect(email.text).toContain("/admin/shop?ask=refund-rate");
    expect(email.text).toContain("2 paid orders have waited more than two days to be sent.: Open");
    expect(email.text).toContain("/admin/shop/orders?show=to-send");
    expect(email.text).toContain("Orders, Q4 2026: 120 of 300");
    expect(email.text).toContain("Refunds of one product stand out.");
    // The checkup's English words for the model are never in the email.
    expect(email.text).not.toContain("paid order(s)");
  });

  it("gives each finding its one-press action, and the period's profit beside the sales (D415, D416)", () => {
    const stockout: Alert = { ...alert, id: "stockout", text: "Wool sweater runs out in 5 days.", href: "/analytics/inventory" };
    const coming: Alert = { ...alert, id: "returning-high", severity: "good", text: "Returning customers spent the most in 12 months.", href: "/analytics/customers" };
    const email = summaryEmail(store, "weekly", { ...figures, profitMinor: 123_400, profitEstimated: true }, "en", {
      alerts: [stockout, coming],
      checkup: [{ key: "restock", count: 3, what: "", page: "/inventory" }],
      targets: [],
      note: null,
    });
    expect(email.text).toContain("Wool sweater runs out in 5 days.: Prepare reorder (http");
    expect(email.text).toContain("/admin/shop/inventory/purchase-orders?reorder=1");
    expect(email.text).toContain("Returning customers spent the most in 12 months.: Create campaign (http");
    expect(email.text).toContain("/admin/shop/broadcasts/new?from=thanks");
    expect(email.text).toMatch(/: Prepare reorder \(http[^)]*\/inventory\/purchase-orders\?reorder=1\)/);
    expect(email.text).toMatch(/Profit before fixed costs, excl\. VAT: .*1[\s\u00a0.,]?234.*\(estimated\)/);
    // No profit line while too few sales have a cost price.
    expect(summaryEmail(store, "weekly", { ...figures, profitMinor: null }, "en", { alerts: [], checkup: [], targets: [], note: null }).text).not.toContain("Profit before fixed costs");
    // Norwegian words for the actions.
    const nb = summaryEmail(store, "weekly", figures, "nb", { alerts: [stockout], checkup: [], targets: [], note: null });
    expect(nb.text).toContain("Forbered innkjøp");
  });

  it("stays the summary it was when given no briefing", () => {
    const email = summaryEmail(store, "daily", { ...figures, before: null }, "en");
    expect(email.subject).toBe("Shop: daily summary for 2026-10-25");
    expect(email.text).not.toContain("What the analytics found");
  });

  it("is worded in Norwegian for a Norwegian recipient", () => {
    const email = summaryEmail(store, "weekly", figures, "nb", { alerts: [], checkup: [{ key: "drafts", count: 3, what: "", page: "/products" }], targets: briefingTargetLines([card], "NOK", "nb"), note: null });
    expect(email.subject).toContain("statusrapport");
    expect(email.text).toContain("3 produkter er utkast");
    expect(email.text).toContain("4. kvartal 2026");
  });
});

describe("analytics alerts by email (D348)", () => {
  it("emails what is at or above the floor and never good news", () => {
    expect(aboveFloor({ severity: "urgent" }, "urgent")).toBe(true);
    expect(aboveFloor({ severity: "warning" }, "urgent")).toBe(false);
    expect(aboveFloor({ severity: "warning" }, "warning")).toBe(true);
    expect(aboveFloor({ severity: "info" }, "warning")).toBe(false);
    expect(aboveFloor({ severity: "info" }, "info")).toBe(true);
    expect(aboveFloor({ severity: "good" }, "info")).toBe(false);
  });

  it("carries each alert's words, figures and page", () => {
    const email = analyticsAlertsEmail(store, "2026-10-28", [alert], "en");
    expect(email.subject).toBe("Shop: what the analytics found today");
    expect(email.text).toContain("Needs a look: Refunds of Wool sweater are three times the usual.");
    expect(email.text).toContain("Refund rate: 30 % (against 10 %)");
    expect(email.text).toContain("See the product: http");
    expect(email.text).toContain("/admin/shop/analytics/products?sort=refunds");
  });
});

describe("handing an alert to the AI manager (D348)", () => {
  it("writes the first message from the alert's own words and figures", () => {
    const message = askAboutAlert(alert, analyticsEn.alerts);
    expect(message).toBe(
      "Analytics found this today: “Refunds of Wool sweater are three times the usual.” The figures: Refund rate: 30 %, against 10 %. What would you suggest I do about it? Propose a next step, and keep any change for my yes.",
    );
    expect(askAboutAlert({ text: "Sales are up.", evidence: [] }, analyticsEn.alerts)).toBe(
      "Analytics found this today: “Sales are up.” What would you suggest I do about it? Propose a next step, and keep any change for my yes.",
    );
  });
});
