import { describe, expect, it } from "vitest";

import {
  LONG_TIMER_HOURS,
  outstandingMinor,
  workOverview,
  type OverviewEntry,
  type OverviewInvoice,
} from "./work-overview";

const TODAY = "2026-09-29";
const NOW = Date.parse("2026-09-29T12:00:00Z");
const BASE = "/admin/account/work/s/kaizen";

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
  rateMinor: 120_000,
  workDate: "2026-09-20",
  minutes: 60,
  billable: true,
  prepaidMinutes: 0,
  invoiceLineId: null,
  ...o,
});

const overview = (o: Partial<Parameters<typeof workOverview>[0]> = {}) =>
  workOverview({ today: TODAY, now: NOW, invoices: [], entries: [], timers: [], base: BASE, ...o });

describe("an empty Work area", () => {
  it("has no figures and nothing to attend to", () => {
    const o = overview();
    expect(o.currencies).toEqual([]);
    expect(o.attention).toEqual([]);
    expect(o.unbilledByClient).toEqual([]);
    expect(o.counts).toMatchObject({
      overdue: 0,
      drafts: 0,
      staleDrafts: 0,
      recurringReady: 0,
      longTimers: 0,
      lowBalances: 0,
    });
  });
});

describe("receivables", () => {
  const invoices = [
    invoice({ id: "overdue-nok", status: "sent", totalMinor: 100_000, dueOn: "2026-09-20" }),
    invoice({ id: "soon-nok", status: "sent", totalMinor: 50_000, paidMinor: 20_000, dueOn: "2026-10-03" }),
    invoice({ id: "later-nok", status: "sent", totalMinor: 70_000, dueOn: "2026-11-01" }),
    invoice({ id: "today-nok", status: "sent", totalMinor: 10_000, dueOn: "2026-09-29" }),
    invoice({
      id: "credited-eur",
      status: "sent",
      currency: "EUR",
      totalMinor: 9_900,
      creditedMinor: 9_900,
      dueOn: "2026-09-01",
    }),
    invoice({ id: "overdue-eur", status: "sent", currency: "EUR", totalMinor: 20_000, dueOn: "2026-09-10" }),
  ];

  it("buckets what is owed by due date, per currency, never adding currencies", () => {
    const o = overview({ invoices });
    const nok = o.currencies.find((c) => c.currency === "NOK")!;
    expect(nok.receivables.overdue).toEqual({ count: 1, minor: 100_000, oldestDueOn: "2026-09-20" });
    expect(nok.receivables.dueSoon).toEqual({ count: 2, minor: 30_000 + 10_000 }); // due today is not overdue
    expect(nok.receivables.notYetDue).toEqual({ count: 1, minor: 70_000 });
    expect(nok.receivables.outstandingMinor).toBe(100_000 + 40_000 + 70_000);
    const eur = o.currencies.find((c) => c.currency === "EUR")!;
    expect(eur.receivables.overdue).toEqual({ count: 1, minor: 20_000, oldestDueOn: "2026-09-10" });
    expect(eur.receivables.outstandingMinor).toBe(20_000); // the credited one owes nothing
    expect(o.currencies.map((c) => c.currency)).toEqual(["EUR", "NOK"]);
  });

  it("lists overdue invoices oldest first", () => {
    const o = overview({ invoices });
    expect(o.overdueInvoices.map((i) => [i.invoiceId, i.daysOverdue, i.outstandingMinor])).toEqual([
      ["overdue-eur", 19, 20_000],
      ["overdue-nok", 9, 100_000],
    ]);
  });

  it("uses the store's day: overdue starts when the store's day has passed the due date", () => {
    const due = [invoice({ id: "i", status: "sent", totalMinor: 100, dueOn: "2026-09-29" })];
    expect(overview({ invoices: due, today: "2026-09-29" }).counts.overdue).toBe(0);
    expect(overview({ invoices: due, today: "2026-09-30" }).counts.overdue).toBe(1);
  });

  it("never counts an overpaid invoice as owing", () => {
    expect(outstandingMinor({ totalMinor: 100, paidMinor: 150, creditedMinor: 0 })).toBe(0);
    expect(outstandingMinor({ totalMinor: 100, paidMinor: 30, creditedMinor: 20 })).toBe(50);
  });

  it("counts paid invoices by the month they were paid in", () => {
    const o = overview({
      invoices: [
        invoice({ id: "p1", status: "paid", totalMinor: 40_000, paidOn: "2026-09-03" }),
        invoice({ id: "p2", status: "paid", totalMinor: 10_000, paidOn: "2026-09-28" }),
        invoice({ id: "old", status: "paid", totalMinor: 99_000, paidOn: "2026-08-30" }),
        invoice({ id: "void", status: "void", totalMinor: 5_000 }),
      ],
    });
    expect(o.currencies).toHaveLength(1);
    expect(o.currencies[0].paidThisMonth).toEqual({ count: 2, minor: 50_000 });
    expect(o.currencies[0].receivables.outstandingMinor).toBe(0);
  });
});

describe("drafts", () => {
  it("counts drafts and their value, and notices the stale and the recurring ones ready to issue", () => {
    const o = overview({
      invoices: [
        invoice({
          id: "d1",
          status: "draft",
          totalMinor: 30_000,
          updatedOn: "2026-09-20",
          recurringPeriod: "2026-09-15",
        }),
        invoice({ id: "d2", status: "draft", totalMinor: 12_000, updatedOn: "2026-09-28" }),
        invoice({
          id: "d3",
          status: "draft",
          totalMinor: 1_000,
          updatedOn: "2026-09-28",
          recurringPeriod: "2026-10-15",
        }),
      ],
    });
    expect(o.currencies[0].drafts).toEqual({ count: 3, minor: 43_000 });
    expect(o.counts).toMatchObject({ drafts: 3, staleDrafts: 1, recurringReady: 1 });
    const texts = o.attention.map((a) => a.text);
    expect(texts).toContain("1 recurring invoice is ready to issue.");
    expect(texts).toContain("1 invoice draft has been waiting for over 7 days.");
  });
});

