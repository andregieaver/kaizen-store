import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import { formatMoney } from "@/lib/money";

import type { Account } from "./auth";
import type { Store } from "./stores";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fixture = await import("./analytics-insights-fixture");
const ownerTools = await import("./owner-tools");

/**
 * The AI manager's analytics tools (D152) run the way the assistant and the store's MCP server run them, through `runOwnerTool()`, on
 * the busy and the quiet store of `analytics-insights-fixture.ts`. The tools read the clock themselves, so the test's clock is set to the
 * fixture's moment (Date only: the database driver's timers are the real ones).
 */

let busy: Store;
let quiet: Store;
const audits: string[] = [];
const ctx = (store: Store) => ({ account: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", name: "Owner", platformAdmin: false } as Account, store, invalidate: (tag: string) => void audits.push(tag) });
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;
const run = (store: Store, name: string, input: unknown = {}) => ownerTools.runOwnerTool(ctx(store), name, input) as Promise<Answer>;

const figure = (out: Answer, name: string) => out.figures.find((f: { figure: string }) => f.figure === name);
const WORDS = /NaN|undefined|Infinity|\[object|\bnull\b/;

/** Every piece of text in an answer (a JSON `null` is a value, not a word): none may be a broken figure. */
const texts = (value: unknown): string[] => (typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(texts) : value && typeof value === "object" ? Object.values(value).flatMap(texts) : []);
const noBrokenText = (out: unknown) => expect(texts(out).filter((t) => WORDS.test(t))).toEqual([]);

beforeAll(async () => {
  busy = await fixture.makeStore("tools-busy", true);
  quiet = await fixture.makeStore("tools-quiet", false);
  await fixture.seedBusyStore(busy);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixture.NOW);
});

afterAll(async () => {
  vi.useRealTimers();
  await closeDb();
});

describe("analytics_overview", () => {
  it("gives every figure written out with its change against the previous period, counted from the orders", async () => {
    const out = await run(busy, "analytics_overview", { period: "7d", compare: "previous" });
    expect(out.currency).toBe(busy.markets[0].currency);
    expect(out.period).toEqual({ label: "Last 7 days", from: "2026-10-08", to: "2026-10-14" });
    expect(out.compared_with).toMatchObject({ from: "2026-10-01", to: "2026-10-07", how: "the period just before" });
    expect(out.figures.map((f: { figure: string }) => f.figure)).toEqual(
      expect.arrayContaining(["Revenue", "Net revenue", "Orders", "Conversion rate", "Average order value", "Gross profit", "Refund rate", "Visits", "Revenue per visitor"]),
    );
    // Four paid orders in the last seven days against 19 in the seven before them (the fixture's own count): 4 of 680 visits against 19 of 470.
    expect(figure(out, "Orders")).toMatchObject({ value: "4", was: "19", change: "−78.9 %" });
    expect(figure(out, "Conversion rate")).toMatchObject({ value: "0.6 %", was: "4.0 %" });
    // Amounts are written as the store writes them, 4 x 80.00 without VAT.
    expect(figure(out, "Revenue").value).toBe(formatMoney(32_000, out.currency, busy.markets[0].locale));
    expect(figure(out, "Revenue").more).toBe(`/admin/${busy.slug}/analytics/finance`);
    // Fees, shipping and fixed costs were never entered: said, not left out.
    expect(out.missing.map((m: { what: string }) => m.what).join(" ")).toContain("Payment fees");
    expect(out.cost_coverage.words).toMatch(/based on \d+ % of sales/);
    expect(out.notes[0]).toContain("without VAT");
    noBrokenText(out);
  });

  it("compares with the same dates a year earlier when asked", async () => {
    const out = await run(busy, "analytics_overview", { period: "30d", compare: "year" });
    expect(out.compared_with.from).toBe("2025-09-15");
    expect(out.compared_with.how).toBe("the same dates a year earlier");
    // Nothing was sold a year ago: no change is given for a figure that went from nothing, and no zero is made up.
    expect(figure(out, "Orders").was).toBe("0");
    noBrokenText(out);
  });

  it("says there is no profit to show, not a zero, and that visit counting is off, for a store with no orders and no counting", async () => {
    const out = await run(quiet, "analytics_overview", {});
    expect(out.missing.map((m: { what: string }) => m.what).join(" ")).toContain("Visit counting is off");
    expect(figure(out, "Conversion rate")).toMatchObject({ value: "–", where_to_fix: `/admin/${quiet.slug}/analytics/settings` });
    expect(figure(out, "Conversion rate").not_known).toContain("visit counting");
    expect(figure(out, "Gross profit")).toMatchObject({ value: "–", not_known: expect.stringContaining("No orders were paid") });
    expect(figure(out, "Gross margin").value).toBe("–");
    expect(figure(out, "Orders").value).toBe("0");
    noBrokenText(out);
  });

  it("refuses a period it does not know, in words the model can use", async () => {
    await expect(run(busy, "analytics_overview", { period: "decade" })).rejects.toThrow(/arguments could not be read/);
  });
});

describe("explain_change", () => {
  it("answers with the diagnosis's own sentences, the factors and where to look", async () => {
    const out = await run(busy, "explain_change", { period: "7d" });
    expect(out.period).toEqual({ label: "Last 7 days", from: "2026-10-08", to: "2026-10-14" });
    expect(out.basis).toBe("Revenue before refunds, without VAT, in DKK.");
    expect(out.direction).toBe("down");
    expect(out.change.startsWith("−")).toBe(true);
    expect(out.change_percent).toBe("−78.9 %");
    expect(out.sentences[0]).toBe("Revenue is down 79 % on the previous period.");
    expect(out.sentences[1]).toBe("Traffic +45 %, conversion −85 %, average order 0 %.");
    expect(out.factors.map((f: { factor: string }) => f.factor)).toEqual(["Traffic", "Conversion", "Average order"]);
    expect(out.main_factor).toBe("Conversion");
    expect(out.where_to_look).toEqual({ words: "The funnel on the Traffic page", page: `/admin/${busy.slug}/analytics/traffic` });
    // Four orders against nineteen: said to be few, so possibly chance.
    expect(out.notes.join(" ")).toContain("may be chance");
    noBrokenText(out);
  });

  it("says plainly that there is nothing to explain for a store with no orders", async () => {
    const out = await run(quiet, "explain_change", { period: "7d", compare: "year" });
    expect(out.direction).toBe("unknown");
    expect(out.reason).toContain("no orders");
    expect(out.factors).toEqual([]);
    expect(out.where_to_look).toBeUndefined();
    noBrokenText(out);
  });
});

describe("analytics_alerts", () => {
  it("lists what needs a look, most pressing first, with its figures and the admin page to open", async () => {
    const out = await run(busy, "analytics_alerts");
    expect(out.count).toBe(3);
    expect(out.alerts.map((a: { severity: string }) => a.severity)).toEqual(["urgent", "urgent", "warning"]);
    const [conversion, stock, refunds] = out.alerts;
    expect(conversion.text).toContain("Conversion rate is 83 % lower over the last 7 days");
    expect(conversion.page).toBe(`/admin/${busy.slug}/analytics/traffic`);
    expect(conversion.figures[0]).toContain("Conversion rate, the last 7 days: 0.6 % (against 3.9 % over the four weeks before)");
    expect(stock.text).toContain("Out of stock");
    expect(stock.page).toBe(`/admin/${busy.slug}/analytics/inventory`);
    expect(refunds.text).toContain("3 of 8");
    expect(refunds.page).toBe(`/admin/${busy.slug}/analytics/products?sort=refunds`);
    expect(out.note).toContain("minimum volume");
    noBrokenText(out);
  });

  it("says that nothing needs a look for a quiet store, and never throws", async () => {
    const out = await run(quiet, "analytics_alerts");
    expect(out.count).toBe(0);
    expect(out.alerts).toEqual([]);
    expect(out.note).toContain("nothing needs a look");
  });

  it("writes nothing: no audit entry and no cache refreshed by a read", async () => {
    audits.length = 0;
    await run(busy, "analytics_alerts");
    await run(busy, "analytics_overview", {});
    await run(busy, "explain_change", {});
    expect(audits).toEqual([]);
  });
});
