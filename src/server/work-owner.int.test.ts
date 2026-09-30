import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addCalendarDays } from "@/lib/work-dates";
import { ownerReportToCsv, parseOwnerReportParams, scopeStores, type WorkStore } from "@/lib/work-owner";
import { workBase } from "@/lib/work-paths";

import type { Account } from "./auth";
import {
  issueReportInvoice,
  logReportTime,
  makeReportAssignment,
  makeReportClient,
  makeReportDraft,
  makeReportStore,
  reportToday,
  type ReportFixture,
} from "./work-reports-test-support";

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const owner = await import("./work-owner");
const { getPeriodReport } = await import("./work-reports");

type Row = Record<string, unknown>;

/**
 * Work at the owner's level (D123) against a real database: one account that owns two stores in different
 * currencies and is only an admin in a third, a store it does not belong to at all, a store with Work off and a
 * membership that was disabled. Nothing is added across currencies, nothing of another account's stores appears,
 * staff see what the store pages show them, and only an owner switches Work on or off.
 */

afterAll(async () => {
  await closeDb();
});

const accountOf = (id: string): Account => ({ id, email: `${id}@example.com`, name: "Owner", platformAdmin: false });
const member = (f: ReportFixture, accountId: string, role: "owner" | "admin", disabled = false) =>
  db().execute(sql`
    insert into commerce.store_members (store_id, account_id, role, disabled_at)
    values (${f.storeId}::uuid, ${accountId}::uuid, ${role}, ${disabled ? sql`now()` : sql`null`})`);

let nok: ReportFixture; // owned by A, NOK
let eur: ReportFixture; // owned by A, EUR only
let staff: ReportFixture; // A is an admin, someone else owns it
let stranger: ReportFixture; // not A's at all
let off: ReportFixture; // A owns it, Work off
let gone: ReportFixture; // A's membership is disabled
let A: Account;
let today: string;
let using: WorkStore[];
let off_: WorkStore[];
const ids: Record<string, string> = {};

beforeAll(async () => {
  nok = await makeReportStore("nok");
  eur = await makeReportStore("eur");
  staff = await makeReportStore("staff");
  stranger = await makeReportStore("stranger");
  off = await makeReportStore("off", { work: false });
  gone = await makeReportStore("gone");
  A = accountOf(nok.accountId);
  await member(eur, A.id, "owner");
  await member(staff, A.id, "admin");
  await member(off, A.id, "owner");
  await member(gone, A.id, "owner", true);
  today = await reportToday(nok);
  const day = (n: number) => addCalendarDays(today, n);

  // NOK store: an overdue invoice, unbilled time, a draft, and a client whose name is a spreadsheet formula.
  const acme = await makeReportClient(nok, { name: "Acme", rate: 100000 });
  const acmeJob = await makeReportAssignment(nok, acme, { name: "Website" });
  ids.acme = acme;
  ids.acmeJob = acmeJob;
  await issueReportInvoice(nok, acme, day(-40), [{ assignmentId: acmeJob, priceMinor: 100000 }]);
  await logReportTime(nok, acmeJob, day(-2), 120);
  await makeReportDraft(nok, acme, [{ assignmentId: null, priceMinor: 5000 }]);
  const evil = await makeReportClient(nok, { name: '=HYPERLINK("http://evil")', rate: 50000 });
  const evilJob = await makeReportAssignment(nok, evil, { name: "Job" });
  await logReportTime(nok, evilJob, day(-1), 60);
  // Archived client
  const old = await makeReportClient(nok, { name: "Old client" });
  await db().execute(sql`update commerce.work_clients set archived_at = now() where id = ${old}::uuid`);

  // EUR store
  const beta = await makeReportClient(eur, { name: "Beta", currency: "EUR", rate: 5000 });
  const betaJob = await makeReportAssignment(eur, beta, { name: "Audit" });
  await issueReportInvoice(eur, beta, day(-10), [{ assignmentId: betaJob, priceMinor: 20000 }], { fxRate: "11.5" });
  await logReportTime(eur, betaJob, day(-3), 60);

  // Store A only staffs: the owner logs an hour, A half an hour.
  const gamma = await makeReportClient(staff, { name: "Gamma", rate: 100000 });
  const gammaJob = await makeReportAssignment(staff, gamma, { name: "Support" });
  await logReportTime(staff, gammaJob, day(-1), 60);
  await db().execute(sql`
    insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, billable, prepaid_minutes)
    values (${staff.storeId}::uuid, ${gammaJob}::uuid, ${A.id}::uuid, ${day(-1)}::date, 30, true, 0)`);

  // Somebody else's store, and one with Work off and one A left.
  for (const [f, name] of [
    [stranger, "Secret"],
    [off, "Hidden"],
    [gone, "Left"],
  ] as const) {
    const client = await makeReportClient(f, { name, rate: 100000 });
    const job = await makeReportAssignment(f, client, { name: `${name} job` });
    await issueReportInvoice(f, client, day(-40), [{ assignmentId: job, priceMinor: 900000 }]);
    await logReportTime(f, job, day(-1), 600);
  }

  const stores = await owner.workStoresFor(A);
  using = stores.using;
  off_ = stores.off;
});