describe("unbilled time", () => {
  const entries = [
    entry({ minutes: 90, workDate: "2026-08-01" }), // stale
    entry({ minutes: 30, billable: false }), // not billable
    entry({ minutes: 60, prepaidMinutes: 60 }), // covered by prepaid hours
    entry({ minutes: 15, invoiceLineId: "line-1" }), // already on a draft
    entry({ minutes: 500, billingType: "fixed_fee", assignmentId: "fixed" }), // a fixed fee has no hourly amount
    entry({ assignmentId: "a2", clientId: "c2", rateMinor: 100_000, minutes: 20, workDate: "2026-09-20" }),
    entry({ assignmentId: "a3", clientId: "c3", currency: "EUR", rateMinor: 8_000, minutes: 60 }),
  ];

  it("counts billable, uncovered, unbilled hourly time at the rates, per assignment and currency", () => {
    const o = overview({ entries });
    const nok = o.currencies.find((c) => c.currency === "NOK")!;
    expect(nok.unbilled).toEqual({
      minutes: 110,
      amountMinor: 180_000 + 33_000, // 1.50 h at 1200 and 0.33 h at 1000
      oldestWorkDate: "2026-08-01",
    });
    const eur = o.currencies.find((c) => c.currency === "EUR")!;
    expect(eur.unbilled).toMatchObject({ minutes: 60, amountMinor: 8_000 });
    expect(o.unbilledByClient).toEqual([
      { clientId: "c1", currency: "NOK", minutes: 90, amountMinor: 180_000 },
      { clientId: "c2", currency: "NOK", minutes: 20, amountMinor: 33_000 },
      { clientId: "c3", currency: "EUR", minutes: 60, amountMinor: 8_000 },
    ]);
  });

  it("rounds hours once per assignment, as a line would, not per entry", () => {
    const o = overview({
      entries: [entry({ minutes: 20 }), entry({ minutes: 20 }), entry({ minutes: 20 })],
    });
    // 60 minutes is 1.00 h at 1200, where three 0.33 h lines would be 0.99 h
    expect(o.currencies[0].unbilled.amountMinor).toBe(120_000);
  });

  it("says when time has been unbilled for over 30 days", () => {
    const o = overview({ entries });
    expect(o.counts.staleUnbilledMinutes).toBe(90);
    const item = o.attention.find((a) => a.text.includes("unbilled"))!;
    expect(item.text).toBe("1h 30m of time has been unbilled for over 30 days.");
    expect(item.href).toBe(`${BASE}/invoices/new`);
    expect(overview({ entries: [entry({ workDate: "2026-08-30" })] }).counts.staleUnbilledMinutes).toBe(0); // exactly 30 days is not over
    expect(overview({ entries: [entry({ workDate: "2026-08-29" })] }).counts.staleUnbilledMinutes).toBe(60);
  });
});

describe("timers and balances", () => {
  it("lists running timers and flags one left running over 12 hours", () => {
    const o = overview({
      timers: [
        { accountId: "u1", assignmentId: "a1", startedAt: Date.parse("2026-09-28T08:00:00Z") }, // 28 h
        { accountId: "u2", assignmentId: "a1", startedAt: NOW - 10 * 60_000 },
      ],
    });
    expect(o.runningTimers.map((t) => t.elapsedMinutes)).toEqual([28 * 60, 10]);
    expect(o.counts.longTimers).toBe(1);
    expect(LONG_TIMER_HOURS).toBe(12);
    expect(o.attention.map((a) => a.text)).toEqual(["1 timer has been running for over 12 hours."]);
  });

  it("flags clients low on prepaid hours", () => {
    const o = overview({
      balances: [
        { clientId: "c1", minutes: 60, lowBelowMinutes: 120 },
        { clientId: "c2", minutes: 300, lowBelowMinutes: 120 },
        { clientId: "c3", minutes: 120, lowBelowMinutes: 120 },
      ],
    });
    expect(o.lowBalances).toEqual([{ clientId: "c1", minutes: 60 }]);
    expect(o.attention.map((a) => a.text)).toEqual(["1 client is low on prepaid hours."]);
  });
});

describe("what needs attention", () => {
  it("puts an invoice far overdue first and points at Work's own pages", () => {
    const o = overview({
      label: "Kaizen",
      invoices: [
        invoice({ id: "a", status: "sent", totalMinor: 100, dueOn: "2026-09-20" }),
        invoice({ id: "b", status: "sent", currency: "EUR", totalMinor: 100, dueOn: "2026-09-10" }),
        invoice({ id: "d", status: "draft", updatedOn: "2026-09-01" }),
      ],
    });
    expect(o.attention[0]).toEqual({
      text: "Kaizen: 2 invoices are overdue, the oldest by 19 days.",
      href: `${BASE}/invoices?show=overdue`,
      action: "Open invoices",
      urgent: true,
    });
    expect(o.attention.some((a) => a.text.includes("draft"))).toBe(true);
  });

  it("does not call a recent overdue invoice urgent", () => {
    const o = overview({ invoices: [invoice({ id: "a", status: "sent", totalMinor: 100, dueOn: "2026-09-28" })] });
    expect(o.attention).toEqual([
      {
        text: "1 invoice is overdue, the oldest by 1 day.",
        href: `${BASE}/invoices?show=overdue`,
        action: "Open invoices",
        urgent: false,
      },
    ]);
  });
});
