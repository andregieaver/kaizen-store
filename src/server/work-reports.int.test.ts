import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addCalendarDays } from "@/lib/work-dates";
import { periodReportToCsv, type PeriodReport } from "@/lib/work-reports";

import {
  creditReportLine,
  issueReportInvoice,
  logReportTime,
  makeReportAssignment,
  makeReportClient,
  makeReportDraft,
  makeReportStore,
  payReportInvoice,
  reportToday,
  type ReportFixture,
} from "./work-reports-test-support";
import { workBase } from "@/lib/work-paths";

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

// The route asks the session who the member is; the test answers for it.
const members = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/server/auth", () => ({
  requireMember: async (slug: string) => {
    const member = members.get(slug);
    if (!member) throw new Error(`not a member of ${slug}`);
    return member;
  },
  getMembership: async (slug: string) => members.get(slug) ?? null,
  holderOf: (member: { role: string; kind?: string; permissions?: string[] | null }) => ({ role: member.role, kind: member.kind, permissions: member.permissions }),
  audit: async () => {},
}));

const reports = await import("./work-reports");
const route = await import("@/app/admin/(gated)/(owner)/account/work/s/[store]/reports/csv/route");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * Work's reports (docs/work.md 7.2 WP9) against a real database: a fixed fee counted once, credit notes netting
 * what was invoiced, days in the store's time zone including the days daylight saving moves, currencies kept
 * apart, another store's rows never seen, an empty period, and the CSV download.
 *
 * The invoices are issued through the same functions the admin uses, on days counted back from the store's
 * today, so the test holds on any day it is run.
 */

afterAll(async () => {
  await closeDb();
});

const day = (from: string, days: number) => addCalendarDays(from, days);
const asStore = async (f: ReportFixture) => {
  const store = await getStore(f.slug);
  if (!store) throw new Error("no store");
  return store;
};
const rowFor = (r: PeriodReport, name: string, currency?: string) =>
  r.rows.find((x) => (x.assignmentName ?? x.clientName) === name && (!currency || x.currency === currency));

