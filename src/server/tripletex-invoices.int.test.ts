import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { connectTripletex, startTripletex } = await import("./tripletex");
const { syncDueTripletex } = await import("./tripletex-sync");
const { previewTripletexInvoices, importTripletexInvoices } = await import("./tripletex-invoices");
const { fakeTripletex } = await import("./tripletex-test-support");

import type { Membership } from "./auth";
import type { FakeTripletex } from "./tripletex-test-support";

type Row = Record<string, unknown>;

/**
 * Invoices brought in from Tripletex into Work (D494) against a real database and the Tripletex in memory: new invoices with their lines,
 * clients and payments; one of Life's unnumbered invoices known as Tripletex's and given its number and payment; a wholly credited one
 * void; nothing twice, nothing numbered from the store's series, and nothing sent back to Tripletex by the sync.
 */

const run = Date.now().toString(36);
let counter = 0;
const BASE = 300_000 + Math.floor(Math.random() * 600_000) * 10;
const token = (label: string) => ["test-tlxr", `eyJhbGciOiJIUzI1NiJ9.${label}.signature0123456789`].join("_");

afterAll(async () => {
  await closeDb();
});

async function workStore(): Promise<{ storeId: string; accountId: string; org: string; member: Membership }> {
  counter += 1;
  const name = `txi-${run}-${counter}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(20_000_000 + counter).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  const accountId = String(owner.id);
  return { storeId, accountId, org, member: { store: { id: storeId, slug: name }, account: { id: accountId } } as unknown as Membership };
}

async function connected(storeId: string, accountId: string, org: string, companyId: number): Promise<FakeTripletex> {
  const tx = fakeTripletex({ companyId, organizationNumber: org });
  tx.apiTokens.add(token(String(companyId)));
  const result = await connectTripletex(accountId, storeId, token(String(companyId)), { fetch: tx.fetch });
  if (!result.ok) throw new Error(result.problem);
  const started = await startTripletex(accountId, storeId);
  if (!started.ok) throw new Error(started.problem);
  return tx;
}

/** A client as Life's import left it: a name, no organisation number, no address. */
async function lifeClient(storeId: string, name: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, country, currency, locale) values (${storeId}::uuid, ${name}, 'NO', 'NOK', 'nb-NO') returning id`);
  return String(row.id);
}

/** One of Life's invoices without a number of its own, sent and unpaid, as the Life import makes it. */
async function lifeInvoice(storeId: string, clientId: string, issuedOn: string, totalMinor: number): Promise<string> {
  const excl = totalMinor / 1.25;
  return db().transaction(async (t) => {
    await t.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
    const [row] = await t.execute<Row>(sql`
      insert into commerce.work_invoices (store_id, client_id, status, document_number, imported, issued_on, due_on, sent_at, currency, locale, payment_days,
        subtotal_minor, vat_minor, total_minor, seller, buyer)
      values (${storeId}::uuid, ${clientId}::uuid, 'sent', 'Imported', true, ${issuedOn}::date, (${issuedOn}::date + 14), now(), 'NOK', 'nb-NO', 14,
        ${excl}, ${totalMinor - excl}, ${totalMinor}, '{}'::jsonb, '{}'::jsonb)
      returning id`);
    await t.execute(sql`
      insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor, vat_category, vat_rate, excl_minor, vat_minor, incl_minor)
      values (${storeId}::uuid, ${String(row.id)}::uuid, 0, 'Line item', 100, ${excl}, 'standard', 0.25, ${excl}, ${totalMinor - excl}, ${totalMinor})`);
    return String(row.id);
  });
}

const customer = (id: number, name: string, org: string | null) => ({
  id,
  name,
  organizationNumber: org,
  invoiceEmail: `faktura@${name.split(" ")[0].toLowerCase()}.example`,
  isPrivateIndividual: false,
  language: "NO",
  invoicesDueIn: 14,
  invoicesDueInType: "DAYS",
  currency: { code: "NOK" },
  postalAddress: { addressLine1: "Fjordgata 2", postalCode: "7010", city: "Trondheim", country: { isoAlpha2Code: "NO" } },
});

const hours = (description: string, count: number, price: number) => ({
  description,
  count,
  unitPriceExcludingVatCurrency: price,
  discount: 0,
  amountExcludingVatCurrency: count * price,
  amountIncludingVatCurrency: count * price * 1.25,
  sortIndex: 0,
  vatType: { number: "3", percentage: 25 },
  product: { name: "Timer", productUnit: { nameShort: "t", commonCode: "HUR" } },
});

