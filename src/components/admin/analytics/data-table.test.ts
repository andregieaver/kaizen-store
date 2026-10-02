import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { arrowOf, DataTable, Delta, ShareBar, StatusPill, type Column } from "./data-table";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ");

type Row = { id: string; name: string; revenue: number; share: number };
const rows: Row[] = [
  { id: "a", name: "Blue running shoes", revenue: 1000, share: 0.8 },
  { id: "b", name: "Socks", revenue: 250, share: 0.2 },
];
const columns: Column<Row>[] = [
  { key: "name", label: "Product", sortable: true, firstDir: "asc", cell: (r) => r.name },
  { key: "revenue", label: "Revenue", align: "right", sortable: true, cell: (r) => `${r.revenue} kr` },
  { key: "share", label: "Share", align: "right", cell: (r) => h(ShareBar, { share: r.share, text: `${r.share * 100} %` }) },
];
const sortHref = (key: string, dir: string) => `/p?sort=${key}&dir=${dir}`;
const table = (extra: Record<string, unknown> = {}) => html(h(DataTable<Row>, { caption: "Products", columns, rows, rowKey: (r: Row) => r.id, ...extra }));

describe("DataTable", () => {
  it("is a real table with a caption read by screen readers, scoped headers and a row for each", () => {
    const out = table();
    expect(out).toContain('<caption class="sr-only">Products</caption>');
    expect(out.match(/<th[^>]*scope="col"/g)).toHaveLength(3);
    expect(out.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g)).toHaveLength(2);
    expect(out).toContain("Blue running shoes");
  });

  it("can show the caption", () => {
    expect(table({ showCaption: true })).toContain("px-3 py-2 text-left text-xs font-medium text-muted");
  });

  it("right-aligns figures in tabular numbers and left-aligns text", () => {
    const out = table();
    expect(out).toContain("text-right tabular-nums");
    expect(out).toMatch(/<th[^>]*text-right[^>]*>Revenue/);
    expect(out).toMatch(/<th[^>]*text-left[^>]*>Product/);
  });

  it("sorts by links: a header is an address, the current column flips and says which way it is sorted", () => {
    const out = table({ sort: { key: "revenue", dir: "desc" }, sortHref });
    expect(out).toContain('href="/p?sort=revenue&dir=asc"');
    expect(out).toContain('href="/p?sort=name&dir=asc"');
    expect(out).toMatch(/<th[^>]*aria-sort="descending"[^>]*>[\s\S]*Revenue/);
    expect(out).toMatch(/<th[^>]*aria-sort="none"[^>]*>[\s\S]*Product/);
    expect(out).toContain("▼");
    const asc = table({ sort: { key: "revenue", dir: "asc" }, sortHref });
    expect(asc).toContain('aria-sort="ascending"');
    expect(asc).toContain('href="/p?sort=revenue&dir=desc"');
  });

  it("starts a figure column descending and a text column as it says", () => {
    const out = table({ sort: null, sortHref });
    expect(out).toContain('href="/p?sort=revenue&dir=desc"');
    expect(out).toContain('href="/p?sort=name&dir=asc"');
  });

  it("has plain headers when it cannot sort, and no sort state on a column that cannot", () => {
    const out = table();
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("aria-sort");
    expect(table({ sortHref })).not.toMatch(/<th[^>]*>[^<]*<a[^>]*>Share/);
  });

  it("can keep its header in view", () => {
    const out = table({ sticky: true });
    expect(out).toContain("sticky top-0");
    expect(out).toContain("max-h-[32rem]");
    expect(table()).not.toContain("sticky top-0");
  });

  it("says so when empty, without a table, and still names itself", () => {
    const out = table({ rows: [], empty: "No products sold." });
    expect(out).not.toContain("<table");
    expect(out).toContain("No products sold.");
    expect(out).toContain("Products: ");
    expect(table({ rows: [] })).toContain("Nothing to show for this period.");
  });

  it("keeps a long first cell inside its column and takes a foot", () => {
    const long = [{ id: "x", name: "N".repeat(200), revenue: 1, share: 0 }];
    expect(html(h(DataTable<Row>, { caption: "P", columns, rows: long, rowKey: (r: Row) => r.id }))).toContain("max-w-[14rem] truncate");
    const out = table({ footer: h("tr", null, h("td", null, "Total")) });
    expect(out).toContain("<tfoot");
    expect(out).toContain("Total");
  });

  it("scrolls inside its own box", () => {
    expect(table()).toContain("overflow-x-auto");
  });
});

