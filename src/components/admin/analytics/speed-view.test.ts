import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { analyticsNb } from "@/lib/admin-messages/analytics.nb";
import { speedRow, type SpeedFigures } from "@/lib/speed";
import type { SpeedReport } from "@/server/analytics-speed";

import { SpeedView } from "./speed-view";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/[  ]/g, " ");
const loads = (n: number, f: Partial<SpeedFigures>): SpeedFigures[] => Array.from({ length: n }, () => ({ lcp: null, inp: null, cls: null, ttfb: null, ...f }));

const report = (over: Partial<SpeedReport> = {}): SpeedReport => ({
  collecting: true,
  from: "2026-09-30",
  to: "2026-10-27",
  lastSample: "2026-10-27",
  loads: 0,
  rows: [],
  ...over,
});

/** The speed report (D336): figures only where measured, the too-few count instead of a guess, what to fix, and the switch when off. */
describe("the speed report", () => {
  it("says it collects nothing while visit counting is off, with the way to switch it on", () => {
    const out = html(h(SpeedView, { base: "/admin/shop", locale: "en", report: report({ collecting: false, lastSample: null }) }));
    expect(out).toContain("only while the store counts visits");
    expect(out).toContain('href="/admin/shop/analytics/settings"');
    expect(out).toContain("No page loads were measured");
    expect(out).not.toContain("data-speed-fix");
  });

  it("shows a figure with its rating, the count where too few, and what to look at first", () => {
    const rows = [speedRow("home", "phone", loads(25, { lcp: 4200, inp: 120, cls: 30 })), speedRow("product", "computer", loads(5, { lcp: 1200 }))];
    const out = html(h(SpeedView, { base: "/admin/shop", locale: "en", report: report({ loads: 30, rows }) }));
    expect(out).toContain("Front page");
    expect(out).toContain("4.20 s · Poor");
    expect(out).toContain("120 ms · Good");
    expect(out).toContain("5 of 20 page loads");
    expect(out).toContain("30 page loads measured");
    expect(out).toContain('data-speed-fix="lcp"');
    expect(out).not.toContain('data-speed-fix="inp"');
    // Never a figure that was not measured: the product page's response time has no page load at all.
    expect(out).not.toContain("only while the store counts visits");
  });

  it("says every figure is good when none needs work", () => {
    const out = html(h(SpeedView, { base: "/admin/shop", locale: "en", report: report({ loads: 20, rows: [speedRow("home", "phone", loads(20, { lcp: 1000 }))] }) }));
    expect(out).toContain("Every figure with enough page loads is good.");
  });

  it("is drawn in Norwegian with the Norwegian words", () => {
    const out = html(h(SpeedView, { base: "/admin/shop", locale: "nb-NO", words: analyticsNb, report: report({ loads: 20, rows: [speedRow("home", "phone", loads(20, { cls: 120 }))] }) }));
    expect(out).toContain(analyticsNb.speed.kinds.home);
    expect(out).toContain("0,12");
  });
});