describe("the period report", () => {
  let f: ReportFixture;
  let today: string;
  let acme: string;
  let beta: string;
  let website: string;
  let retainer: string;
  let audit: string;
  let store: Awaited<ReturnType<typeof asStore>>;
  let creditedInvoice: string;
  let other: ReportFixture;
  let otherClient: string;

  // The period under test: T-30 to T-10, both included.
  const from = () => day(today, -30);
  const to = () => day(today, -10);
  const run = (over: Partial<Parameters<typeof reports.getPeriodReport>[1]> = {}) =>
    reports.getPeriodReport(store, { from: from(), to: to(), by: "assignment", ...over });

  beforeAll(async () => {
    f = await makeReportStore("rep");
    today = await reportToday(f);
    acme = await makeReportClient(f, { name: "Acme", rate: 100000 });
    beta = await makeReportClient(f, { name: "Beta", currency: "EUR", rate: 5000 });
    website = await makeReportAssignment(f, acme, { name: "Website" });
    retainer = await makeReportAssignment(f, acme, { name: "Retainer", billing: "fixed_fee", fixed: 500000 });
    audit = await makeReportAssignment(f, beta, { name: "Audit" });

    // In date order (a store refuses an issue date before the previous invoice's).
    await issueReportInvoice(f, acme, day(today, -45), [{ assignmentId: website, priceMinor: 40000 }]); // before the period
    await issueReportInvoice(f, acme, day(today, -31), [{ assignmentId: website, priceMinor: 8000 }]); // the day before
    await issueReportInvoice(f, acme, day(today, -30), [{ assignmentId: website, priceMinor: 1200 }]); // the first day
    await issueReportInvoice(f, acme, day(today, -25), [{ assignmentId: retainer, description: "Retainer", priceMinor: 500000 }]); // the fixed fee
    const two = await issueReportInvoice(f, acme, day(today, -20), [
      { assignmentId: website, description: "Design", priceMinor: 100000 },
      { assignmentId: website, description: "Build", priceMinor: 100000 },
    ]);
    creditedInvoice = two.invoiceId;
    await payReportInvoice(f, two.invoiceId, 100000, day(today, -15));
    // Credit the second line, dated today: after the period, netted against the invoice of the period all the same.
    await creditReportLine(f, two.invoiceId, two.lineIds[1], 100);
    // Another currency: an invoice in euro needs the rate to the seller's currency.
    await issueReportInvoice(f, beta, day(today, -15), [{ assignmentId: audit, priceMinor: 20000 }], { fxRate: "11.5" });
    await issueReportInvoice(f, acme, day(today, -10), [{ assignmentId: website, priceMinor: 4000 }]); // the last day
    await issueReportInvoice(f, acme, day(today, -9), [{ assignmentId: website, priceMinor: 16000 }]); // the day after

    // Time: on the first and last day (in), the day before and after (out), on a fixed fee, and not billable.
    await logReportTime(f, website, day(today, -30), 90);
    await logReportTime(f, website, day(today, -10), 20);
    await logReportTime(f, website, day(today, -31), 600);
    await logReportTime(f, website, day(today, -9), 600);
    await logReportTime(f, website, day(today, -20), 60, { billable: false });
    await logReportTime(f, website, day(today, -21), 60, { prepaid: 30 });
    await logReportTime(f, retainer, day(today, -22), 120);
    await logReportTime(f, audit, day(today, -12), 60);

    other = await makeReportStore("oth");
    otherClient = await makeReportClient(other, { name: "Acme" });
    const theirs = await makeReportAssignment(other, otherClient, { name: "Website" });
    await issueReportInvoice(other, otherClient, day(today, -20), [{ assignmentId: theirs, priceMinor: 999999 }]);
    await logReportTime(other, theirs, day(today, -20), 600);

    store = await asStore(f);
    members.set(f.slug, { store, account: { id: f.accountId, email: "o@example.com", name: "O", platformAdmin: false }, role: "owner" });
  });

  it("counts an invoice in the period of the day it was issued, both ends of the period included", async () => {
    const r = await run({ by: "client" });
    const nok = r.totals.find((t) => t.currency === "NOK")!;
    // 1 200 (first day) + 500 000 (fee) + 200 000 (two lines) + 4 000 (last day), all without VAT.
    expect(nok.invoicedMinor).toBe(1200 + 500000 + 200000 + 4000);
    // the day before (80.00) and the day after (160.00) are not there
    expect(rowFor(r, "Acme")!.invoicedMinor).toBe(705200);
  });

  it("counts a fixed fee once, in the period it was invoiced, in whatever periods it is shown", async () => {
    const inPeriod = await run();
    expect(rowFor(inPeriod, "Retainer")).toMatchObject({ invoicedMinor: 500000, billingType: "fixed_fee" });
    // The same fee is in none of the neighbouring periods, though the assignment has time in one of them.
    const before = await reports.getPeriodReport(store, { from: day(today, -60), to: day(today, -31), by: "assignment" });
    const after = await reports.getPeriodReport(store, { from: day(today, -9), to: today, by: "assignment" });
    expect(rowFor(before, "Retainer")).toBeUndefined();
    expect(rowFor(after, "Retainer")).toBeUndefined();
    // Cut the year into pieces: the fee is in exactly one of them, and the pieces add up to the whole.
    const cuts = [
      [day(today, -365), day(today, -31)],
      [day(today, -30), day(today, -10)],
      [day(today, -9), today],
    ];
    const pieces = await Promise.all(cuts.map(([a, b]) => reports.getPeriodReport(store, { from: a, to: b, by: "client" })));
    const whole = await reports.getPeriodReport(store, { from: day(today, -365), to: today, by: "client" });
    const fee = pieces.map((p) => rowFor(p, "Acme")?.invoicedMinor ?? 0);
    expect(fee.reduce((a, b) => a + b, 0)).toBe(rowFor(whole, "Acme", "NOK")!.invoicedMinor);
    // the fixed fee's time is hours only, with no hourly value
    expect(rowFor(inPeriod, "Retainer")).toMatchObject({ minutes: 120, unbilledMinor: 0 });
  });

  it("nets credit notes against the invoice they belong to, and the columns add up", async () => {
    const r = await run();
    const web = rowFor(r, "Website", "NOK")!;
    // Website: 1 200 + 2 000.00 + 40.00, of which 1 000.00 was credited on the invoice of two lines.
    expect(web.invoicedMinor).toBe(1200 + 200000 + 4000);
    expect(web.creditedMinor).toBe(100000);
    expect(web.netInvoicedMinor).toBe(web.invoicedMinor - web.creditedMinor);
    expect(web.netInvoicedInclMinor).toBe(Math.round(web.netInvoicedMinor * 1.25));
    // The payment of 1 000.00 is on that invoice; nothing else was paid.
    expect(web.paidMinor).toBe(100000);
    // Nothing paid is left to pay on the credited invoice: 2 500.00 with VAT, less 1 250.00 credited, less 1 000.00 paid.
    expect(web.outstandingMinor).toBe(web.netInvoicedInclMinor - web.paidMinor);
    expect(web.netInvoicedInclMinor - web.paidMinor).toBeGreaterThan(0);
    // The credit is not counted as another invoice, and does not touch other periods' figures.
    const noCredit = await reports.getPeriodReport(store, { from: day(today, -9), to: today, by: "assignment" });
    expect(rowFor(noCredit, "Website")!.creditedMinor).toBe(0);
    const row = await db().execute<Row>(sql`select status from commerce.work_invoices where id = ${creditedInvoice}::uuid`);
    expect(String(row[0].status)).toBe("sent");
  });

  it("adds up per client to what the assignments make", async () => {
    const byAssignment = await run();
    const byClient = await run({ by: "client" });
    expect(byClient.totals).toEqual(byAssignment.totals);
    expect(byClient.totalMinutes).toBe(byAssignment.totalMinutes);
    const acmeRows = byAssignment.rows.filter((r) => r.clientName === "Acme");
    expect(acmeRows.reduce((s, r) => s + r.paidMinor, 0)).toBe(rowFor(byClient, "Acme")!.paidMinor);
    expect(acmeRows.reduce((s, r) => s + r.outstandingMinor, 0)).toBe(rowFor(byClient, "Acme")!.outstandingMinor);
  });

  it("counts the hours of the days in the period, and values unbilled time at the rates without prepaid hours", async () => {
    const r = await run();
    // 90 (first day) + 20 (last day) + 60 not billable + 60 with 30 prepaid; the days before and after are out.
    const web = rowFor(r, "Website", "NOK")!;
    expect(web.minutes).toBe(90 + 20 + 60 + 60);
    expect(web.billableMinutes).toBe(90 + 20 + 60);
    expect(web.unbilledMinutes).toBe(90 + 20 + 30);
    // 140 min is 2.33 h at the client's rate of 1 000.00, rounded once as an invoice line would be.
    expect(web.unbilledMinor).toBe(233000);
    expect(r.totalMinutes).toBe(web.minutes + 120 + 60);
  });

  it("keeps currencies apart, each in the client's own", async () => {
    const r = await run({ by: "client" });
    expect(r.totals.map((t) => t.currency)).toEqual(["EUR", "NOK"]);
    const eur = r.totals.find((t) => t.currency === "EUR")!;
    // The euro invoice and the euro client's hour at 50.00, in euros, never added to the krone.
    expect(eur.invoicedMinor).toBe(20000);
    expect(eur.unbilledMinor).toBe(5000);
    expect(rowFor(r, "Beta")!.currency).toBe("EUR");
    expect(r.totals.find((t) => t.currency === "NOK")!.invoicedMinor).not.toBe(eur.invoicedMinor);
  });

  it("shows drafts apart and never as invoiced", async () => {
    const { invoiceId } = await makeReportDraft(f, acme, [{ assignmentId: website, priceMinor: 30000 }]);
    const r = await reports.getPeriodReport(store, { from: day(today, -1), to: today, by: "assignment" });
    const web = rowFor(r, "Website", "NOK")!;
    expect(web).toMatchObject({ draftMinor: 30000, invoicedMinor: 0, paidMinor: 0, outstandingMinor: 0 });
    const then = await run();
    expect(rowFor(then, "Website", "NOK")!.draftMinor).toBe(0);
    await db().execute(sql`delete from commerce.work_invoices where id = ${invoiceId}::uuid`);
  });

  it("does not see another store's rows, or its clients, whatever id is asked for", async () => {
    const r = await run();
    expect(r.rows.every((x) => x.clientId !== otherClient)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("999999");
    const asked = await run({ clientId: otherClient });
    expect(asked.rows).toEqual([]);
    expect(await reports.clientTimeReport(f.storeId, otherClient, { from: from(), to: to() })).toBeNull();
    // and the other store sees only its own
    const theirs = await reports.getPeriodReport(await asStore(other), { from: from(), to: to(), by: "client" });
    expect(theirs.rows.map((x) => x.clientId)).toEqual([otherClient]);
    expect(theirs.totals[0].invoicedMinor).toBe(999999);
  });

  it("limits a report to one client", async () => {
    const r = await run({ clientId: beta });
    expect(r.rows.map((x) => x.clientName)).toEqual(["Beta"]);
    expect(r.totals.map((t) => t.currency)).toEqual(["EUR"]);
  });

  it("is empty for a period with nothing in it, with zero totals in the store's own currency", async () => {
    const r = await reports.getPeriodReport(store, { from: day(today, -900), to: day(today, -800), by: "client" });
    expect(r.rows).toEqual([]);
    expect(r.totals).toEqual([expect.objectContaining({ currency: "NOK", minutes: 0, invoicedMinor: 0, paidMinor: 0, outstandingMinor: 0 })]);
    expect(r.totalMinutes).toBe(0);
  });

  it("refuses periods that cannot be reported", async () => {
    await expect(reports.getPeriodReport(store, { from: to(), to: from(), by: "client" })).rejects.toThrow(RangeError);
    await expect(reports.getPeriodReport(store, { from: "2026-13-01", to: "2026-13-02", by: "client" })).rejects.toThrow(RangeError);
    await expect(reports.getPeriodReport(store, { from: day(today, -3000), to: today, by: "client" })).rejects.toThrow(/five years/);
    await expect(run({ clientId: "not-a-uuid" })).rejects.toThrow(RangeError);
  });

  it("gives a client's time report a fixed fee once: in the period it was invoiced, not in every period shown", async () => {
    const inPeriod = (await reports.clientTimeReport(f.storeId, acme, { from: from(), to: to() }))!;
    const fee = inPeriod.assignments.find((a) => a.name === "Retainer")!;
    expect(fee).toMatchObject({ billingType: "fixed_fee", periodAmountMinor: 500000, periodMinutes: 120 });
    // Life showed the whole fee again in the next period, where there is only time.
    await logReportTime(f, retainer, day(today, -5), 30);
    const later = (await reports.clientTimeReport(f.storeId, acme, { from: day(today, -9), to: today }))!;
    expect(later.assignments.find((a) => a.name === "Retainer")).toMatchObject({ periodAmountMinor: 0, periodMinutes: 30 });
    expect(await reports.clientTimeReport(f.storeId, "not-a-uuid", { from: from(), to: to() })).toBeNull();
  });

  it("downloads as CSV, formula-safe, with the byte order mark and a safe file name", async () => {
    await db().execute(sql`update commerce.work_clients set name = '=HYPERLINK("http://evil","x")' where id = ${beta}::uuid`);
    const request = (query: string) => new Request(`https://example.com${workBase(f.slug)}/reports/csv${query}`);
    const ctx = { params: Promise.resolve({ store: f.slug }) };
    const response = await route.GET(request(`?period=custom&from=${from()}&to=${to()}&by=assignment`), ctx as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="work-report-[A-Za-z0-9._-]+\.csv"$/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    // The file starts with the byte order mark (reading it as text drops it).
    expect([...new Uint8Array(await response.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    expect(text.startsWith("Report,Work report")).toBe(true);
    expect(text).toContain(`From,${from()}`);
    expect(text).toContain("Retainer");
    expect(text).toContain("\"'=HYPERLINK(");
    expect(text).not.toMatch(/(^|,|\r\n)=HYPERLINK/);
    // the file is the report, as the page shows it
    const report = await run();
    expect(text).toBe(periodReportToCsv(report));
    // a client's time entries, and refusals
    const time = await route.GET(request(`?period=custom&from=${from()}&to=${to()}&client=${acme}&format=time`), ctx as never);
    expect(time.status).toBe(200);
    expect(await time.text()).toContain("Retainer");
    await expect(route.GET(request(`?format=time`), ctx as never)).rejects.toThrow();
    await expect(route.GET(request(`?client=${acme}&format=time`), { params: Promise.resolve({ store: other.slug }) } as never)).rejects.toThrow();
  });
});

describe("days in the store's time zone", () => {
  /** A draft with a line, made at an instant: the day it belongs to is the store's day. */
  async function draftAt(f: ReportFixture, clientId: string, instant: string): Promise<void> {
    const { invoiceId } = await makeReportDraft(f, clientId, [{ assignmentId: null, priceMinor: 10000 }]);
    await db().execute(sql`update commerce.work_invoices set created_at = ${instant}::timestamptz where id = ${invoiceId}::uuid`);
  }
  const drafts = async (f: ReportFixture, from: string, to: string) => {
    const r = await reports.getPeriodReport(await asStore(f), { from, to, by: "client" });
    return r.totals.find((t) => t.currency === "NOK")?.draftMinor ?? 0;
  };

  it("puts a draft on the day it was made where the store is, across the days clocks change", async () => {
    const oslo = await makeReportStore("dst", { timeZone: "Europe/Oslo" });
    const client = await makeReportClient(oslo, { name: "Acme" });
    // Clocks go forward on 2026-03-29 (a 23 hour day in Oslo) and back on 2026-10-25 (25 hours).
    for (const at of [
      "2026-03-28T22:59:00Z", // 23:59 on the 28th
      "2026-03-28T23:00:00Z", // 00:00 on the 29th
      "2026-03-29T21:59:00Z", // 23:59 on the 29th, 22 hours after the day began in UTC terms
      "2026-03-29T22:00:00Z", // 00:00 (CEST) on the 30th
      "2026-10-24T21:59:00Z", // 23:59 on the 24th
      "2026-10-24T22:00:00Z", // 00:00 on the 25th
      "2026-10-25T22:59:00Z", // 23:59 on the 25th, 24 hours and 59 minutes into the long day
      "2026-10-25T23:00:00Z", // 00:00 on the 26th
    ]) {
      await draftAt(oslo, client, at);
    }
    expect(await drafts(oslo, "2026-03-28", "2026-03-28")).toBe(10000);
    expect(await drafts(oslo, "2026-03-29", "2026-03-29")).toBe(20000);
    expect(await drafts(oslo, "2026-03-30", "2026-03-30")).toBe(10000);
    expect(await drafts(oslo, "2026-10-24", "2026-10-24")).toBe(10000);
    expect(await drafts(oslo, "2026-10-25", "2026-10-25")).toBe(20000);
    expect(await drafts(oslo, "2026-10-26", "2026-10-26")).toBe(10000);
    expect(await drafts(oslo, "2026-03-28", "2026-10-26")).toBe(80000);
  });

  it("uses each store's own zone: the same instant is another day elsewhere", async () => {
    const utc = await makeReportStore("utc", { timeZone: "UTC" });
    const sydney = await makeReportStore("syd", { timeZone: "Australia/Sydney" });
    for (const f of [utc, sydney]) {
      const client = await makeReportClient(f, { name: "Acme" });
      await draftAt(f, client, "2026-06-15T23:30:00Z");
    }
    expect(await drafts(utc, "2026-06-15", "2026-06-15")).toBe(10000);
    expect(await drafts(utc, "2026-06-16", "2026-06-16")).toBe(0);
    // 23:30 UTC is 09:30 the next morning in Sydney (UTC+10 in June)
    expect(await drafts(sydney, "2026-06-15", "2026-06-15")).toBe(0);
    expect(await drafts(sydney, "2026-06-16", "2026-06-16")).toBe(10000);
  });
});
