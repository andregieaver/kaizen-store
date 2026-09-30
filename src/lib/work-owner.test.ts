import { describe, expect, it } from "vitest";

import {
  activeStoreSlug,
  addFigures,
  combineOverviews,
  defaultNewStore,
  figuresPerCurrency,
  mergeReports,
  newClientHref,
  newInvoiceHref,
  ownerReportFileName,
  ownerReportToCsv,
  parseOwnerReportParams,
  parseStoreParam,
  scopeStores,
  storeMainCurrency,
  switchOffNote,
  timeVisibility,
  withStore,
  type StoreOverview,
  type WorkStore,
} from "./work-owner";
import { workOverview, type OverviewEntry, type OverviewInvoice } from "./work-overview";
import type { PeriodReport, ReportRow } from "./work-reports";

const TODAY = "2026-09-29";
const NOW = Date.parse("2026-09-29T12:00:00Z");

const store = (over: Partial<WorkStore> & Pick<WorkStore, "slug">): WorkStore => ({
  id: `id-${over.slug}`,
  name: over.slug.toUpperCase(),
  timeZone: "Europe/Oslo",
  role: "owner",
  market: { code: "NO", currency: "NOK", defaultLocale: "nb" },
  workOn: true,
  lastUsedAt: null,
  ...over,
});

const NO = store({ slug: "kaffe" });
const SE = store({ slug: "bok", role: "admin", market: { code: "SE", currency: "SEK", defaultLocale: "sv" } });

const invoice = (o: Partial<OverviewInvoice> & Pick<OverviewInvoice, "id" | "status">): OverviewInvoice => ({
  clientId: "c1",
  currency: "NOK",
  totalMinor: 0,
  paidMinor: 0,
  creditedMinor: 0,
  dueOn: null,
  paidOn: null,
  updatedOn: TODAY,
  recurringPeriod: null,
  ...o,
});
const entry = (o: Partial<OverviewEntry>): OverviewEntry => ({
  clientId: "c1",
  assignmentId: "a1",
  billingType: "hourly",
  currency: "NOK",
  rateMinor: 100_000,
  workDate: "2026-09-20",
  minutes: 60,
  billable: true,
  prepaidMinutes: 0,
  invoiceLineId: null,
  ...o,
});

function part(s: WorkStore, invoices: OverviewInvoice[], entries: OverviewEntry[], clientCount = 1): StoreOverview {
  const base = `/admin/account/work/s/${s.slug}`;
  return {
    store: s,
    today: TODAY,
    clientCount,
    overview: workOverview({ today: TODAY, now: NOW, invoices, entries, timers: [], base, label: s.name }),
  };
}

describe("choosing stores", () => {
  const stores = [NO, SE];
  it("narrows only to a store the account works in", () => {
    expect(scopeStores(stores, "bok")).toEqual([SE]);
    expect(scopeStores(stores, "")).toEqual(stores);
    // A store the account cannot see is treated as all of its own, never opened.
    expect(scopeStores(stores, "someone-elses")).toEqual(stores);
    expect(activeStoreSlug(stores, "someone-elses")).toBe("");
    expect(activeStoreSlug(stores, "kaffe")).toBe("kaffe");
  });

  it("reads the store from the address, trimmed and capped", () => {
    expect(parseStoreParam({ store: " kaffe " })).toBe("kaffe");
    expect(parseStoreParam({ store: ["a", "b"] })).toBe("a");
    expect(parseStoreParam({})).toBe("");
    expect(parseStoreParam({ store: "x".repeat(500) })).toHaveLength(100);
  });

  it("adds the store to a query string", () => {
    expect(withStore("", "kaffe")).toBe("?store=kaffe");
    expect(withStore("?show=overdue", "kaffe")).toBe("?show=overdue&store=kaffe");
    expect(withStore("?show=overdue", "")).toBe("?show=overdue");
  });

  it("starts a new client or invoice in the narrowed, only, last used, else first store", () => {
    expect(defaultNewStore([], "")).toBeNull();
    expect(defaultNewStore([NO], "")?.slug).toBe("kaffe");
    expect(defaultNewStore([NO, SE], "bok")?.slug).toBe("bok");
    expect(defaultNewStore([NO, SE], "nope")?.slug).toBe("kaffe");
    const recent = [
      { ...NO, lastUsedAt: "2026-09-01T10:00:00.000Z" },
      { ...SE, lastUsedAt: "2026-09-20T10:00:00.000Z" },
    ];
    expect(defaultNewStore(recent, "")?.slug).toBe("bok");
    expect(newClientHref("bok")).toBe("/admin/account/work/s/bok/clients");
    expect(newInvoiceHref("bok")).toBe("/admin/account/work/s/bok/invoices?new=1");
  });

  it("gives an owner everyone's time and others their own", () => {
    expect(timeVisibility([NO, SE])).toEqual({ everyone: ["id-kaffe"], ownOnly: ["id-bok"] });
  });

  it("uses the store's own market currency, never a guess", () => {
    expect(storeMainCurrency(NO)).toBe("NOK");
    expect(storeMainCurrency(SE)).toBe("SEK");
  });
});