describe("ShareBar", () => {
  it("writes the figure and draws the bar as decoration", () => {
    const out = html(h(ShareBar, { share: 0.421, text: "42.1 %" }));
    expect(out).toContain("42.1 %");
    expect(out).toContain("width:42.1%");
    expect(out).toContain('aria-hidden="true"');
  });

  it("is empty for nothing, clamps over 100 % and below zero, and survives a missing share", () => {
    expect(html(h(ShareBar, { share: 0, text: "0 %" }))).toContain("width:0%");
    expect(html(h(ShareBar, { share: 1.5, text: "150 %" }))).toContain("width:100%");
    expect(html(h(ShareBar, { share: -0.2, text: "-20 %" }))).toContain("width:0%");
    const none = html(h(ShareBar, { share: null, text: "–" }));
    expect(none).toContain("width:0%");
    expect(none).not.toContain("NaN");
    expect(html(h(ShareBar, { share: NaN, text: "–" }))).not.toContain("NaN");
  });

  it("can carry a title", () => {
    expect(html(h(ShareBar, { share: 0.5, text: "50 %", label: "Share of revenue" }))).toContain('title="Share of revenue"');
  });
});

describe("arrowOf", () => {
  it("points by the sign of the change", () => {
    expect(arrowOf(5)).toBe("up");
    expect(arrowOf(-5)).toBe("down");
    expect(arrowOf(0)).toBe("flat");
    expect(arrowOf(null)).toBe("flat");
    expect(arrowOf(undefined)).toBe("flat");
    expect(arrowOf(NaN)).toBe("flat");
  });
});

describe("Delta", () => {
  it("carries the arrow, the signed text, the words for what it is against and a hidden word for a screen reader", () => {
    const out = html(h(Delta, { delta: { text: "+12.4 %", abs: 3 }, versus: "vs previous period", good: "up" }));
    expect(out).toContain("▲");
    expect(out).toContain("+12.4 %");
    expect(out).toContain("vs previous period");
    expect(out).toContain('<span class="sr-only">Up, better: </span>');
    expect(out).toContain("text-(--chart-good)");
  });

  it("is red for a bad change and muted for a neutral one", () => {
    expect(html(h(Delta, { delta: { text: "-5.0 %", abs: -2 }, versus: "v", good: "up" }))).toContain("text-(--chart-bad)");
    const neutral = html(h(Delta, { delta: { text: "-5.0 %", abs: -2 }, versus: "v" }));
    expect(neutral).toContain("text-muted");
    expect(neutral).not.toContain("--chart-bad");
  });

  it("shows a dash and the words when there is no change to show", () => {
    for (const delta of [null, undefined]) {
      const out = html(h(Delta, { delta, versus: "vs same period last year" }));
      expect(out).toContain("–");
      expect(out).toContain("vs same period last year");
      expect(out).not.toContain("▲");
    }
  });
});

describe("StatusPill", () => {
  it("has an icon and words for every tone, so colour is never alone", () => {
    const icons = { good: "✓", warning: "!", bad: "✕", neutral: "•", info: "i" } as const;
    for (const tone of Object.keys(icons) as (keyof typeof icons)[]) {
      const out = html(h(StatusPill, { tone, children: "Out of stock" }));
      expect(out).toContain("Out of stock");
      expect(out).toContain(`>${icons[tone]}<`);
      expect(out).toContain('aria-hidden="true"');
    }
  });

  it("is neutral by default and never wraps", () => {
    const out = html(h(StatusPill, { children: "Draft" }));
    expect(out).toContain("•");
    expect(out).toContain("whitespace-nowrap");
  });
});