/** Tripletex's invoices: Life's one (paid there), two new ones for a new customer (one credited in full), and one before the first day. */
function theirInvoices(): Record<string, unknown>[] {
  const acme = customer(71, "Acme Norge AS", "987654321");
  const nordlys = customer(72, "Nordlys Design AS", "923456789");
  return [
    {
      id: 1,
      invoiceNumber: 3001,
      invoiceDate: "2026-06-08",
      invoiceDueDate: "2026-06-22",
      isCreditNote: false,
      amountCurrency: 15000,
      amountExcludingVatCurrency: 12000,
      amountCurrencyOutstanding: 0,
      currency: { code: "NOK" },
      customer: acme,
      orderLines: [hours("Rådgivning", 10, 1200)],
      postings: [
        { date: "2026-06-08", amountCurrency: 15000 },
        { date: "2026-06-19", amountCurrency: -15000 },
      ],
    },
    {
      id: 2,
      invoiceNumber: 3002,
      invoiceDate: "2026-07-01",
      invoiceDueDate: "2026-07-15",
      isCreditNote: false,
      amountCurrency: 31250,
      amountExcludingVatCurrency: 25000,
      amountCurrencyOutstanding: 31250,
      invoiceComment: "Juni",
      currency: { code: "NOK" },
      customer: nordlys,
      orderLines: [hours("Design", 15, 1000), hours("Utvikling", 8, 1250)],
      postings: [{ date: "2026-07-01", amountCurrency: 31250 }],
    },
    {
      id: 3,
      invoiceNumber: 3003,
      invoiceDate: "2026-07-05",
      invoiceDueDate: "2026-07-19",
      isCreditNote: false,
      amountCurrency: 1250,
      amountExcludingVatCurrency: 1000,
      amountCurrencyOutstanding: 0,
      currency: { code: "NOK" },
      customer: nordlys,
      orderLines: [hours("Feil", 1, 1000)],
      postings: [],
    },
    {
      id: 4,
      invoiceNumber: 3004,
      invoiceDate: "2026-07-06",
      isCreditNote: true,
      creditedInvoice: 3,
      amountCurrency: -1250,
      amountExcludingVatCurrency: -1000,
      amountCurrencyOutstanding: 0,
      currency: { code: "NOK" },
      customer: nordlys,
      orderLines: [hours("Feil", -1, 1000)],
      postings: [],
    },
    {
      id: 5,
      invoiceNumber: 2001,
      invoiceDate: "2025-12-15",
      invoiceDueDate: "2025-12-29",
      isCreditNote: false,
      amountCurrency: 500,
      amountExcludingVatCurrency: 400,
      amountCurrencyOutstanding: 0,
      currency: { code: "NOK" },
      customer: acme,
      orderLines: [hours("Gammel", 1, 400)],
      postings: [],
    },
  ];
}

const invoicesOf = (storeId: string) =>
  db().execute<Row>(sql`
    select i.id, i.status, i.imported, i.legacy_number, i.document_number, i.number, i.total_minor, i.issued_on::text as issued_on, c.name as client, c.organisation_number as org,
           (select count(*)::int from commerce.work_invoice_lines l where l.invoice_id = i.id) as lines,
           (select coalesce(sum(amount_minor), 0)::bigint from commerce.work_invoice_payments p where p.invoice_id = i.id) as paid
      from commerce.work_invoices i join commerce.work_clients c on c.id = i.client_id
     where i.store_id = ${storeId}::uuid order by i.issued_on, i.document_number`);