describe("money is never added across currencies", () => {
  const nok = part(NO, [invoice({ id: "i1", status: "sent", totalMinor: 100_000, dueOn: "2026-09-01" })], [entry({})]);
  const nok2 = part(
    store({ slug: "kurs" }),
    [invoice({ id: "i2", status: "sent", totalMinor: 50_000, dueOn: "2026-10-30" })],
    [entry({ minutes: 120 })],
  );
  const sek = part(
    SE,
    [invoice({ id: "i3", status: "sent", totalMinor: 70_000, currency: "SEK", dueOn: "2026-09-05" })],
    [entry({ currency: "SEK", rateMinor: 90_000 })],
  );

  it("adds stores in the same currency and keeps other currencies apart", () => {
    const combined = combineOverviews([nok, nok2, sek]);
    expect(combined.currencies.map((f) => f.currency)).toEqual(["NOK", "SEK"]);
    const [n, s] = combined.currencies;
    expect(n.unbilled.amountMinor).toBe(100_000 + 200_000);
    expect(n.unbilled.minutes).toBe(180);
    expect(n.receivables.outstandingMinor).toBe(150_000);
    expect(s.unbilled.amountMinor).toBe(90_000);
    expect(s.receivables.outstandingMinor).toBe(70_000);
    // Minutes have no currency, so they are added.
    expect(combined.counts.unbilledMinutes).toBe(240);
    expect(combined.clientCount).toBe(3);
  });

  it("keeps each store's own figures beside the total", () => {
    const combined = combineOverviews([nok, sek]);
    expect(combined.perStore.map((p) => [p.store.slug, p.currencies.map((f) => f.currency)])).toEqual([
      ["kaffe", ["NOK"]],
      ["bok", ["SEK"]],
    ]);
  });

  it("tags rows with their store and puts the oldest overdue first", () => {
    const combined = combineOverviews([nok, sek]);
    expect(combined.overdueInvoices.map((i) => [i.storeSlug, i.invoiceId])).toEqual([
      ["kaffe", "i1"],
      ["bok", "i3"],
    ]);
    expect(combined.unbilledByClient.every((r) => r.storeSlug)).toBe(true);
    expect(combined.counts.overdue).toBe(2);
  });

  it("refuses to add two currencies directly", () => {
    expect(() => addFigures(nok.overview.currencies[0], sek.overview.currencies[0])).toThrow(/different currencies/);
  });

  it("figuresPerCurrency of nothing is nothing", () => {
    expect(figuresPerCurrency([])).toEqual([]);
    expect(combineOverviews([]).currencies).toEqual([]);
  });

  it("sorts attention urgent first", () => {
    const urgent = part(
      SE,
      [invoice({ id: "late", status: "sent", totalMinor: 1000, currency: "SEK", dueOn: "2026-08-01" })],
      [],
    );
    const calm = part(NO, [invoice({ id: "d", status: "draft", updatedOn: "2026-09-01" })], []);
    const combined = combineOverviews([calm, urgent]);
    expect(combined.attention[0].urgent).toBe(true);
    expect(combined.attention.every((a) => a.storeSlug)).toBe(true);
  });
});

