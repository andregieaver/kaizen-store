import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BUTTON_KINDS, BUTTON_SIZES, Button, ButtonLink, buttonClass, Card, Chip, CountBadge, fillWidth, InsightPanel, KpiTile, List, ListRow, PageHeader, RowAmount, RowId, ScoreBar, ShareBar, TrendChip } from "./index";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * The admin's components (docs/admin-style.md section 5): they draw in the colour roles only, so every scheme draws them, and they
 * keep what the style document promises a reader: colour never alone, a figure never hidden behind a bar, when the AI wrote a thing.
 */

describe("the components' source", () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it.each(files)("%s names no colour of its own and no older token: roles only", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:bg|text|border|divide|ring|fill|stroke|outline)-(?:white|black|(?:red|green|blue|amber|yellow|emerald|neutral|gray|zinc|slate|stone)-\d{2,3})\b/);
    expect(source).not.toMatch(/\b(?:bg|text|border|divide)-(?:background|foreground|surface|border|accent)\b/);
    // Hierarchy is size and colour, never weight (docs/admin-style.md 5.1).
    expect(source).not.toMatch(/\bfont-(?:semibold|bold|extrabold|black)\b/);
  });
});

describe("Button", () => {
  it("draws every kind as a pill in its roles, with its height, and the link without a shape", () => {
    for (const kind of BUTTON_KINDS) {
      for (const size of BUTTON_SIZES) {
        const cls = buttonClass(kind, size);
        if (kind === "link") expect(cls).not.toContain("rounded-pill");
        else expect(cls).toContain("rounded-pill");
        expect(cls).toContain("disabled:opacity-45");
      }
    }
    expect(buttonClass("main")).toContain("bg-brand text-brand-ink");
    expect(buttonClass("strong", "card", true)).toContain("bg-inverse text-inverse-ink");
    expect(buttonClass("strong", "card", true)).toContain("w-full");
    expect(buttonClass("danger")).toContain("bg-danger-soft text-danger-text");
    expect(buttonClass("main", "header")).toContain("h-11");
    expect(buttonClass("icon", "card")).toContain("size-10");
  });

  it("is a button that submits nothing unless asked, and a link that is a link", () => {
    expect(html(h(Button, { kind: "main" }, "Save"))).toMatch(/^<button type="button"/);
    expect(html(h(Button, { kind: "main", type: "submit" }, "Save"))).toMatch(/^<button type="submit"/);
    const link = html(h(ButtonLink, { kind: "link", href: "/admin/x/invoices" }, "All invoices"));
    expect(link).toMatch(/^<a [^>]*href="\/admin\/x\/invoices"/);
    expect(link).toContain('aria-hidden="true"'); // the chevron
  });

  it("names a round icon button", () => {
    const out = html(h(Button, { kind: "icon", "aria-label": "Notifications", icon: h("svg") }));
    expect(out).toContain('aria-label="Notifications"');
  });
});

describe("chips and badges", () => {
  it("draws a state in its signal's tint and words, the dot hidden", () => {
    const out = html(h(Chip, { signal: "warning", dot: true, children: "Overdue" }));
    expect(out).toContain("bg-warning-soft text-warning-text");
    expect(out).toContain('aria-hidden="true" class="size-1.5 rounded-full bg-warning-solid"');
    expect(out).toContain("Overdue");
  });

  it("says a trend in words, the arrow only repeating it", () => {
    const out = html(h(TrendChip, { direction: "up", signal: "danger", children: "Up 11 since June" }));
    expect(out).toContain('<span aria-hidden="true">↑</span>Up 11 since June');
    expect(out).toContain("bg-danger-soft");
  });

  it("reads a count by what it counts", () => {
    expect(html(h(CountBadge, { count: 4, label: "4 open invoices" }))).toContain('<span class="sr-only">4 open invoices</span>');
    expect(html(h(CountBadge, { count: 4 }))).not.toContain("sr-only");
  });
});