describe("invoices brought in from Tripletex (D494)", () => {
  it("shows what would come in, then brings it in once: lines, clients, payments, Life's invoice numbered, a credited one void", async () => {
    const { storeId, accountId, org, member } = await workStore();
    const tx = await connected(storeId, accountId, org, BASE + 1);
    tx.invoices = theirInvoices();
    const acme = await lifeClient(storeId, "Acme Norge");
    const life = await lifeInvoice(storeId, acme, "2026-06-05", 1_500_000);
    const deps = { fetch: tx.fetch, now: () => new Date("2026-11-08T12:00:00Z") };

    const preview = await previewTripletexInvoices(member, "2026-01-01", deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.summary).toMatchObject({ invoices: 2, lines: 3, voided: 1, clients: 1, filled: 1, numbered: 1, paymentsHere: 1, alreadyHere: 1, skipped: [], totals: [{ currency: "NOK", minor: 3_125_000 }] });
    // A look writes nothing.
    expect(await invoicesOf(storeId)).toHaveLength(1);

    const done = await importTripletexInvoices(member, "2026-01-01", deps);
    expect(done).toMatchObject({ ok: true, made: { invoices: 2, clients: 1, payments: 1, numbered: 1, linked: 2 } });
    const rows = await invoicesOf(storeId);
    expect(rows.map((r) => [r.document_number, r.legacy_number, r.status, r.imported, r.number, Number(r.total_minor), r.lines, Number(r.paid), r.client])).toEqual([
      ["3001", "3001", "paid", true, null, 1_500_000, 1, 1_500_000, "Acme Norge"],
      ["3002", "3002", "sent", true, null, 3_125_000, 2, 0, "Nordlys Design AS"],
      ["3003", "3003", "void", true, null, 125_000, 1, 0, "Nordlys Design AS"],
    ]);
    expect(rows[0].id).toBe(life);
    // Life's client got the organisation number and address it lacked; the new client is the customer card.
    const clients = await db().execute<Row>(sql`
      select name, organisation_number, billing_email, billing_address ->> 'city' as city, payment_days from commerce.work_clients where store_id = ${storeId}::uuid order by name`);
    expect(clients.map((c) => [c.name, c.organisation_number, c.billing_email, c.city, c.payment_days])).toEqual([
      ["Acme Norge", "987654321", "faktura@acme.example", "Trondheim", null],
      ["Nordlys Design AS", "923456789", "faktura@nordlys.example", "Trondheim", 14],
    ]);
    const [payment] = await db().execute<Row>(sql`select received_on::text as received_on, method, reference from commerce.work_invoice_payments where invoice_id = ${life}::uuid`);
    expect(payment).toMatchObject({ received_on: "2026-06-19", method: "other", reference: "Tripletex" });
    const lines = await db().execute<Row>(sql`
      select l.description, l.unit, l.quantity_hundredths, l.unit_price_minor, l.vat_rate::text as rate from commerce.work_invoice_lines l
        join commerce.work_invoices i on i.id = l.invoice_id where i.store_id = ${storeId}::uuid and i.document_number = '3002' order by l.position`);
    expect(lines.map((l) => [l.description, l.unit, l.quantity_hundredths, Number(l.unit_price_minor), l.rate])).toEqual([
      ["Design", "hour", 1500, 100_000, "0.2500"],
      ["Utvikling", "hour", 800, 125_000, "0.2500"],
    ]);
    // Nothing from the store's own series, and the clients keep their Tripletex cards.
    const [series] = await db().execute<Row>(sql`select next_number from commerce.document_series where store_id = ${storeId}::uuid and series = 'work_invoice'`);
    expect(Number(series?.next_number ?? 1)).toBe(1);
    const links = await db().execute<Row>(sql`select their_id from commerce.tripletex_sync where store_id = ${storeId}::uuid and kind = 'customer' order by their_id`);
    expect(links.map((l) => Number(l.their_id))).toEqual([71, 72]);
    const events = await db().execute<Row>(sql`select type, count(*)::int as n from commerce.work_events where store_id = ${storeId}::uuid and type in ('invoice.imported', 'invoice.numbered') group by type order by type`);
    expect(events.map((e) => [e.type, e.n])).toEqual([
      ["invoice.imported", 2],
      ["invoice.numbered", 1],
    ]);

    // Pressed again: nothing more.
    expect(await importTripletexInvoices(member, "2026-01-01", deps)).toMatchObject({ ok: true, made: { invoices: 0, clients: 0, payments: 0, numbered: 0 }, summary: { invoices: 0, alreadyHere: 3 } });
    expect(await invoicesOf(storeId)).toHaveLength(3);

    // And the sync sends none of it back: imported invoices are history, and the customers are the cards Tripletex has.
    const posts = tx.calls.filter((c) => c.method === "POST").length;
    expect(await syncDueTripletex({ deps: { fetch: tx.fetch }, storeIds: [storeId] })).toMatchObject({ sent: 0 });
    expect(tx.calls.filter((c) => c.method === "POST").length).toBe(posts);
  }, 60_000);

  it("keeps an invoice brought in twice once: Life's copy takes Tripletex's number, the copy brought in is taken back (D495)", async () => {
    const { storeId, accountId, org, member } = await workStore();
    const tx = await connected(storeId, accountId, org, BASE + 3);
    const kaffe = await lifeClient(storeId, "Kaffehus");
    // Life wrote it on 12 June; Tripletex sent it as 3010 on 7 July, and the first import (a week's window) brought it in beside Life's.
    const life = await lifeInvoice(storeId, kaffe, "2026-06-12", 1_500_000);
    const copy = await db().transaction(async (t) => {
      await t.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
      const [row] = await t.execute<Row>(sql`
        insert into commerce.work_invoices (store_id, client_id, status, document_number, legacy_number, imported, issued_on, due_on, sent_at, currency, locale, payment_days,
          subtotal_minor, vat_minor, total_minor, seller, buyer)
        values (${storeId}::uuid, ${kaffe}::uuid, 'sent', '3010', '3010', true, '2026-07-07', '2026-07-21', now(), 'NOK', 'nb-NO', 14, 1200000, 300000, 1500000, '{}'::jsonb, '{}'::jsonb)
        returning id`);
      await t.execute(sql`
        insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor, vat_category, vat_rate, excl_minor, vat_minor, incl_minor)
        values (${storeId}::uuid, ${String(row.id)}::uuid, 0, 'Rådgivning', 1000, 120000, 'standard', 0.25, 1200000, 300000, 1500000)`);
      await t.execute(sql`select commerce.work_event(${storeId}::uuid, 'invoice', ${String(row.id)}::uuid, 'invoice.imported', '{"import":"tripletex"}'::jsonb, ${accountId}::uuid)`);
      return String(row.id);
    });
    tx.invoices = [
      {
        id: 10,
        invoiceNumber: 3010,
        invoiceDate: "2026-07-07",
        invoiceDueDate: "2026-07-21",
        isCreditNote: false,
        amountCurrency: 15000,
        amountExcludingVatCurrency: 12000,
        amountCurrencyOutstanding: 15000,
        currency: { code: "NOK" },
        customer: customer(81, "Kaffehus AS", null),
        orderLines: [hours("Rådgivning", 10, 1200)],
        postings: [],
      },
    ];
    const deps = { fetch: tx.fetch, now: () => new Date("2026-11-08T12:00:00Z") };
    const preview = await previewTripletexInvoices(member, "2026-01-01", deps);
    expect(preview).toMatchObject({ ok: true, summary: { invoices: 0, merged: 1, alreadyHere: 1 } });
    expect(await importTripletexInvoices(member, "2026-01-01", deps)).toMatchObject({ ok: true, made: { invoices: 0, merged: 1, numbered: 1 } });
    const rows = await invoicesOf(storeId);
    expect(rows.map((r) => [r.id, r.document_number, r.legacy_number, r.status])).toEqual([[life, "3010", "3010", "sent"]]);
    expect(await db().execute<Row>(sql`select 1 from commerce.work_invoice_lines where invoice_id = ${copy}::uuid`)).toHaveLength(0);
    const [merged] = await db().execute<Row>(sql`select data from commerce.work_events where store_id = ${storeId}::uuid and type = 'invoice.merged'`);
    expect(merged.data).toMatchObject({ legacy_number: "3010", removed_copy: copy });
    // Pressed again: the one invoice is here, nothing more.
    expect(await importTripletexInvoices(member, "2026-01-01", deps)).toMatchObject({ ok: true, made: { invoices: 0, merged: 0 }, summary: { alreadyHere: 1 } });
  }, 60_000);

  it("brings in nothing without Work, without a connection, or when Tripletex cannot be read", async () => {
    const { storeId, accountId, org, member } = await workStore();
    expect(await previewTripletexInvoices(member, "2026-01-01")).toEqual({ ok: false, problem: "connection" });
    const tx = await connected(storeId, accountId, org, BASE + 2);
    tx.failNext("GET", /^\/invoice$/, 500, { status: 500, message: "Feil" }, {}, 5);
    expect(await previewTripletexInvoices(member, "2026-01-01", { fetch: tx.fetch })).toEqual({ ok: false, problem: "read" });
    await db().execute(sql`update commerce.stores set modules = '{}' where id = ${storeId}::uuid`);
    expect(await importTripletexInvoices(member, "2026-01-01", { fetch: tx.fetch })).toEqual({ ok: false, problem: "work" });
    expect(await invoicesOf(storeId)).toHaveLength(0);
  });
});