describe("the combined report", () => {
  const rowOf = (over: Partial<ReportRow> & Pick<ReportRow, "key" | "currency">): ReportRow => ({
    clientId: "c1",
    clientName: "Acme, Inc.",
    assignmentId: null,
    assignmentName: null,
    billingType: "hourly",
    minutes: 60,
    billableMinutes: 60,
    unbilledMinutes: 0,
    unbilledMinor: 0,
    draftMinor: 0,
    invoicedMinor: 100_000,
    creditedMinor: 0,
    netInvoicedMinor: 100_000,
    netInvoicedInclMinor: 125_000,
    paidMinor: 0,
    outstandingMinor: 125_000,
    ...over,
  });
  const reportOf = (rows: ReportRow[], currency: string): PeriodReport => ({
    from: "2026-09-01",
    to: "2026-09-30",
    by: "client",
    rows,
    totals: rows.length
      ? [
          {
            ...rows.reduce((sum, r) => ({ ...sum, invoicedMinor: sum.invoicedMinor + r.invoicedMinor })),
            currency,
          } as PeriodReport["totals"][number],
        ]
      : [],
    totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
    totalBillableMinutes: rows.reduce((s, r) => s + r.billableMinutes, 0),
  });

  it("merges rows per store and totals per currency", () => {
    const a = reportOf([rowOf({ key: "c1", currency: "NOK" })], "NOK");
    const b = reportOf([rowOf({ key: "c1", currency: "NOK", clientId: "c9" })], "NOK");
    const c = reportOf([rowOf({ key: "c1", currency: "SEK", invoicedMinor: 7_000, netInvoicedMinor: 7_000 })], "SEK");
    const merged = mergeReports([
      { store: NO, report: a },
      { store: store({ slug: "kurs" }), report: b },
      { store: SE, report: c },
    ]);
    expect(merged.rows.map((r) => r.storeSlug)).toEqual(["kaffe", "kurs", "bok"]);
    expect(merged.totals.map((t) => [t.currency, t.netInvoicedMinor])).toEqual([
      ["NOK", 200_000],
      ["SEK", 7_000],
    ]);
    expect(merged.totalMinutes).toBe(180);
    expect(merged.periodsDiffer).toBe(false);
  });

  it("carries each store's zero totals when there are no rows, and notices different periods", () => {
    const empty = (currency: string, to = "2026-09-30"): PeriodReport => ({
      ...reportOf([], currency),
      to,
      totals: [{ ...rowOf({ key: "x", currency }), currency, invoicedMinor: 0 } as PeriodReport["totals"][number]],
    });
    const merged = mergeReports([
      { store: NO, report: empty("NOK") },
      { store: SE, report: empty("SEK", "2026-09-29") },
    ]);
    expect(merged.rows).toEqual([]);
    expect(merged.totals.map((t) => t.currency)).toEqual(["NOK", "SEK"]);
    expect(merged.periodsDiffer).toBe(true);
    expect(mergeReports([]).totals).toEqual([]);
  });

  it("writes a store column, a total per currency and plain text for formulas", () => {
    const evil = rowOf({ key: "c1", currency: "NOK", clientName: "=HYPERLINK(\"http://x\")" });
    const merged = mergeReports([
      { store: { ...NO, name: "+cmd|' /C calc'!A0" }, report: reportOf([evil], "NOK") },
      { store: SE, report: reportOf([rowOf({ key: "c1", currency: "SEK" })], "SEK") },
    ]);
    const csv = ownerReportToCsv(merged);
    const lines = csv.split("\r\n");
    expect(lines.find((l) => l.startsWith("Store,"))).toBeTruthy();
    // No cell starts with a formula character: they are prefixed so a spreadsheet reads them as text.
    for (const line of lines.slice(6)) {
      for (const cell of line.split(",")) expect(cell).not.toMatch(/^"?[=+@-]/);
    }
    expect(csv).toContain("Total,,,,NOK");
    expect(csv).toContain("Total,,,,SEK");
    expect(ownerReportFileName(merged, "")).toContain("all-stores");
    expect(ownerReportFileName(merged, "bok")).toContain("bok");
  });

  it("works out each store's period on its own day", () => {
    const stores = [
      { id: "a", timeZone: "Pacific/Auckland" },
      { id: "b", timeZone: "America/Los_Angeles" },
    ];
    // 2026-09-30 23:00 UTC is the 1st of October in Auckland and still the 30th in Los Angeles.
    const { head, byStore } = parseOwnerReportParams({ period: "this_month" }, stores, Date.parse("2026-09-30T23:00:00Z"));
    expect(byStore.get("a")?.period.from).toBe("2026-10-01");
    expect(byStore.get("b")?.period.from).toBe("2026-09-01");
    expect(head.clientId).toBe("");
    expect(head.period.from).toBe("2026-10-01");
  });

  it("uses the same presets and custom days as a store's report, and no client filter", () => {
    const stores = [{ id: "a", timeZone: "Europe/Oslo" }];
    const now = Date.parse("2026-09-29T12:00:00Z");
    const custom = parseOwnerReportParams({ period: "custom", from: "2026-01-05", to: "2026-02-10", client: "x" }, stores, now);
    expect(custom.head.period).toMatchObject({ preset: "custom", from: "2026-01-05", to: "2026-02-10" });
    expect(custom.head.clientId).toBe("");
    expect(parseOwnerReportParams({}, [], now).head.period.preset).toBe("this_month");
  });
});

describe("switching Work off", () => {
  it("says it hides and keeps, and what is there", () => {
    expect(switchOffNote({ issuedInvoices: 0, runningTimers: 0 })).toMatch(/kept/);
    expect(switchOffNote({ issuedInvoices: 1, runningTimers: 2 })).toContain("1 issued invoice and 2 running timers");
  });
});