describe("cards and tiles", () => {
  it("labels a card by its title, flat in light and lined in dark", () => {
    const out = html(h(Card, { title: "Payment behaviour", count: 3, countLabel: "3 customers", aside: "Last 12 months" }, "body"));
    const id = out.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`<h2 id="${id}" class="text-title text-ink">Payment behaviour</h2>`);
    expect(out).toContain("rounded-card bg-card dark:border dark:border-line");
    expect(out).not.toMatch(/shadow/);
    expect(out).toContain("3 customers");
  });

  it("is a section without a name when it has no title", () => {
    expect(html(h(Card, {}, "body"))).not.toContain("aria-labelledby");
  });

  it("shows a KPI's label, value and context, a dash (never 0) for a figure not known, and links the whole tile", () => {
    const out = html(h(KpiTile, { label: "Outstanding", value: "842 000 kr", context: "Across 12 invoices" }));
    expect(out).toContain("text-metric text-ink tabular-nums");
    expect(out).toContain("Across 12 invoices");
    expect(html(h(KpiTile, { label: "Profit", value: null, context: "Costs are not entered yet." }))).not.toMatch(/>0</);
    expect(html(h(KpiTile, { label: "Orders", value: "31", href: "/admin/s/orders" }))).toMatch(/^<a [^>]*href="\/admin\/s\/orders"/);
  });
});

describe("bars", () => {
  it("never draws past the track", () => {
    expect(fillWidth(0.58)).toBe("58%");
    expect(fillWidth(1.4)).toBe("100%");
    expect(fillWidth(-1)).toBe("0%");
    expect(fillWidth(Number.NaN)).toBe("0%");
  });

  it("is read from its label and figure; the bar is hidden", () => {
    const out = html(h(ShareBar, { label: "Paid on time", figure: "58 %", share: 0.58, signal: "positive" }));
    expect(out).toContain("Paid on time");
    expect(out).toContain("58 %");
    expect(out).toMatch(/<span aria-hidden="true" class="block h-2[^"]*"><span class="[^"]*bg-positive-solid[^"]*" style="width:58%">/);
    expect(html(h(ScoreBar, { label: "Payment history", points: "+22", share: 0.7, signal: "insight" }))).toContain("+22");
  });
});

describe("the insight panel", () => {
  it("always says when the AI wrote it", () => {
    const out = html(h(InsightPanel, { title: "What changed", at: new Date("2026-10-14T09:00:00Z"), when: "Today, 11:00", children: "Fewer late payments." }));
    expect(out).toContain('<time dateTime="2026-10-14T09:00:00.000Z"');
    expect(out).toContain("Today, 11:00");
    expect(out).toContain("bg-insight-soft");
  });
});

describe("lists", () => {
  it("gives only a linked row the pointer's colour", () => {
    const plain = html(h(List, { label: "Invoices", children: h(ListRow, { children: [h(RowId, { key: 1, children: "INV-1" }), h(RowAmount, { key: 2, children: "100 kr" })] }) }));
    expect(plain).toContain('aria-label="Invoices"');
    expect(plain).not.toContain("hover:bg-sunken");
    const linked = html(h(List, { children: h(ListRow, { href: "/admin/s/invoices/1", children: h(RowId, { children: "INV-1" }) }) }));
    expect(linked).toContain('href="/admin/s/invoices/1"');
    expect(linked).toContain("hover:bg-sunken");
  });
});

describe("the page header", () => {
  it("joins the facts with a dot read as a pause, and leaves out empty ones", () => {
    const out = html(h(PageHeader, { eyebrow: "Customers", title: "Alderney Ceramics", meta: ["Oslo", null, "Since 2021"] }));
    expect(out).toContain('<h1 class="text-display text-ink');
    expect(out).toContain("Oslo<span aria-hidden=\"true\"> · </span><span class=\"sr-only\">, </span>Since 2021");
    expect(out).toContain("text-eyebrow text-muted uppercase");
  });
});
