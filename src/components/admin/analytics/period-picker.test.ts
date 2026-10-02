import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PeriodPicker } from "./period-picker";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/ /g, " ");

const base = { basePath: "/admin/shop/analytics", preset: "30d" as const, from: "2026-09-03", to: "2026-10-02", compare: "previous" as const };

describe("PeriodPicker", () => {
  it("has a link for every preset, with the current one marked and a navigation name", () => {
    const out = html(h(PeriodPicker, base));
    expect(out).toContain('<nav aria-label="Period"');
    for (const label of ["Today", "Yesterday", "Last 7 days", "Last 30 days", "This month", "Previous month", "This year"]) expect(out).toContain(label);
    expect(out).not.toContain(">Custom range<");
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="true"[^>]*>Last 30 days</);
  });

  it("makes each preset an address that keeps the comparison and the page's other parameters", () => {
    const out = html(h(PeriodPicker, { ...base, compare: "year", preserve: { sort: "revenue", dir: "desc" } }));
    expect(out).toContain('href="/admin/shop/analytics?period=7d&compare=year&sort=revenue&dir=desc"');
    // the default period and comparison leave the address short
    const plain = html(h(PeriodPicker, base));
    expect(plain).toContain('href="/admin/shop/analytics"');
    expect(plain).toContain('href="/admin/shop/analytics?period=today"');
  });

  it("is a GET form for a custom range with both dates, kept comparison and the preserved parameters", () => {
    const out = html(h(PeriodPicker, { ...base, preserve: { sort: "units" }, max: "2026-10-02" }));
    const form = /<form[^>]*aria-label="Custom range"[\s\S]*?<\/form>/.exec(out)?.[0] ?? "";
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/admin/shop/analytics"');
    expect(form).toMatch(/<input[^>]*type="hidden"[^>]*name="period"[^>]*value="custom"/);
    expect(form).toMatch(/<input[^>]*type="hidden"[^>]*name="compare"[^>]*value="previous"/);
    expect(form).toMatch(/<input[^>]*type="hidden"[^>]*name="sort"[^>]*value="units"/);
    expect(form).toMatch(/<input[^>]*type="date"[^>]*name="from"[^>]*value="2026-09-03"/);
    expect(form).toMatch(/<input[^>]*type="date"[^>]*name="to"[^>]*value="2026-10-02"/);
    expect(form).toContain('max="2026-10-02"');
    expect(form).toContain("required");
    expect(form).toContain("Apply range");
  });

  it("labels its fields so a keyboard or screen reader user can use them", () => {
    const out = html(h(PeriodPicker, base));
    expect(out.match(/<label/g)).toHaveLength(3);
    expect(out).toContain("From");
    expect(out).toContain("To");
    expect(out).toContain("Compare with");
    expect(out).toContain("<button");
    expect(out).not.toContain('tabindex="-1"');
  });

  it("offers each comparison with the current one selected", () => {
    const out = html(h(PeriodPicker, { ...base, compare: "none" }));
    expect(out).toContain("Previous period");
    expect(out).toContain("Same period last year");
    expect(out).toContain("No comparison");
    expect(out).toMatch(/<option value="none" selected/);
    expect(out).not.toMatch(/<option value="previous" selected/);
  });

  it("sends the comparison form back with the same period, a custom one with its dates", () => {
    const preset = html(h(PeriodPicker, { ...base, preset: "month" }));
    const form = /<form[^>]*aria-label="Comparison"[\s\S]*?<\/form>/.exec(preset)?.[0] ?? "";
    expect(form).toMatch(/<input[^>]*name="period"[^>]*value="month"/);
    expect(form).not.toContain('name="from"');
    const custom = html(h(PeriodPicker, { ...base, preset: "custom", from: "2026-08-01", to: "2026-08-15" }));
    const cform = /<form[^>]*aria-label="Comparison"[\s\S]*?<\/form>/.exec(custom)?.[0] ?? "";
    expect(cform).toMatch(/<input[^>]*name="period"[^>]*value="custom"/);
    expect(cform).toMatch(/<input[^>]*name="from"[^>]*value="2026-08-01"/);
    expect(cform).toMatch(/<input[^>]*name="to"[^>]*value="2026-08-15"/);
  });

  it("marks no preset as current for a custom range", () => {
    const out = html(h(PeriodPicker, { ...base, preset: "custom" }));
    expect(out).not.toContain('aria-current="true"');
  });

  it("escapes what it echoes", () => {
    const out = html(h(PeriodPicker, { ...base, preserve: { q: '"><script>alert(1)</script>' } }));
    expect(out).not.toContain("<script>");
  });
});
