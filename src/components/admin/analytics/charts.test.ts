import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BarChart, CohortTable, Funnel, Heatmap, HorizontalBars, LineChart, Meter, seriesColor, Sparkline } from "./charts";

/** What a person reads: tags and comment markers left as the server wrote them, entities made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ");

const money = (n: number) => `${n.toLocaleString("en-GB")} kr`;
const count = (n: number) => String(n);
const days = ["1 Oct", "2 Oct", "3 Oct", "4 Oct", "5 Oct"];

const count_of = (text: string, re: RegExp) => (text.match(re) ?? []).length;

describe("seriesColor", () => {
  it("takes the categorical set in order and goes muted past the sixth, never cycling", () => {
    expect(seriesColor(0)).toBe("var(--chart-1)");
    expect(seriesColor(5)).toBe("var(--chart-6)");
    expect(seriesColor(6)).toBe("var(--chart-compare)");
  });
});

describe("LineChart", () => {
  const base = { label: "Net revenue per day", labels: days, format: money };

  it("is a named image with a description, a legend only when there is more than one thing, and a table behind", () => {
    const out = html(h(LineChart, { ...base, series: [{ key: "a", label: "Net revenue", values: [100, 200, 150, 300, 250] }] }));
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Net revenue per day"/);
    const describedby = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(describedby).toBeTruthy();
    expect(out).toContain(`<desc id="${describedby}">Net revenue: 5 points, latest 250 kr, highest 300 kr, lowest 100 kr</desc>`);
    expect(out).not.toContain('aria-label="Legend"');
    expect(out).toContain("<details");
    expect(out).toContain("Data table");
    expect(out).toContain("<caption");
    expect(count_of(out, /<tr/g)).toBe(1 + 5);
  });

  it("draws the line at 2px with an end dot ringed in the surface colour, and tooltips with every figure", () => {
    const out = html(h(LineChart, { ...base, series: [{ key: "a", label: "Net revenue", values: [100, 200, 150, 300, 250] }] }));
    expect(out).toContain('stroke="var(--chart-1)" stroke-width="2"');
    expect(out).toMatch(/<circle[^>]*r="4"[^>]*stroke="var\(--background\)"/);
    expect(out).toContain("<title>1 Oct\nNet revenue: 100 kr</title>");
    expect(count_of(out, /class="an-hit"/g)).toBe(5);
  });

  it("draws the comparison dashed and muted, in the legend and the table", () => {
    const out = html(
      h(LineChart, { ...base, previousLabel: "Previous period", series: [{ key: "a", label: "Net revenue", values: [100, 200, 150, 300, 250], previous: [80, 90, 100, 110, 120] }] }),
    );
    expect(out).toContain('stroke="var(--chart-compare)"');
    expect(out).toContain('stroke-dasharray="4 3"');
    expect(out).toContain('aria-label="Legend"');
    expect(out).toContain("Previous period");
    expect(out).toContain("Previous period: 80 kr");
  });

  it("shows two or three series with their own colours and a legend", () => {
    const out = html(
      h(LineChart, {
        ...base,
        series: [
          { key: "a", label: "Revenue", values: [1, 2, 3, 4, 5] },
          { key: "b", label: "Profit", values: [0, 1, 1, 2, 2] },
          { key: "c", label: "Costs", values: [1, 1, 2, 2, 3] },
          { key: "d", label: "Fourth", values: [9, 9, 9, 9, 9] },
        ],
      }),
    );
    expect(out).toContain('stroke="var(--chart-1)"');
    expect(out).toContain('stroke="var(--chart-2)"');
    expect(out).toContain('stroke="var(--chart-3)"');
    expect(out).not.toContain("Fourth");
    expect(out).toContain('aria-label="Legend"');
  });

  it("says so when there is nothing to draw, for no points, no series and only gaps", () => {
    for (const props of [
      { labels: [], series: [{ key: "a", label: "A", values: [] }] },
      { labels: days, series: [] },
      { labels: days, series: [{ key: "a", label: "A", values: [null, null, null, null, null] }] },
    ]) {
      const out = html(h(LineChart, { label: "Orders", format: count, ...props }));
      expect(out).toContain('role="img"');
      expect(out).toContain('aria-label="Orders: No data for this period."');
      expect(out).not.toContain("<svg");
    }
  });

  it("draws a single point as a dot, with no line to break", () => {
    const out = html(h(LineChart, { label: "One", labels: ["1 Oct"], series: [{ key: "a", label: "A", values: [5] }], format: count }));
    expect(out).toContain("<circle");
    expect(out).toContain("A: 1 points, latest 5, highest 5, lowest 5");
    expect(out).not.toContain("NaN");
  });

  it("draws all zero as a flat line on a usable axis, and says so", () => {
    const out = html(h(LineChart, { label: "Zero", labels: days, series: [{ key: "a", label: "A", values: [0, 0, 0, 0, 0] }], format: count, integer: true }));
    expect(out).toContain("A: 5 points, all zero");
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("Infinity");
  });

  it("breaks the line at a gap and shows the gap as a dash in the tooltip and table", () => {
    const out = html(h(LineChart, { ...base, series: [{ key: "a", label: "A", values: [1, 2, null, 4, 5] }] }));
    expect(out).toMatch(/<path d="M[^"]* M[^"]*"[^>]*stroke="var\(--chart-1\)"/);
    expect(out).toContain("A: –");
  });

  it("copes with negative values by drawing the zero line inside the plot", () => {
    const out = html(h(LineChart, { ...base, series: [{ key: "a", label: "Profit", values: [-300, -100, 200, 400, -50] }] }));
    expect(out).not.toContain("NaN");
    expect(out).toContain("-300 kr");
    expect(out).toContain('stroke="var(--chart-axis)"');
  });

  it("keeps long x labels short and the page free of overflow", () => {
    const out = html(h(LineChart, { label: "Long", labels: ["A very long label indeed", "Another very long label", "Third long one"], series: [{ key: "a", label: "A", values: [1, 2, 3] }], format: count }));
    expect(out).toContain("A very lo…");
    expect(out).toContain("A very long label indeed"); // whole in the table and tooltip
    expect(out).toContain("min-w-[280px]"); // narrow enough for a phone: the latest point is never scrolled out of sight
  });

  it("writes a week's axis label without its 'Week of', so the cut-off labels are not all the same", () => {
    const labels = ["Week of 2 Feb", "Week of 9 Feb", "Week of 16 Feb"];
    const out = html(h(LineChart, { label: "Weekly", labels, series: [{ key: "a", label: "A", values: [1, 2, 3] }], format: count }));
    expect(out).toContain(">2 Feb<");
    expect(out).toContain(">16 Feb<");
    expect(out).not.toContain("Week of 2…");
    expect(out).toContain("Week of 16 Feb"); // whole in the table and the tooltip
  });

  it("ends the last x label at the chart's edge instead of letting it run past", () => {
    const out = html(h(LineChart, { ...base, series: [{ key: "a", label: "A", values: [1, 2, 3, 4, 5] }] }));
    expect(out).toContain('text-anchor="end"');
  });

  it("gives every chart its own description id", () => {
    const one = html(h("div", null, h(LineChart, { ...base, series: [{ key: "a", label: "A", values: [1, 2, 3, 4, 5] }] }), h(LineChart, { ...base, series: [{ key: "a", label: "A", values: [1, 2, 3, 4, 5] }] })));
    const ids = [...one.matchAll(/<desc id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("leaves off the hover columns for a very long series but keeps the table", () => {
    const labels = Array.from({ length: 250 }, (_, i) => `D${i}`);
    const out = html(h(LineChart, { label: "Long run", labels, series: [{ key: "a", label: "A", values: labels.map((_, i) => i) }], format: count }));
    expect(out).not.toContain("an-hit");
    expect(count_of(out, /<tr/g)).toBe(251);
  });
});

describe("BarChart", () => {
  const base = { label: "Orders per day", labels: days, format: count };

  it("draws a column per label with a named image, a table and no legend for one series", () => {
    const out = html(h(BarChart, { ...base, series: [{ key: "a", label: "Orders", values: [3, 0, 5, 2, 8] }] }));
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Orders per day"/);
    expect(count_of(out, /class="an-mark"/g)).toBe(4); // the zero has no column
    expect(out).not.toContain('aria-label="Legend"');
    expect(out).toContain("Orders: 5 columns, total 18, highest 8");
    expect(count_of(out, /<tr/g)).toBe(1 + 5);
  });

  it("is capped at 24px thick however few columns there are", () => {
    const out = html(h(BarChart, { label: "Few", labels: ["A", "B"], series: [{ key: "a", label: "S", values: [1, 2] }], format: count }));
    const path = /<path d="(M[^"]+)"[^>]*class="an-mark"/.exec(out)?.[1] ?? "";
    const xs = [...path.matchAll(/[MHQ ]([\d.]+) /g)].map((m) => Number(m[1]));
    expect(path).toBeTruthy();
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(24.1);
  });

  it("groups several series side by side with a legend and their own colours", () => {
    const out = html(h(BarChart, { ...base, series: [{ key: "a", label: "New", values: [1, 2, 3, 4, 5] }, { key: "b", label: "Returning", values: [2, 2, 2, 2, 2] }] }));
    expect(out).toContain('fill="var(--chart-1)"');
    expect(out).toContain('fill="var(--chart-2)"');
    expect(out).toContain('aria-label="Legend"');
    expect(out).toContain("<title>1 Oct\nNew: 1\nReturning: 2</title>");
  });

  it("stacks, with a total column in the table and a gap between segments", () => {
    const out = html(h(BarChart, { ...base, stacked: true, series: [{ key: "a", label: "New", values: [1, 2, 3, 4, 5] }, { key: "b", label: "Returning", values: [2, 2, 2, 2, 2] }] }));
    expect(out).toContain("Total");
    expect(count_of(out, /class="an-mark"/g)).toBe(10);
    expect(out).not.toContain("NaN");
  });

  it("draws a negative column below the zero line, also stacked", () => {
    const plain = html(h(BarChart, { ...base, series: [{ key: "a", label: "Profit", values: [-5, 3, -2, 0, 4] }] }));
    expect(plain).not.toContain("NaN");
    expect(plain).toContain("-5");
    const stacked = html(h(BarChart, { ...base, stacked: true, series: [{ key: "a", label: "A", values: [-5, 3, 1, 0, 4] }, { key: "b", label: "B", values: [2, -3, 1, 0, 1] }] }));
    expect(stacked).not.toContain("NaN");
    expect(count_of(stacked, /class="an-mark"/g)).toBeGreaterThanOrEqual(7);
  });

  it("says so when there is nothing, and draws all zero as an empty plot with its axis", () => {
    expect(html(h(BarChart, { label: "Empty", labels: [], series: [], format: count }))).toContain("No data for this period.");
    expect(html(h(BarChart, { label: "Gaps", labels: ["A"], series: [{ key: "a", label: "A", values: [null] }], format: count }))).toContain("No data for this period.");
    const zero = html(h(BarChart, { label: "Zero", labels: days, series: [{ key: "a", label: "A", values: [0, 0, 0, 0, 0] }], format: count, integer: true }));
    expect(zero).toContain("A: all zero");
    expect(zero).not.toContain("NaN");
    expect(zero).not.toContain("class=\"an-mark\"");
  });

  it("handles one column and 100 columns", () => {
    expect(html(h(BarChart, { label: "One", labels: ["Only"], series: [{ key: "a", label: "A", values: [7] }], format: count }))).toContain("class=\"an-mark\"");
    const labels = Array.from({ length: 100 }, (_, i) => `D${i}`);
    const out = html(h(BarChart, { label: "Many", labels, series: [{ key: "a", label: "A", values: labels.map((_, i) => i + 1) }], format: count }));
    expect(count_of(out, /class="an-mark"/g)).toBe(100);
    expect(out).not.toContain("NaN");
  });
});

describe("HorizontalBars", () => {
  const rows = [
    { label: "Blue running shoes", value: 1000, valueText: "1 000 kr", detail: "12 orders" },
    { label: "Socks", value: 250, valueText: "250 kr" },
    { label: "Refunded thing", value: -100, valueText: "-100 kr" },
  ];

  it("is a labelled list with the figures as text and bars as decoration", () => {
    const out = html(h(HorizontalBars, { label: "Top products", rows }));
    expect(out).toContain('<ol aria-label="Top products"');
    expect(count_of(out, /<li/g)).toBe(3);
    expect(out).toContain("1 000 kr");
    expect(out).toContain("12 orders");
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("width:100%");
    expect(out).toContain("width:25%");
  });

  it("shows a negative in the bad colour with its sign in the text", () => {
    const out = html(h(HorizontalBars, { label: "Top products", rows }));
    expect(out).toContain("var(--chart-bad)");
    expect(out).toContain("-100 kr");
    expect(out).toContain("width:10%");
  });

  it("links a row, keeps the whole label in title, and cuts to a limit saying so", () => {
    const out = html(h(HorizontalBars, { label: "Top", rows: [{ label: "A".repeat(80), value: 1, valueText: "1", href: "/admin/x/products/1" }, ...rows], limit: 2 }));
    expect(out).toContain('href="/admin/x/products/1"');
    expect(out).toContain(`title="${"A".repeat(80)}"`);
    expect(out).toContain("truncate");
    expect(out).toContain("Showing 2 of 4.");
  });

  it("is empty for no rows, draws all zero as bars of no length, and an unknown value as no bar", () => {
    expect(html(h(HorizontalBars, { label: "Top", rows: [] }))).toContain("Nothing to show for this period.");
    const zero = html(h(HorizontalBars, { label: "Top", rows: [{ label: "A", value: 0, valueText: "0" }, { label: "B", value: null, valueText: "–" }] }));
    expect(zero).toContain("width:0%");
    expect(zero).not.toContain("NaN");
  });

  it("keeps an entity's colour by its index, not by its rank", () => {
    const out = html(h(HorizontalBars, { label: "Channels", rows: [{ label: "Email", value: 5, valueText: "5", colorIndex: 2 }, { label: "Direct", value: 9, valueText: "9", colorIndex: 0 }] }));
    expect(out.indexOf("var(--chart-3)")).toBeGreaterThan(-1);
    expect(out.indexOf("var(--chart-3)")).toBeLessThan(out.indexOf("var(--chart-1)"));
  });
});

describe("Sparkline", () => {
  it("is decoration without a label and an image with one", () => {
    const plain = html(h(Sparkline, { values: [1, 2, 3] }));
    expect(plain).toContain('aria-hidden="true"');
    expect(plain).not.toContain('role="img"');
    const named = html(h(Sparkline, { values: [1, 2, 3], label: "Revenue, last 3 days" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Revenue, last 3 days"');
  });

  it("draws nothing for nothing, a dot for one figure and a middle line for a flat series", () => {
    expect(html(h(Sparkline, { values: [] }))).toBe("");
    expect(html(h(Sparkline, { values: [null, null] }))).toBe("");
    const one = html(h(Sparkline, { values: [5] }));
    expect(one).toContain("<circle");
    const flat = html(h(Sparkline, { values: [4, 4, 4] }));
    expect(flat).not.toContain("NaN");
    expect(flat).toContain("<path");
  });

  it("takes the news' colour", () => {
    expect(html(h(Sparkline, { values: [1, 2], tone: "good" }))).toContain("var(--chart-good)");
    expect(html(h(Sparkline, { values: [1, 2], tone: "bad" }))).toContain("var(--chart-bad)");
    expect(html(h(Sparkline, { values: [1, 2] }))).toContain("var(--chart-1)");
  });
});

describe("Funnel", () => {
  const stages = [
    { label: "Sessions", value: 1000 },
    { label: "Product views", value: 600 },
    { label: "Added to cart", value: 120 },
    { label: "Orders", value: 30 },
  ];

  it("is a labelled list with bars as wide as the counts and the share that went on between", () => {
    const out = html(h(Funnel, { label: "Conversion funnel", stages, format: count }));
    expect(out).toContain('<ol aria-label="Conversion funnel"');
    expect(count_of(out, /<li/g)).toBe(4);
    expect(out).toContain("width:60%");
    expect(out).toContain("60.0 % went on from the step before");
    expect(out).toContain("25.0 % went on from the step before");
    expect(out).toContain("3.0 % of the first");
  });

  it("says Not tracked for an unknown stage, with no bar, and never converts across it", () => {
    const out = html(h(Funnel, { label: "Funnel", stages: [{ label: "Sessions", value: null }, { label: "Carts", value: 40 }, { label: "Orders", value: 10 }], format: count }));
    expect(out).toContain("Not tracked");
    expect(out).toContain("Share that went on: –");
    expect(out).toContain("25.0 % went on from the step before");
    expect(count_of(out, /<li/g)).toBe(3);
  });

  it("is empty with no stages or none known, and handles all zero without dividing by it", () => {
    expect(html(h(Funnel, { label: "Funnel", stages: [], format: count }))).toContain("No data for this period.");
    expect(html(h(Funnel, { label: "Funnel", stages: [{ label: "A", value: null }], format: count }))).toContain("No data for this period.");
    const zero = html(h(Funnel, { label: "Funnel", stages: [{ label: "A", value: 0 }, { label: "B", value: 0 }], format: count }));
    expect(zero).not.toContain("NaN");
    expect(zero).not.toContain("Infinity");
    expect(zero).toContain("Share that went on: –");
  });

  it("gives a tiny stage a visible bar and keeps a long label whole in its title", () => {
    const out = html(h(Funnel, { label: "Funnel", stages: [{ label: "L".repeat(90), value: 100000 }, { label: "B", value: 1, note: "Counted at checkout" }], format: count }));
    expect(out).toContain("min-width:2px");
    expect(out).toContain(`title="${"L".repeat(90)}"`);
    expect(out).toContain("Counted at checkout");
  });
});

describe("Heatmap", () => {
  const columns = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const rows = [
    { label: "00–02", values: [0, 1, 0, 0, 0, 0, 2] },
    { label: "10–12", values: [5, 8, 6, 7, 10, 3, null] },
  ];

  it("is a named image with a description of the peak, cells on the ramp, and a table behind", () => {
    const out = html(h(Heatmap, { label: "Orders by weekday and hour", columns, rows, format: count }));
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Orders by weekday and hour"/);
    expect(out).toContain("the most is 10 on Fri, 10–12");
    expect(count_of(out, /<rect/g)).toBe(14);
    expect(out).toContain("var(--chart-seq-6)");
    expect(out).toContain("var(--chart-seq-0)");
    expect(out).toContain("<title>10–12, Fri: 10</title>");
    expect(out).toContain("Data table");
    expect(count_of(out, /<tr/g)).toBe(1 + 2);
  });

  it("shows a cell with no figure as blank and says no data in its tooltip, not zero", () => {
    const out = html(h(Heatmap, { label: "H", columns, rows, format: count }));
    expect(out).toContain("<title>10–12, Sun: no data</title>");
    expect(out).toContain('fill="var(--chart-grid)"');
  });

  it("has a key from none to the most", () => {
    const out = html(h(Heatmap, { label: "H", columns, rows, format: count }));
    expect(count_of(out, /--chart-seq-\d\)"/g)).toBeGreaterThanOrEqual(7);
    expect(out).toContain("<span>10</span>");
  });

  it("is empty when no cell has anything, for no rows and for all zero", () => {
    expect(html(h(Heatmap, { label: "H", columns, rows: [], format: count }))).toContain("No data for this period.");
    expect(html(h(Heatmap, { label: "H", columns, rows: [{ label: "A", values: [0, 0, 0, 0, 0, 0, 0] }], format: count }))).toContain("No data for this period.");
    expect(html(h(Heatmap, { label: "H", columns: [], rows, format: count }))).toContain("No data for this period.");
  });

  it("tells a tiny value from none", () => {
    const out = html(h(Heatmap, { label: "H", columns: ["Mon", "Tue"], rows: [{ label: "A", values: [1, 100000] }], format: count }));
    expect(out).toContain('fill="var(--chart-seq-1)"');
    expect(out).toContain('fill="var(--chart-seq-6)"');
  });

  it("copes with long row labels", () => {
    const out = html(h(Heatmap, { label: "H", columns, rows: [{ label: "A very long band label here", values: [1, 2, 3, 4, 5, 6, 7] }], format: count }));
    expect(out).toContain("A very long b…");
    expect(out).not.toContain("NaN");
  });
});

describe("CohortTable", () => {
  const columns = ["Month 0", "Month 1", "Month 2"];
  const rows = [
    { label: "Jul 2026", size: 120, values: [1, 0.2, 0.1] },
    { label: "Aug 2026", size: 90, values: [1, 0.15, null] },
    { label: "Sep 2026", size: 0, values: [null, null, null] },
  ];

  it("is a table with headers, the share written in each cell and the ramp behind it", () => {
    const out = html(h(CohortTable, { label: "Customer retention by first month", columns, rows }));
    expect(out).toContain("<caption");
    expect(out).toContain('scope="col"');
    expect(out).toContain('scope="row"');
    expect(out).toContain("100 %");
    expect(out).toContain("20 %");
    expect(out).toContain("background:var(--chart-seq-6);color:var(--chart-seq-6-ink)");
    expect(out).toContain("<td>120</td>".replace("<td>", '<td class="px-2 py-1 text-right tabular-nums">'));
  });

  it("leaves a month not yet reached blank, never 0 %", () => {
    const out = html(h(CohortTable, { label: "C", columns, rows }));
    expect(out).not.toMatch(/Aug 2026, Month 2/);
    expect(out).not.toContain("Sep 2026, Month");
    expect(out).toContain('<td class="px-2 py-1"></td>');
  });

  it("shows a real zero as 0 % on the lightest step", () => {
    const out = html(h(CohortTable, { label: "C", columns: ["Month 0"], rows: [{ label: "X", size: 5, values: [0] }] }));
    expect(out).toContain("0 %");
    expect(out).toContain("background:var(--chart-seq-0)");
  });

  it("is empty for no cohorts or no columns", () => {
    expect(html(h(CohortTable, { label: "C", columns, rows: [] }))).toContain("No cohorts yet.");
    expect(html(h(CohortTable, { label: "C", columns: [], rows }))).toContain("No cohorts yet.");
  });

  it("scrolls inside its box rather than the page", () => {
    expect(html(h(CohortTable, { label: "C", columns, rows }))).toContain("overflow-x-auto");
  });
});

describe("Meter", () => {
  const spaced = (n: number) => `${String(n).replace(/\B(?=(\d{3})+$)/g, " ")} kr`;
  const props = { label: "October net revenue target", format: spaced, value: 6000, target: 10000, expected: 5000 };

  it("is a meter with its range and a value text that says everything", () => {
    const out = html(h(Meter, props));
    expect(out).toContain('role="meter"');
    expect(out).toContain('aria-valuemin="0"');
    expect(out).toContain('aria-valuemax="10000"');
    expect(out).toContain('aria-valuenow="6000"');
    expect(out).toContain("6 000 kr of 10 000 kr (60 %), Expected by today: 5 000 kr, Ahead of pace");
  });

  it("writes the state and marks where it should be by today", () => {
    const out = html(h(Meter, props));
    expect(out).toContain("Ahead of pace");
    expect(out).toContain("left:calc(50% - 1px)");
    expect(out).toContain("var(--chart-good)");
    const behind = html(h(Meter, { ...props, value: 2000 }));
    expect(behind).toContain("Behind pace");
    expect(behind).toContain("var(--chart-warn)");
    expect(html(h(Meter, { ...props, value: 5100 }))).toContain("On pace");
  });

  it("without an expected figure has no tick and no pace", () => {
    const out = html(h(Meter, { ...props, expected: null }));
    expect(out).not.toContain("Ahead of pace");
    expect(out).not.toContain("left:calc");
    expect(out).toContain("var(--chart-1)");
  });

  it("says there is no target rather than drawing an empty bar", () => {
    for (const target of [null, 0, -5]) {
      const out = html(h(Meter, { ...props, target }));
      expect(out).toContain("No target set.");
      expect(out).not.toContain('role="meter"');
    }
  });

  it("clamps a target already passed, and nothing earned yet", () => {
    const over = html(h(Meter, { ...props, value: 25000 }));
    expect(over).toContain('aria-valuenow="10000"');
    expect(over).toContain("width:100%");
    expect(over).toContain("250 %");
    const none = html(h(Meter, { ...props, value: null }));
    expect(none).toContain("width:0%");
    expect(none).toContain("Behind pace");
    const negative = html(h(Meter, { ...props, value: -300 }));
    expect(negative).toContain('aria-valuenow="0"');
    expect(negative).toContain("width:0%");
  });
});
