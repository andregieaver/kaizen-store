import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalyticsSection, ChartCard, Note } from "./section";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("AnalyticsSection", () => {
  it("is a section labelled by its heading, which has the id", () => {
    const out = html(h(AnalyticsSection, { id: "revenue", title: "Revenue", description: "What came in.", action: h("a", { href: "/x" }, "Export") }, h("p", null, "body")));
    expect(out).toContain('<section aria-labelledby="revenue"');
    expect(out).toContain('<h2 id="revenue"');
    expect(out).toContain("Revenue");
    expect(out).toContain("What came in.");
    expect(out).toContain('href="/x"');
    expect(out).toContain("<p>body</p>");
  });

  it("can be a third-level heading and needs no description, action or content", () => {
    const out = html(h(AnalyticsSection, { id: "x", title: "Small", level: 3 }));
    expect(out).toContain('<h3 id="x"');
    expect(out).not.toContain("text-muted");
    expect(out).not.toContain("max-w-full text-sm");
  });
});

describe("ChartCard", () => {
  it("is a card with a title, an optional line and action, around its content", () => {
    const out = html(h(ChartCard, { title: "Net revenue", description: "per day", action: h("span", null, "act") }, h("div", null, "chart")));
    expect(out).toContain("rounded-lg border border-border bg-background");
    expect(out).toContain("<h3");
    expect(out).toContain("Net revenue");
    expect(out).toContain("per day");
    expect(out).toContain("act");
    expect(out).toContain("<div>chart</div>");
    expect(out).toContain("min-w-0");
  });
});

describe("Note", () => {
  it("is a note with an icon and its words, info by default", () => {
    const out = html(h(Note, { title: "Not tracked" }, "Refunds made only in Stripe are not seen."));
    expect(out).toContain('role="note"');
    expect(out).toContain('data-tone="info"');
    expect(out).toContain("Not tracked");
    expect(out).toContain("Refunds made only in Stripe are not seen.");
    expect(out).toContain(">i<");
    expect(out).toContain('aria-hidden="true"');
  });

  it("marks a warning with its own icon and border, in tokens", () => {
    const out = html(h(Note, { tone: "warning", title: "Estimated" }, "Payment fees are an estimate."));
    expect(out).toContain('data-tone="warning"');
    expect(out).toContain(">!<");
    expect(out).toContain("border-(--chart-warn)");
  });

  it("works with only a title or only text", () => {
    const only = html(h(Note, { title: "Just a title" }));
    expect(only).toContain("Just a title");
    expect(only).not.toContain("text-muted\"><");
    expect(html(h(Note, null, "Only text"))).toContain("Only text");
  });

  it("uses no fixed colour", () => {
    const out = html(h(Note, { tone: "warning", title: "x" }, "y")) + html(h(ChartCard, { title: "t" })) + html(h(AnalyticsSection, { id: "i", title: "t" }));
    expect(out).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(out).not.toMatch(/(text|bg|border)-(red|green|amber|yellow|blue|gray|slate)-/);
  });
});
