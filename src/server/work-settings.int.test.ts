import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { todayIn, addCalendarDays } from "@/lib/work-dates";

import type { Membership } from "./auth";
import { getWorkOverview } from "./work-overview";
import { workErrorCode, workErrorMessage } from "./work-errors";
import {
  getWorkSeries,
  getWorkSettings,
  saveWorkSettings,
  setWorkModule,
  setWorkSeries,
  workReadiness,
} from "./work-settings";

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const slug = `work-${run}`;
const TZ = "Europe/Oslo";
let storeId: string;
let accountId: string;
let owner: Membership;
let admin: Membership;

const modules = async (): Promise<string[]> => {
  const [row] = await db().execute<Row>(sql`select modules from commerce.stores where id = ${storeId}::uuid`);
  return row.modules as string[];
};
const audited = async (action: string): Promise<Row[]> =>
  db().execute<Row>(
    sql`select details from commerce.audit_log where store_id = ${storeId}::uuid and action = ${action} order by created_at`,
  );

const complete = {
  vatRegistered: true,
  vatNumber: "NO923456789MVA",
  defaultPaymentDays: 14,
  bankAccount: "NO9386011117947",
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Konsulent', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(
    sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`,
  );
  accountId = String(account.id);
  const store_ = { id: storeId, slug, name: "Konsulent", timeZone: TZ };
  owner = { account: { id: accountId }, store: store_, role: "owner" } as unknown as Membership;
  admin = { account: { id: accountId }, store: store_, role: "admin" } as unknown as Membership;
});

afterAll(async () => {
  await closeDb();
});

describe("switching Work on and off", () => {
  it("adds and takes away the module, once each however often, and writes the audit log", async () => {
    expect(await modules()).not.toContain("work");
    await setWorkModule(owner, true);
    await setWorkModule(owner, true);
    expect((await modules()).filter((m) => m === "work")).toHaveLength(1);
    await setWorkModule(owner, false);
    expect(await modules()).not.toContain("work");
    await setWorkModule(owner, true);
    expect((await audited("work.enabled")).length).toBe(3);
    expect((await audited("work.disabled")).length).toBe(1);
  });

  it("keeps the store's other modules", async () => {
    await db().execute(sql`update commerce.stores set modules = array['bookings', 'work'] where id = ${storeId}::uuid`);
    await setWorkModule(owner, false);
    expect(await modules()).toEqual(["bookings"]);
    await setWorkModule(owner, true);
    expect((await modules()).sort()).toEqual(["bookings", "work"]);
  });
});

describe("Work settings", () => {
  it("are the defaults until saved: registered for VAT, 14 days, warnings on", async () => {
    const settings = await getWorkSettings(storeId);
    expect(settings).toMatchObject({
      vatRegistered: true,
      vatNumber: null,
      defaultPaymentDays: 14,
      bankAccount: null,
      estimateAlertMinutes: 10,
      estimateAlertPopup: true,
      estimateAlertSound: false,
      showTimeNotesToClients: false,
      updatedAt: null,
    });
  });

  it("are checked with the schema the browser uses, and a refusal changes nothing", async () => {
    const result = await saveWorkSettings(owner, {
      ...complete,
      defaultPaymentDays: 400,
      bankAccount: "NO9386011117948",
    });
    expect(result).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        "Payment terms are 1 to 90 days.",
        "The IBAN is not right. Check it against your bank's.",
      ]),
    });
    expect((await getWorkSettings(storeId)).updatedAt).toBeNull();
    expect(await audited("work.settings.saved")).toEqual([]);
  });

  it("are refused to an admin who is not an owner, at the function", async () => {
    expect(await saveWorkSettings(admin, complete)).toEqual({
      ok: false,
      problems: ["Only an owner can change Work's settings."],
    });
    expect((await getWorkSettings(storeId)).updatedAt).toBeNull();
  });

  it("are saved, read back and logged without their values", async () => {
    const saved = await saveWorkSettings(owner, {
      ...complete,
      defaultCurrency: "eur",
      bic: "dnbanokk",
      paymentNote: "Pay with KID 1234",
      invoiceFooter: "Konsulent AS",
      latePaymentNote: "",
      estimateAlertMinutes: 20,
      estimateAlertPopup: false,
      estimateAlertSound: true,
      showTimeNotesToClients: true,
    });
    expect(saved).toEqual({ ok: true });
    expect(await getWorkSettings(storeId)).toMatchObject({
      vatRegistered: true,
      vatNumber: "NO923456789MVA",
      defaultPaymentDays: 14,
      defaultCurrency: "EUR",
      bankAccount: "NO9386011117947",
      bic: "DNBANOKK",
      paymentNote: "Pay with KID 1234",
      invoiceFooter: "Konsulent AS",
      latePaymentNote: null,
      estimateAlertMinutes: 20,
      estimateAlertPopup: false,
      estimateAlertSound: true,
      showTimeNotesToClients: true,
    });
    const log = await audited("work.settings.saved");
    expect(log).toHaveLength(1);
    const changed = (log[0].details as { changed: string[] }).changed;
    expect(changed).toEqual(expect.arrayContaining(["vatNumber", "bankAccount", "defaultCurrency"]));
    expect(JSON.stringify(log[0].details)).not.toContain("NO9386011117947");
  });

  it("are saved again in place, and a store that is not registered keeps no VAT number", async () => {
    expect(await saveWorkSettings(owner, { ...complete, vatRegistered: false, estimateAlertMinutes: null })).toEqual({
      ok: true,
    });
    const settings = await getWorkSettings(storeId);
    expect(settings).toMatchObject({
      vatRegistered: false,
      vatNumber: null,
      estimateAlertMinutes: null,
      estimateAlertPopup: true,
      defaultCurrency: null,
    });
    const [count] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.work_settings where store_id = ${storeId}::uuid`,
    );
    expect(count.n).toBe(1);
  });
});

