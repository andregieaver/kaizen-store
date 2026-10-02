import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Alert } from "@/lib/analytics-alerts";

import { alertHref, AlertList, AlertsSection } from "./alerts";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");

const BASE = "/admin/shop";
const alert = (over: Partial<Alert> = {}): Alert => ({ id: "stockout", severity: "urgent", text: "Linen shirt runs out in 3 days.", href: "/analytics/inventory", action: "See stock", evidence: [], size: 1, ...over });

describe("alertHref", () => {
  it("puts the alert's path after the store's admin base", () => {
    expect(alertHref(BASE, { href: "/analytics/traffic" })).toBe("/admin/shop/analytics/traffic");
    expect(alertHref(BASE, { href: "/analytics/products?sort=refunds" })).toBe("/admin/shop/analytics/products?sort=refunds");
    expect(alertHref(BASE, { href: "/products" })).toBe("/admin/shop/products");
    expect(alertHref(BASE, { href: "analytics" })).toBe("/admin/shop/analytics");
  });
});

describe("AlertsSection", () => {
  it("draws nothing for no alerts, so the slot costs no room", () => {
    expect(html(h(AlertsSection, { alerts: [], base: BASE }))).toBe("");
  });

  it("draws each alert with its severity in words, its text and a link into the store's admin", () => {
    const out = html(h(AlertsSection, { alerts: [alert(), alert({ id: "best-day", severity: "good", text: "Yesterday was your best day in 90 days.", href: "/analytics", action: "See the overview" })], base: BASE }));
    expect(out).toContain("Needs you today");
    expect(out).toContain("Urgent");
    expect(out).toContain("Good news");
    expect(out).toContain("Linen shirt runs out in 3 days.");
    expect(out).toContain('href="/admin/shop/analytics/inventory"');
    expect(out).toContain("See stock");
    expect(out).toContain('href="/admin/shop/analytics"');
    expect(out).toContain('data-alert="stockout"');
  });

  it("folds the evidence away under the alert, with what it is compared with", () => {
    const out = html(h(AlertList, { alerts: [alert({ evidence: [{ label: "Conversion rate, the last 7 days", value: "0.6 %", baseline: "3.9 % over the four weeks before" }, { label: "Orders", value: "4", baseline: null }] })], base: BASE }));
    expect(out).toContain("<details");
    expect(out).toContain("The figures behind it");
    expect(out).toContain("Conversion rate, the last 7 days");
    expect(out).toContain("0.6 %");
    expect(out).toContain("against 3.9 % over the four weeks before");
    // An alert with no evidence has nothing to fold.
    expect(html(h(AlertList, { alerts: [alert()], base: BASE }))).not.toContain("<details");
  });

  it("falls back to 'Open' when an alert has no words for its link", () => {
    expect(html(h(AlertList, { alerts: [alert({ action: "" })], base: BASE }))).toContain(">Open<");
  });
});
