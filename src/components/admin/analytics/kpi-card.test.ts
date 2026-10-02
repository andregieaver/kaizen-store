import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KpiCard } from "./kpi-card";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ");

describe("KpiCard", () => {
  it("shows the label and the value without a script, with no link unless given one", () => {
    const out = html(h(KpiCard, { label: "Net revenue", value: "12 400 kr" }));
    expect(out).toContain("Net revenue");
    expect(out).toContain("12 400 kr");
    expect(out).not.toContain("<a ");
    expect(out).toContain('data-state="ok"');
  });

  it("makes the whole card the link where it is explained", () => {
    const out = html(h(KpiCard, { label: "Orders", value: "31", href: "/admin/shop/analytics/finance" }));
    expect(out).toMatch(/^<a [^>]*href="\/admin\/shop\/analytics\/finance"/);
    expect(out).toContain("rounded-lg border border-border bg-background");
  });

  it("words each change with its sign, an arrow and what it is against, never colour alone", () => {
    const out = html(
      h(KpiCard, {
        label: "Net revenue",
        value: "12 400 kr",
        deltaPrevious: { text: "+12.4 %", abs: 1370 },
        deltaLastYear: { text: "-3.2 %", abs: -410 },
        good: "up",
      }),
    );
    expect(out).toContain("+12.4 %");
    expect(out).toContain("vs previous period");
    expect(out).toContain("-3.2 %");
    expect(out).toContain("vs same period last year");
    expect(out).toContain("▲");
    expect(out).toContain("▼");
    expect(out).toContain("Up, better: ");
    expect(out).toContain("Down, worse: ");
    expect(out).toContain("text-(--chart-good)");
    expect(out).toContain("text-(--chart-bad)");
  });

  it("follows the good direction: a fall in refunds is good news", () => {
    const out = html(h(KpiCard, { label: "Refund rate", value: "1.2 %", deltaPrevious: { text: "-0.4 pts", abs: -0.4 }, good: "down" }));
    expect(out).toContain("Down, better: ");
    expect(out).toContain("text-(--chart-good)");
    expect(out).toContain("▼");
  });

  it("is neutral when there is no preferred direction or the figure did not move", () => {
    const none = html(h(KpiCard, { label: "Sessions", value: "900", deltaPrevious: { text: "+5.0 %", abs: 45 } }));
    expect(none).toContain("text-muted");
    expect(none).not.toContain("text-(--chart-good)");
    expect(none).not.toContain("text-(--chart-bad)");
    expect(none).toContain("Up: ");
    const flat = html(h(KpiCard, { label: "Orders", value: "30", deltaPrevious: { text: "0.0 %", abs: 0 }, good: "up" }));
    expect(flat).toContain("▬");
    expect(flat).toContain("No change: ");
  });

  it("trusts a verdict that comes with the change", () => {
    const out = html(h(KpiCard, { label: "CAC", value: "300 kr", deltaPrevious: { text: "+30.0 %", abs: 70, verdict: "bad" }, good: "up" }));
    expect(out).toContain("Up, worse: ");
    expect(out).toContain("text-(--chart-bad)");
  });

  it("shows a dash with the words when there is nothing to compare with, and leaves the line out when comparison is off", () => {
    const none = html(h(KpiCard, { label: "Orders", value: "30", deltaPrevious: null }));
    expect(none).toContain("–");
    expect(none).toContain("vs previous period");
    expect(none).not.toContain("▲");
    const off = html(h(KpiCard, { label: "Orders", value: "30" }));
    expect(off).not.toContain("vs previous period");
    expect(off).not.toContain("vs same period last year");
  });

  it("writes 'new' for a figure that had nothing before", () => {
    const out = html(h(KpiCard, { label: "Orders", value: "5", deltaPrevious: { text: "new", abs: 5 }, good: "up" }));
    expect(out).toContain("new");
    expect(out).toContain("▲");
  });

  it("draws a trend line only when it has figures, in the news' colour", () => {
    const up = html(h(KpiCard, { label: "Orders", value: "5", series: [1, 2, 3], deltaPrevious: { text: "+10.0 %", abs: 1 }, good: "up" }));
    expect(up).toContain("<svg");
    expect(up).toContain("var(--chart-good)");
    expect(up).toContain('aria-hidden="true"');
    expect(html(h(KpiCard, { label: "Orders", value: "5", series: [] }))).not.toContain("<svg");
    expect(html(h(KpiCard, { label: "Orders", value: "5", series: [null, null] }))).not.toContain("<svg");
  });

  it("shows a hint such as the cost coverage", () => {
    expect(html(h(KpiCard, { label: "Gross profit", value: "4 000 kr", hint: "based on 83 % of sales" }))).toContain("based on 83 % of sales");
  });

  it("says what is missing instead of showing zero, with the call to action", () => {
    const out = html(h(KpiCard, { label: "Gross profit", value: "0 kr", state: "missing", missing: { text: "Costs are not entered yet.", action: { label: "Enter costs", href: "/admin/shop/analytics/settings" } } }));
    expect(out).toContain('data-state="missing"');
    expect(out).toContain("Costs are not entered yet.");
    expect(out).toContain('href="/admin/shop/analytics/settings"');
    expect(out).toContain("Enter costs");
    expect(out).toContain("Not available");
    expect(out).not.toContain("0 kr");
  });

  it("does not nest a link in a link when missing, even with an href", () => {
    const out = html(h(KpiCard, { label: "X", value: null, state: "missing", href: "/a", missing: { text: "t", action: { label: "Fix", href: "/b" } } }));
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('href="/b"');
  });

  it("handles a missing state with no words, and a null or empty value", () => {
    expect(html(h(KpiCard, { label: "X", value: null, state: "missing" }))).toContain("Not available");
    expect(html(h(KpiCard, { label: "X", value: null }))).toContain("–");
    expect(html(h(KpiCard, { label: "X", value: "" }))).toContain("–");
  });

  it("lets a long value wrap inside the card, and never squeezes a figure to make room for the trend line", () => {
    const out = html(h(KpiCard, { label: "X", value: "123 456 789 012 kr", series: [1, 2, 3] }));
    expect(out).toContain("break-words");
    expect(out).toContain("max-w-full");
    expect(out).toContain("flex-wrap"); // the trend line goes under the figure when they do not fit side by side
    expect(out).not.toContain("min-w-0 break-words");
  });

  it("sizes a figure by the room its card has, and a sentence smaller than a figure", () => {
    expect(html(h(KpiCard, { label: "X", value: "1 234 kr" }))).toContain("@[13rem]:text-2xl");
    expect(html(h(KpiCard, { label: "X", value: "1 234 kr", emphasis: true }))).toContain("@[16rem]:text-3xl");
    const sentence = html(h(KpiCard, { label: "X", value: "60 % of products make 82 % of revenue", emphasis: true }));
    expect(sentence).toContain("text-xl");
    expect(sentence).not.toContain("text-3xl");
  });
});