const slugs = (stores: readonly { slug: string }[]) => stores.map((s) => s.slug).sort();

describe("the account's stores", () => {
  it("lists the stores it works in with Work on, with role and currency", async () => {
    expect(slugs(using)).toEqual(slugs([nok, eur, staff]));
    const roleOf = (f: ReportFixture) => using.find((s) => s.slug === f.slug)!.role;
    expect([roleOf(nok), roleOf(eur), roleOf(staff)]).toEqual(["owner", "owner", "admin"]);
    expect(using.every((s) => s.workOn && s.timeZone)).toBe(true);
  });

  it("offers Work to switch on only where the account is an owner", async () => {
    expect(slugs(off_)).toEqual([off.slug]);
  });

  it("never lists a store of another account, or one the membership of which is disabled", async () => {
    const all = [...using, ...off_].map((s) => s.slug);
    expect(all).not.toContain(stranger.slug);
    expect(all).not.toContain(gone.slug);
    // and the other account sees only its own
    const theirs = await owner.workStoresFor(accountOf(stranger.accountId));
    expect(slugs(theirs.using)).toEqual([stranger.slug]);
  });

  it("leaves out a closed store", async () => {
    await db().execute(sql`update commerce.stores set status = 'closed' where id = ${eur.storeId}::uuid`);
    try {
      expect(slugs((await owner.workStoresFor(A)).using)).toEqual(slugs([nok, staff]));
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${eur.storeId}::uuid`);
    }
  });

  it("scopes to a chosen store only among its own", () => {
    expect(scopeStores(using, stranger.slug)).toHaveLength(using.length);
    expect(scopeStores(using, eur.slug).map((s) => s.slug)).toEqual([eur.slug]);
  });
});

describe("the combined overview", () => {
  it("keeps NOK and EUR apart and adds only within a currency", async () => {
    const view = await owner.getOwnerOverview(using);
    const { combined } = view;
    expect(combined.currencies.map((f) => f.currency)).toEqual(["EUR", "NOK"]);
    const eurFigures = combined.currencies.find((f) => f.currency === "EUR")!;
    // 1 hour at 50.00 EUR, and an invoice of 200.00 EUR (with VAT for a Norwegian seller, more than that).
    expect(eurFigures.unbilled.amountMinor).toBe(5000);
    const nokFigures = combined.currencies.find((f) => f.currency === "NOK")!;
    // Acme 2h at 1 000 kr, the formula client 1h at 500 kr, and the staff store's 1h30 at 1 000 kr.
    expect(nokFigures.unbilled.amountMinor).toBe(200000 + 50000 + 150000);
    expect(nokFigures.unbilled.minutes).toBe(120 + 60 + 90);
    expect(nokFigures.drafts.count).toBe(1);
    expect(nokFigures.receivables.overdue.count).toBe(1);
    expect(eurFigures.receivables.overdue.count).toBe(0);
    expect(combined.counts.unbilledMinutes).toBe(nokFigures.unbilled.minutes + eurFigures.unbilled.minutes);
  });

  it("has each store's own figures and rows tagged with the store", async () => {
    const { combined } = await owner.getOwnerOverview(using);
    expect(combined.perStore.map((p) => p.store.slug).sort()).toEqual(slugs([nok, eur, staff]));
    const mine = combined.perStore.find((p) => p.store.slug === eur.slug)!;
    expect(mine.currencies.map((f) => f.currency)).toEqual(["EUR"]);
    expect(combined.overdueInvoices.map((i) => i.storeSlug)).toEqual([nok.slug]);
    expect(combined.attention.length).toBeGreaterThan(0);
    expect(combined.attention.every((a) => a.href.startsWith(workBase(a.storeSlug)))).toBe(true);
    expect(combined.clientCount).toBe(4);
  });

  it("never carries what belongs to a store the account is not in", async () => {
    const view = await owner.getOwnerOverview(using);
    const text = JSON.stringify(view);
    for (const secret of ["Secret", "Hidden", "Left", stranger.slug, off.slug, gone.slug]) expect(text).not.toContain(secret);
    expect(view.combined.currencies.every((f) => f.unbilled.amountMinor < 600000)).toBe(true);
  });

  it("is empty with no store, and says what a store still needs before its first invoice", async () => {
    expect((await owner.getOwnerOverview([])).combined.currencies).toEqual([]);
    await db().execute(sql`update commerce.work_settings set bank_account = null where store_id = ${staff.storeId}::uuid`);
    const view = await owner.getOwnerOverview(using);
    expect(view.missing.map((m) => m.store.slug)).toEqual([staff.slug]);
  });
});

describe("clients", () => {
  it("lists the clients of all the stores, each with its store, active ones first shown", async () => {
    const { clients, truncated } = await owner.listOwnerClients(using);
    expect(truncated).toBe(false);
    expect(clients.map((c) => c.name).sort()).toEqual(["=HYPERLINK(\"http://evil\")", "Acme", "Beta", "Gamma"]);
    expect(clients.find((c) => c.name === "Beta")).toMatchObject({ storeSlug: eur.slug, currency: "EUR", unbilledMinutes: 60 });
    expect(clients.find((c) => c.name === "Acme")).toMatchObject({ storeSlug: nok.slug, activeAssignments: 1, unbilledMinutes: 120 });
  });

  it("searches, and shows archived clients on request", async () => {
    expect((await owner.listOwnerClients(using, { search: "BET" })).clients.map((c) => c.name)).toEqual(["Beta"]);
    expect((await owner.listOwnerClients(using, { archived: "archived" })).clients.map((c) => c.name)).toEqual(["Old client"]);
    expect((await owner.listOwnerClients(using, { archived: "all" })).clients).toHaveLength(5);
  });

  it("narrows to one store, and reads nothing for none", async () => {
    const one = await owner.listOwnerClients(scopeStores(using, eur.slug));
    expect(one.clients.map((c) => c.name)).toEqual(["Beta"]);
    expect((await owner.listOwnerClients([])).clients).toEqual([]);
  });

  it("does not read a store it was not given, even when the search names its client", async () => {
    expect((await owner.listOwnerClients(using, { search: "secret" })).clients).toEqual([]);
    expect((await owner.listOwnerClients(using, { search: "hidden" })).clients).toEqual([]);
  });
});

describe("time", () => {
  it("shows an owner everyone's time and staff their own, by the membership", async () => {
    const list = await owner.listOwnerTime(A, using);
    const inStaff = list.entries.filter((e) => e.storeSlug === staff.slug);
    expect(inStaff.map((e) => [e.accountId, e.minutes])).toEqual([[A.id, 30]]);
    expect(list.entries.filter((e) => e.storeSlug === nok.slug)).toHaveLength(2);
    expect(list.entries.filter((e) => e.storeSlug === eur.slug)).toHaveLength(1);
    expect(list.totals.minutes).toBe(120 + 60 + 60 + 30);
    expect(list.entries.every((e) => e.storeName && e.storeId)).toBe(true);
  });

  it("does not let an address ask for someone else's time in a store the account only staffs", async () => {
    const [ownerOfStaff] = await db().execute<Row>(
      sql`select account_id from commerce.store_members where store_id = ${staff.storeId}::uuid and role = 'owner'`,
    );
    const list = await owner.listOwnerTime(A, using, { accountId: String(ownerOfStaff.account_id) });
    expect(list.entries.filter((e) => e.storeSlug === staff.slug)).toEqual([]);
  });

  it("filters by store, client, days and billing, and refuses what is not an id", async () => {
    const one = await owner.listOwnerTime(A, scopeStores(using, nok.slug), { clientId: ids.acme });
    expect(one.entries.map((e) => e.minutes)).toEqual([120]);
    expect((await owner.listOwnerTime(A, using, { clientId: "not-an-id" })).entries).toEqual([]);
    expect((await owner.listOwnerTime(A, using, { from: "nonsense" })).entries).toEqual([]);
    const recent = await owner.listOwnerTime(A, using, { from: addCalendarDays(today, -1) });
    expect(recent.entries.every((e) => e.workDate >= addCalendarDays(today, -1))).toBe(true);
    expect((await owner.listOwnerTime(A, [])).entries).toEqual([]);
  });

  it("pages and lists the people of the owned stores only", async () => {
    const page = await owner.listOwnerTime(A, using, { limit: 2, offset: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.totals.count).toBe(4);
    const people = await owner.listOwnerPeople(using);
    expect(people.map((p) => p.id)).toContain(A.id);
    expect(people.map((p) => p.id)).not.toContain(stranger.accountId);
    expect(await owner.listOwnerPeople(using.filter((s) => s.role !== "owner"))).toEqual([]);
  });
});

describe("invoices", () => {
  it("lists the invoices of the stores with totals per currency, never added across currencies", async () => {
    const list = await owner.listOwnerInvoices(using);
    expect(list.total).toBe(3);
    expect(list.totals.map((t) => t.currency)).toEqual(["EUR", "NOK"]);
    const eurTotal = list.totals.find((t) => t.currency === "EUR")!;
    const nokTotal = list.totals.find((t) => t.currency === "NOK")!;
    expect(eurTotal.count).toBe(1);
    expect(nokTotal.count).toBe(2);
    const sumOf = (currency: string) => list.rows.filter((r) => r.currency === currency).reduce((s, r) => s + r.totalMinor, 0);
    expect(eurTotal.totalMinor).toBe(sumOf("EUR"));
    expect(nokTotal.totalMinor).toBe(sumOf("NOK"));
    expect(list.rows.map((r) => r.storeSlug).sort()).toEqual([eur.slug, nok.slug, nok.slug].sort());
    expect(list.counts).toMatchObject({ draft: 1, sent: 2, overdue: 1 });
  });

  it("filters by status, overdue, dates and search, and by store", async () => {
    expect((await owner.listOwnerInvoices(using, { status: "draft" })).rows.map((r) => r.documentNumber)).toEqual([null]);
    const overdue = await owner.listOwnerInvoices(using, { overdue: true });
    expect(overdue.rows).toHaveLength(1);
    expect(overdue.rows[0]).toMatchObject({ storeSlug: nok.slug, overdue: true, clientName: "Acme" });
    expect(overdue.rows[0].daysOverdue).toBeGreaterThan(0);
    expect((await owner.listOwnerInvoices(using, { search: "beta" })).rows.map((r) => r.storeSlug)).toEqual([eur.slug]);
    expect((await owner.listOwnerInvoices(using, { issuedFrom: addCalendarDays(today, -20) })).rows.map((r) => r.storeSlug)).toEqual([eur.slug]);
    expect((await owner.listOwnerInvoices(scopeStores(using, eur.slug))).rows).toHaveLength(1);
    expect((await owner.listOwnerInvoices(using, { clientId: "nonsense" })).rows).toEqual([]);
  });

  it("pages, and never shows the invoices of stores it was not given", async () => {
    const first = await owner.listOwnerInvoices(using, { pageSize: 2 });
    const second = await owner.listOwnerInvoices(using, { pageSize: 2, page: 2 });
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    expect(first.total).toBe(3);
    const text = JSON.stringify(await owner.listOwnerInvoices(using));
    expect(text).not.toContain("Secret");
    expect((await owner.listOwnerInvoices([])).rows).toEqual([]);
  });
});

describe("the combined report", () => {
  const from = () => addCalendarDays(today, -90);

  it("merges every store's own report: rows tagged, totals per currency", async () => {
    const { byStore } = parseOwnerReportParams({ period: "custom", from: from(), to: today }, using);
    const merged = await owner.getOwnerReport(using, byStore);
    const own = await Promise.all(
      using.map((s) =>
        getPeriodReport(
          { id: s.id, timeZone: s.timeZone, markets: [] },
          { from: from(), to: today, by: "client", clientId: null },
        ),
      ),
    );
    expect(merged.rows).toHaveLength(own.reduce((n, r) => n + r.rows.length, 0));
    expect(merged.totals.map((t) => t.currency)).toEqual(["EUR", "NOK"]);
    const nokRows = merged.rows.filter((r) => r.currency === "NOK");
    const nokTotal = merged.totals.find((t) => t.currency === "NOK")!;
    expect(nokTotal.minutes).toBe(nokRows.reduce((s, r) => s + r.minutes, 0));
    expect(nokTotal.netInvoicedMinor).toBe(nokRows.reduce((s, r) => s + r.netInvoicedMinor, 0));
    expect(merged.rows.find((r) => r.clientName === "Beta")).toMatchObject({ storeSlug: eur.slug, currency: "EUR" });
    // The staff store's report counts the store's whole time, as its own report does.
    expect(merged.totalMinutes).toBe(own.reduce((n, r) => n + r.totalMinutes, 0));
    expect(merged.periodsDiffer).toBe(false);
    expect(JSON.stringify(merged)).not.toContain("Secret");
  });

  it("is one store's when narrowed", async () => {
    const scoped = scopeStores(using, eur.slug);
    const { byStore } = parseOwnerReportParams({ period: "custom", from: from(), to: today }, scoped);
    const merged = await owner.getOwnerReport(scoped, byStore);
    expect(merged.rows.map((r) => r.storeSlug)).toEqual([eur.slug]);
    expect(merged.totals.map((t) => t.currency)).toEqual(["EUR"]);
  });

  it("gives zero totals in the store's own currency for an empty period", async () => {
    const scoped = scopeStores(using, nok.slug);
    const { byStore } = parseOwnerReportParams({ period: "custom", from: "2020-01-01", to: "2020-01-31" }, scoped);
    const merged = await owner.getOwnerReport(scoped, byStore);
    expect(merged.rows).toEqual([]);
    expect(merged.totals).toHaveLength(1);
    expect(merged.totals[0]).toMatchObject({ minutes: 0, netInvoicedMinor: 0 });
  });

  it("downloads as a CSV with a store column, a total per currency and no live formulas", async () => {
    const { byStore } = parseOwnerReportParams({ period: "custom", from: from(), to: today }, using);
    const csv = ownerReportToCsv(await owner.getOwnerReport(using, byStore));
    const lines = csv.split("\r\n");
    expect(lines).toContain("Store,Client,Assignment,Billing type,Currency,Hours,Billable hours,Unbilled hours,Unbilled value excl. VAT,Not yet invoiced (drafts) excl. VAT,Invoiced excl. VAT,Credited excl. VAT,Net invoiced excl. VAT,Net invoiced incl. VAT,Paid incl. VAT,Outstanding incl. VAT");
    expect(csv).toContain("Total,,,,EUR");
    expect(csv).toContain("Total,,,,NOK");
    const evilLine = lines.find((l) => l.includes("HYPERLINK"))!;
    expect(evilLine).not.toMatch(/(^|,)"?=/);
  });
});

describe("the settings", () => {
  it("lists what each store holds and what is missing before an invoice", async () => {
    const rows = await owner.getOwnerSettings([...using, ...off_]);
    expect(rows).toHaveLength(4);
    const own = rows.find((r) => r.store.slug === nok.slug)!;
    expect(own.issuedInvoices).toBe(1);
    expect(own.problems).toEqual([]);
    expect(rows.find((r) => r.store.slug === staff.slug)!.problems!.length).toBeGreaterThan(0);
    const offRow = rows.find((r) => r.store.slug === off.slug)!;
    expect(offRow.problems).toBeNull();
    expect(offRow.issuedInvoices).toBe(0);
  });

  const modulesOf = async (f: ReportFixture) =>
    (await db().execute<Row>(sql`select modules from commerce.stores where id = ${f.storeId}::uuid`))[0].modules as string[];
  const audited = async (f: ReportFixture, action: string) =>
    db().execute(sql`select 1 from commerce.audit_log where store_id = ${f.storeId}::uuid and action = ${action}`);

  it("lets an owner switch Work on and off, audited, and keeps the data", async () => {
    expect((await modulesOf(off)).includes("work")).toBe(false);
    expect(await owner.switchWorkModule(A, off.slug, true)).toEqual({ ok: true, slug: off.slug, enabled: true });
    expect(await modulesOf(off)).toContain("work");
    expect((await audited(off, "work.enabled")).length).toBe(1);
    expect(slugs((await owner.workStoresFor(A)).using)).toContain(off.slug);
    expect(await owner.switchWorkModule(A, off.slug, false)).toMatchObject({ ok: true, enabled: false });
    expect(await modulesOf(off)).not.toContain("work");
    expect((await audited(off, "work.disabled")).length).toBe(1);
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.work_invoices where store_id = ${off.storeId}::uuid`);
    expect(Number(kept.n)).toBe(1);
    expect(slugs((await owner.workStoresFor(A)).off)).toContain(off.slug);
  });

  it("refuses an admin", async () => {
    const before = await modulesOf(staff);
    const result = await owner.switchWorkModule(A, staff.slug, false);
    expect(result).toEqual({ ok: false, problems: ["Only an owner can switch Work on or off."] });
    expect(await modulesOf(staff)).toEqual(before);
  });

  it("refuses a store the account is not in, and one it left, in the words for a store that does not exist", async () => {
    for (const f of [stranger, gone]) {
      const before = await modulesOf(f);
      expect(await owner.switchWorkModule(A, f.slug, false)).toEqual({ ok: false, problems: ["That store was not found."] });
      expect(await modulesOf(f)).toEqual(before);
    }
    expect(await owner.switchWorkModule(A, "no-such-store-anywhere", true)).toEqual({
      ok: false,
      problems: ["That store was not found."],
    });
  });
});