describe("what is missing before an invoice", () => {
  it("lists what a new store lacks, from what is saved", async () => {
    await db().execute(sql`delete from commerce.work_settings where store_id = ${storeId}::uuid`);
    const { ready, problems } = await workReadiness(storeId);
    expect(ready).toBe(false);
    expect(problems.map((p) => p.code)).toEqual(
      expect.arrayContaining([
        "seller_legal_name",
        "seller_organisation_number",
        "seller_address",
        "seller_vat_number",
        "seller_bank_account",
      ]),
    );
  });

  it("agrees with the database's own list for an invoice", async () => {
    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, country, billing_address, currency)
      values (${storeId}::uuid, 'Kunde', 'NO', ${JSON.stringify({ line1: "Kundeveien 2", postalCode: "0250", city: "Oslo" })}::jsonb, 'NOK')
      returning id
    `);
    const [draft] = await db().execute<Row>(sql`
      insert into commerce.work_invoices (store_id, client_id, currency) values (${storeId}::uuid, ${String(client.id)}::uuid, 'NOK') returning id
    `);
    await db().execute(sql`
      insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor)
      values (${storeId}::uuid, ${String(draft.id)}::uuid, 0, 'Consulting', 100, 100000)
    `);
    const [{ problems: sellerCodes }] = await db().execute<Row>(sql`
      select commerce.work_invoice_problems(${storeId}::uuid, ${String(draft.id)}::uuid) as problems
    `);
    const database = (sellerCodes as string[]).filter((c) => c.startsWith("seller_")).sort();
    const ours = (await workReadiness(storeId)).problems.filter((p) => p.severity === "error").map((p) => p.code);
    // Same seller problems, under the names each side uses (`seller_name` is `seller_legal_name`).
    expect(ours.map((c) => c.replace("legal_", "")).sort()).toEqual(database);
  });

  it("is ready once the business details, VAT and bank account are in", async () => {
    await db().execute(sql`
      update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
        postal_address = 'Storgata 1, 0155 Oslo', country = 'NO' where id = ${storeId}::uuid
    `);
    expect(await saveWorkSettings(owner, complete)).toEqual({ ok: true });
    expect(await workReadiness(storeId)).toEqual({ ready: true, problems: [] });
    // Not registered: no VAT number is needed.
    expect(await saveWorkSettings(owner, { ...complete, vatRegistered: false })).toEqual({ ok: true });
    expect((await workReadiness(storeId)).ready).toBe(true);
    // A wrong-looking VAT number is a warning, not a stop.
    expect(await saveWorkSettings(owner, { ...complete, vatNumber: "12" })).toEqual({ ok: true });
    const warned = await workReadiness(storeId);
    expect(warned.ready).toBe(true);
    expect(warned.problems.map((p) => p.code)).toEqual(["seller_vat_number_format"]);
    expect(await saveWorkSettings(owner, complete)).toEqual({ ok: true });
  });
});

describe("numbering", () => {
  it("starts every store with W- and WCN- at 1", async () => {
    const series = await getWorkSeries(storeId);
    expect(series.work_invoice).toMatchObject({
      prefix: "W-",
      nextNumber: 1,
      issued: 0,
      lastDocumentNumber: null,
      nextDocumentNumber: "W-1",
    });
    expect(series.work_credit_note).toMatchObject({
      prefix: "WCN-",
      nextNumber: 1,
      issued: 0,
      nextDocumentNumber: "WCN-1",
    });
  });

  it("can be set either way before the first document, so a mistyped start is fixed", async () => {
    expect(await setWorkSeries(owner, { series: "work_invoice", prefix: "2026-", nextNumber: 500 })).toEqual({
      ok: true,
    });
    expect((await getWorkSeries(storeId)).work_invoice).toMatchObject({
      prefix: "2026-",
      nextNumber: 500,
      nextDocumentNumber: "2026-500",
    });
    expect(await setWorkSeries(owner, { series: "work_invoice", prefix: "W-", nextNumber: 1 })).toEqual({ ok: true });
    expect((await getWorkSeries(storeId)).work_invoice.nextDocumentNumber).toBe("W-1");
    const log = await audited("work.series.changed");
    expect(log.map((l) => l.details)).toEqual([
      { series: "work_invoice", from: "W-1", to: "2026-500" },
      { series: "work_invoice", from: "2026-500", to: "W-1" },
    ]);
  });

  it("are checked, and an admin who is not an owner is refused", async () => {
    expect(await setWorkSeries(owner, { series: "work_invoice", prefix: "a b", nextNumber: 1 })).toEqual({
      ok: false,
      problems: ["A prefix is up to 12 letters, digits and - _ / . characters."],
    });
    expect(await setWorkSeries(owner, { series: "work_invoice", prefix: "ABCDEFGHIJK", nextNumber: 1 })).toEqual({
      ok: false,
      problems: ["A prefix is up to 10 letters, digits or . _ / - characters."],
    });
    expect(await setWorkSeries(owner, { series: "order", prefix: "", nextNumber: 1 })).toMatchObject({ ok: false });
    expect(await setWorkSeries(owner, { series: "work_invoice", prefix: "W-", nextNumber: 0 })).toEqual({
      ok: false,
      problems: ["Give the next number as a whole number from 1."],
    });
    expect(await setWorkSeries(admin, { series: "work_invoice", prefix: "X-", nextNumber: 9 })).toEqual({
      ok: false,
      problems: ["Only an owner can change Work's settings."],
    });
    expect((await getWorkSeries(storeId)).work_invoice.nextDocumentNumber).toBe("W-1");
  });

  it("are fixed once an invoice is issued, and the database says so too", async () => {
    const [draft] = await db().execute<Row>(
      sql`select id from commerce.work_invoices where store_id = ${storeId}::uuid and status = 'draft' limit 1`,
    );
    await setWorkSeries(owner, { series: "work_invoice", prefix: "W-", nextNumber: 7 });
    await db().execute(
      sql`select * from commerce.issue_work_invoice(${storeId}::uuid, ${String(draft.id)}::uuid, ${accountId}::uuid)`,
    );
    const series = (await getWorkSeries(storeId)).work_invoice;
    expect(series).toMatchObject({ issued: 1, lastDocumentNumber: "W-7", nextNumber: 8, nextDocumentNumber: "W-8" });
    // Our own check first, in plain words.
    const refused = await setWorkSeries(owner, { series: "work_invoice", prefix: "W-", nextNumber: 1 });
    expect(refused).toEqual({
      ok: false,
      problems: [
        "A document has already been issued in this numbering (the last is W-7), so it can no longer be changed.",
      ],
    });
    expect((await setWorkSeries(owner, { series: "work_invoice", prefix: "X-", nextNumber: 99 })).ok).toBe(false);
    expect((await getWorkSeries(storeId)).work_invoice).toMatchObject({ prefix: "W-", nextNumber: 8 });
    // And the database's, which does not trust the caller.
    const raw = await db()
      .execute(sql`select commerce.work_set_series(${storeId}::uuid, 'work_invoice', 'W-', 1)`)
      .catch((error: unknown) => error);
    expect(workErrorCode(raw)).toBe("work_series.lower");
    expect(workErrorMessage(raw)).toBe("Numbers already issued are not reused. The next number can only be raised.");
    // The credit notes' numbering is its own, still free to set.
    expect(await setWorkSeries(owner, { series: "work_credit_note", prefix: "CN-", nextNumber: 20 })).toEqual({
      ok: true,
    });
    expect((await getWorkSeries(storeId)).work_credit_note.nextDocumentNumber).toBe("CN-20");
  });
});

describe("the overview's rows", () => {
  it("count what is unbilled, drafted, owed and running, per currency, for this store only", async () => {
    const today = todayIn(TZ);
    const [client] = await db().execute<Row>(
      sql`select id from commerce.work_clients where store_id = ${storeId}::uuid limit 1`,
    );
    const clientId = String(client.id);
    const [eur] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, country, billing_address, currency, default_hourly_rate_minor)
      values (${storeId}::uuid, 'Euro AB', 'SE', ${JSON.stringify({ line1: "Gatan 1", postalCode: "11122", city: "Stockholm" })}::jsonb, 'EUR', 9000)
      returning id
    `);
    const [assignment] = await db().execute<Row>(sql`
      insert into commerce.work_assignments (store_id, client_id, name, hourly_rate_minor)
      values (${storeId}::uuid, ${clientId}::uuid, 'Rådgivning', 120000) returning id
    `);
    const [euroAssignment] = await db().execute<Row>(sql`
      insert into commerce.work_assignments (store_id, client_id, name) values (${storeId}::uuid, ${String(eur.id)}::uuid, 'Workshop') returning id
    `);
    for (const [assignmentId, minutes, billable] of [
      [String(assignment.id), 90, true],
      [String(assignment.id), 30, false],
      [String(euroAssignment.id), 60, true],
    ] as const) {
      await db().execute(sql`
        insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, billable)
        values (${storeId}::uuid, ${assignmentId}::uuid, ${accountId}::uuid, ${addCalendarDays(today, -2)}::date, ${minutes}, ${billable})
      `);
    }
    // A timer that has been running for 95 minutes.
    await db().execute(sql`
      insert into commerce.work_timers (store_id, account_id, assignment_id, started_at)
      values (${storeId}::uuid, ${accountId}::uuid, ${String(assignment.id)}::uuid, now() - interval '95 minutes')
    `);
    const [draft] = await db().execute<Row>(sql`
      insert into commerce.work_invoices (store_id, client_id, currency) values (${storeId}::uuid, ${String(eur.id)}::uuid, 'EUR') returning id
    `);
    await db().execute(sql`
      insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor)
      values (${storeId}::uuid, ${String(draft.id)}::uuid, 0, 'Workshop', 100, 50000)
    `);
    // A second store's work must never show here.
    const otherSlug = `${slug}-other`;
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name) values (${`${otherSlug}@example.com`}, 'T', 'T') returning id
    `);
    const [other] = await db().execute<Row>(
      sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${otherSlug}, 'Other', null) as id`,
    );
    await db().execute(sql`
      insert into commerce.work_clients (store_id, name, country, billing_address, currency)
      values (${String(other.id)}::uuid, 'Not ours', 'NO', '{}'::jsonb, 'NOK')
    `);

    const view = await getWorkOverview({ id: storeId, slug, timeZone: TZ });
    expect(view.clientCount).toBe(2);
    const nok = view.overview.currencies.find((c) => c.currency === "NOK")!;
    const euro = view.overview.currencies.find((c) => c.currency === "EUR")!;
    // 90 billable minutes at 1,200.00; the 30 unbillable ones are not counted.
    expect(nok.unbilled).toMatchObject({ minutes: 90, amountMinor: 180_000 });
    // The euro client's assignment takes the client's rate: 1 h at 90.00.
    expect(euro.unbilled).toMatchObject({ minutes: 60, amountMinor: 9000 });
    expect(euro.drafts).toEqual({ count: 1, minor: expect.any(Number) });
    // The issued W-7 is due 14 days after today, so it is owed but not overdue.
    expect(nok.receivables.outstandingMinor).toBe(125_000);
    expect(nok.receivables.overdue.count).toBe(0);
    expect(view.overview.runningTimers).toHaveLength(1);
    expect(view.overview.runningTimers[0]).toMatchObject({ accountId, elapsedMinutes: expect.any(Number) });
    expect(view.overview.runningTimers[0].elapsedMinutes).toBeGreaterThanOrEqual(95);
    expect(view.assignmentNames[String(assignment.id)]).toEqual({ name: "Rådgivning", clientName: "Kunde" });
    expect(Object.values(view.clientNames).sort()).toEqual(["Euro AB", "Kunde"]);
    expect(view.overview.unbilledByClient.map((c) => c.clientId)).not.toContain(String(other.id));
    // Attention items point to pages that exist.
    expect(view.overview.attention.every((a) => !a.href.endsWith("/invoices/new"))).toBe(true);
  });

  it("puts an invoice past its due date among the overdue, oldest first, with its number", async () => {
    const today = todayIn(TZ);
    const [client] = await db().execute<Row>(
      sql`select id from commerce.work_clients where store_id = ${storeId}::uuid and name = 'Kunde'`,
    );
    const [draft] = await db().execute<Row>(sql`
      insert into commerce.work_invoices (store_id, client_id, currency) values (${storeId}::uuid, ${String(client.id)}::uuid, 'NOK') returning id
    `);
    await db().execute(sql`
      insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor)
      values (${storeId}::uuid, ${String(draft.id)}::uuid, 0, 'Old work', 200, 50000)
    `);
    const issuedOn = addCalendarDays(today, -40);
    const [issued] = await db().execute<Row>(sql`
      select * from commerce.issue_work_invoice(${storeId}::uuid, ${String(draft.id)}::uuid, ${accountId}::uuid, ${issuedOn}::date, null::bigint, null::numeric, true)
    `);
    expect(issued.due_on).toBe(addCalendarDays(issuedOn, 14));

    const view = await getWorkOverview({ id: storeId, slug, timeZone: TZ });
    const nok = view.overview.currencies.find((c) => c.currency === "NOK")!;
    expect(nok.receivables.overdue).toMatchObject({
      count: 1,
      minor: 125_000,
      oldestDueOn: addCalendarDays(issuedOn, 14),
    });
    expect(nok.receivables.outstandingMinor).toBe(250_000);
    expect(view.overview.overdueInvoices).toEqual([
      expect.objectContaining({ invoiceId: String(draft.id), daysOverdue: 26, outstandingMinor: 125_000 }),
    ]);
    expect(view.invoiceNumbers[String(draft.id)]).toBe(String(issued.document_number));
    expect(view.overview.attention[0]).toMatchObject({
      text: "1 invoice is overdue, the oldest by 26 days.",
      href: `/admin/${slug}/work/invoices?show=overdue`,
    });

    // A payment that covers it takes it out of the overdue.
    await db().execute(sql`
      insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method)
      values (${storeId}::uuid, ${String(draft.id)}::uuid, 125000, 'NOK', ${today}::date, 'bank')
    `);
    const after = await getWorkOverview({ id: storeId, slug, timeZone: TZ });
    expect(after.overview.overdueInvoices).toEqual([]);
    const paid = after.overview.currencies.find((c) => c.currency === "NOK")!;
    expect(paid.paidThisMonth).toMatchObject({ count: 1, minor: 125_000 });
  });
});
