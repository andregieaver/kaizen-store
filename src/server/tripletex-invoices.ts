import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { todayIn } from "@/lib/analytics-period";
import {
  planTripletexInvoices,
  readTripletexInvoice,
  summarisePlan,
  TRIPLETEX_INVOICE_FIELDS,
  type HereClient,
  type HereInvoice,
  type PlanSummary,
  type TripletexInvoicePlan,
  type TxInvoice,
} from "@/lib/tripletex-invoices";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { getTripletexConnection, tripletexCredential } from "./tripletex";
import { listAll, openSession, type TripletexDeps, type TripletexSession } from "./tripletex-client";
import { adoptTripletexCustomers } from "./tripletex-sync";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Invoices brought in from Tripletex into Work (D494): the owner's preview and import on the Tripletex page. Tripletex's invoice list is
 * read with each invoice's customer, lines and postings (`GET /invoice`, a page of 100 at a time), planned against the store's Work
 * clients and invoices by `planTripletexInvoices()`, and written in one transaction that says it is importing (the Work rules let only
 * such a transaction make imported invoices, `work_imported_invoices`), so nothing of a failed run stays. Nothing is sent to Tripletex
 * but the reads; the clients found or made are linked to their Tripletex cards afterwards, so the sync uses the same cards.
 */

/** Tripletex's list stops here; more than this asks the owner for a later first day. */
const MOST = 5000;

export type TripletexInvoicesProblem = "connection" | "work" | "session" | "read" | "too_many";

export type TripletexInvoicesRead = { ok: true; plan: TripletexInvoicePlan; summary: PlanSummary } | { ok: false; problem: TripletexInvoicesProblem };

export type TripletexImportResult =
  | { ok: true; summary: PlanSummary; made: { invoices: number; clients: number; payments: number; numbered: number; linked: number } }
  | { ok: false; problem: TripletexInvoicesProblem };

const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Every invoice Tripletex has from `from` to today, read into plain shapes (one that cannot be read is logged and left out). */
async function readInvoices(session: TripletexSession, storeId: string, from: string, today: string): Promise<{ ok: true; invoices: TxInvoice[] } | { ok: false; problem: "read" | "too_many" }> {
  const read = await listAll<unknown>(session, "/invoice", { invoiceDateFrom: from, invoiceDateTo: dayAfter(today), fields: TRIPLETEX_INVOICE_FIELDS }, MOST, 100);
  if (!read.ok) {
    log("warn", "tripletex.invoices_read", { storeId, key: read.failure.key });
    return { ok: false, problem: "read" };
  }
  if (read.value.length >= MOST) return { ok: false, problem: "too_many" };
  const invoices = read.value.map(readTripletexInvoice);
  const unread = invoices.filter((i) => i === null).length;
  if (unread > 0) log("warn", "tripletex.invoices_unread", { storeId, unread, read: invoices.length });
  return { ok: true, invoices: invoices.filter((i): i is TxInvoice => i !== null) };
}

/** The store's Work clients and invoices, as the plan compares them. */
async function hereOf(storeId: string): Promise<{ clients: HereClient[]; here: HereInvoice[] }> {
  const clients = await typedRows(
    z.object({
      id: col.uuid,
      name: col.text,
      legal_name: col.textOrNull,
      organisation_number: col.textOrNull,
      billing_email: col.textOrNull,
      phone: col.textOrNull,
      has_address: col.bool,
      locale: col.textOrNull,
      vat_treatment: col.text,
    }),
    sql`
      select id, name, legal_name, organisation_number, billing_email, phone, locale, vat_treatment,
             coalesce(nullif(trim(billing_address ->> 'line1'), ''), nullif(trim(billing_address ->> 'city'), '')) is not null as has_address
        from commerce.work_clients where store_id = ${storeId}::uuid`,
  );
  const invoices = await typedRows(
    z.object({
      id: col.uuid,
      client_id: col.uuid,
      imported: col.bool,
      legacy_number: col.textOrNull,
      document_number: col.textOrNull,
      status: z.enum(["draft", "sent", "paid", "void"]),
      issued_on: col.textOrNull,
      currency: col.currency,
      total_minor: col.minor,
      paid_minor: col.minor,
    }),
    sql`
      select i.id, i.client_id, i.imported, i.legacy_number, i.document_number, i.status, i.issued_on::text, i.currency, i.total_minor,
             coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p where p.store_id = i.store_id and p.invoice_id = i.id), 0)::bigint as paid_minor
        from commerce.work_invoices i where i.store_id = ${storeId}::uuid`,
  );
  return {
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      legalName: c.legal_name,
      organisationNumber: c.organisation_number,
      billingEmail: c.billing_email,
      phone: c.phone,
      hasAddress: c.has_address,
      locale: c.locale,
      vatTreatment: c.vat_treatment,
    })),
    here: invoices.map((i) => ({
      id: i.id,
      clientId: i.client_id,
      imported: i.imported,
      legacyNumber: i.legacy_number,
      documentNumber: i.document_number,
      status: i.status,
      issuedOn: i.issued_on,
      currency: i.currency,
      totalMinor: i.total_minor,
      paidMinor: i.paid_minor,
    })),
  };
}

/** The store as the plan needs it: Work on, its country and time zone, and the countries known. */
async function storeFacts(storeId: string): Promise<{ work: boolean; country: string; timeZone: string; countries: Set<string> } | null> {
  const store = await typedRow(
    z.object({ work: col.bool, country: col.textOrNull, time_zone: col.text }),
    sql`select 'work' = any (modules) as work, country::text, time_zone from commerce.stores where id = ${storeId}::uuid`,
  );
  if (!store) return null;
  const countries = await typedRows(z.object({ code: col.text }), sql`select code::text from commerce.countries`);
  return { work: store.work, country: store.country ?? "NO", timeZone: store.time_zone, countries: new Set(countries.map((c) => c.code)) };
}

/** Reads Tripletex and plans: the preview, and the first half of the import. */
async function readAndPlan(
  storeId: string,
  from: string,
  deps: TripletexDeps,
): Promise<{ ok: true; plan: TripletexInvoicePlan; session: TripletexSession } | { ok: false; problem: TripletexInvoicesProblem }> {
  const connection = await getTripletexConnection(storeId);
  const credential = connection && connection.state !== "auth_failed" ? await tripletexCredential(storeId) : null;
  if (!connection || !credential) return { ok: false, problem: "connection" };
  const store = await storeFacts(storeId);
  if (!store?.work) return { ok: false, problem: "work" };
  const opened = await openSession(credential, deps);
  if (!opened.ok) {
    log("warn", "tripletex.invoices_session", { storeId, key: opened.failure.key });
    return { ok: false, problem: "session" };
  }
  const today = todayIn((deps.now ?? (() => new Date()))(), store.timeZone);
  const read = await readInvoices(opened.session, storeId, from, today);
  if (!read.ok) return read;
  const { clients, here } = await hereOf(storeId);
  const plan = planTripletexInvoices({
    storeId,
    companyId: connection.company.id,
    invoices: read.invoices,
    clients,
    here,
    storeCountry: store.country,
    countries: store.countries,
    today,
  });
  return { ok: true, plan, session: opened.session };
}

/** What would come in from `from` (an owner's look before pressing Bring in). */
export async function previewTripletexInvoices(member: Membership, from: string, deps: TripletexDeps = {}): Promise<TripletexInvoicesRead> {
  const planned = await readAndPlan(member.store.id, from, deps);
  if (!planned.ok) return planned;
  return { ok: true, plan: planned.plan, summary: summarisePlan(planned.plan) };
}

const values = (rows: SQL[]) => sql.join(rows, sql`, `);

/**
 * Brings the invoices in: reads and plans again (so what is written is what Tripletex and the store say now), then writes the plan in one
 * transaction that says it is importing, under the store's lock, and links the clients to their Tripletex cards. A second press adds
 * nothing: every row has the id the plan gives it, and an invoice brought in is one already here the next time.
 */
export async function importTripletexInvoices(member: Membership, from: string, deps: TripletexDeps = {}): Promise<TripletexImportResult> {
  const storeId = member.store.id;
  const accountId = member.account.id;
  const planned = await readAndPlan(storeId, from, deps);
  if (!planned.ok) return planned;
  const { plan } = planned;

  const made = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tripletex-invoices:${storeId}`}))`);
    await tx.execute(sql`select set_config('commerce.work_importing', 'on', true)`);

    let clients = 0;
    if (plan.clients.length > 0) {
      const rows = await tx.execute(sql`
        insert into commerce.work_clients (id, store_id, name, organisation_number, country, billing_address, billing_email, phone, locale, currency,
          payment_days, business, vat_treatment, sort_order)
        select v.id, ${storeId}::uuid, v.name, v.org, v.country, v.address, v.email, v.phone, v.locale, v.currency, v.days, v.business, v.vat,
               coalesce((select max(sort_order) from commerce.work_clients where store_id = ${storeId}::uuid), -1) + v.n
          from (values ${values(
            plan.clients.map(
              (c, n) =>
                sql`(${c.id}::uuid, ${c.name}, ${c.organisationNumber}, ${c.country}::char(2), ${JSON.stringify(c.address)}::jsonb, ${c.billingEmail}, ${c.phone},
                     ${c.locale}, ${c.currency}::char(3), ${c.paymentDays}::int, ${c.business}::boolean, ${c.vatTreatment}, ${n + 1}::int)`,
            ),
          )}) as v(id, name, org, country, address, email, phone, locale, currency, days, business, vat, n)
        on conflict (id) do nothing
        returning id
      `);
      clients = rows.length;
      for (const row of rows) await tx.execute(sql`select commerce.work_event(${storeId}::uuid, 'client', ${String(row.id)}::uuid, 'client.created', ${JSON.stringify({ source: "tripletex" })}::jsonb, ${accountId}::uuid)`);
    }

    // A found client gets what it lacks, never more: each field only while it is still empty.
    for (const f of plan.fills) {
      await tx.execute(sql`
        update commerce.work_clients set
          organisation_number = coalesce(nullif(trim(organisation_number), ''), ${f.organisationNumber ?? null}),
          billing_email = coalesce(nullif(trim(billing_email), ''), ${f.billingEmail ?? null}),
          phone = coalesce(nullif(trim(phone), ''), ${f.phone ?? null}),
          billing_address = case
            when ${f.address ? JSON.stringify(f.address) : null}::jsonb is not null
             and coalesce(nullif(trim(billing_address ->> 'line1'), ''), nullif(trim(billing_address ->> 'city'), '')) is null
            then ${f.address ? JSON.stringify(f.address) : null}::jsonb else billing_address end,
          updated_at = now()
        where store_id = ${storeId}::uuid and id = ${f.clientId}::uuid
      `);
    }

    let invoices = 0;
    for (const i of plan.invoices) {
      const legacy = i.number === "Imported" ? null : i.number;
      const inserted = await tx.execute(sql`
        insert into commerce.work_invoices (id, store_id, client_id, status, series, number, document_number, imported, legacy_number, issued_on, due_on,
          sent_at, currency, locale, payment_days, notes, subtotal_minor, vat_minor, total_minor, vat_notes, seller, buyer, created_by)
        select ${i.id}::uuid, s.id, c.id, ${i.status}, 'work_invoice', null, ${i.number}, true, ${legacy}, ${i.issuedOn}::date, ${i.dueOn}::date,
               ((${i.issuedOn}::date + time '12:00') at time zone s.time_zone), ${i.currency}::char(3), coalesce(c.locale, 'nb-NO'), ${i.paymentDays}::int, ${i.notes},
               ${i.subtotalMinor}::bigint, ${i.vatMinor}::bigint, ${i.totalMinor}::bigint, ${JSON.stringify(i.vatNotes)}::jsonb,
               jsonb_build_object(
                 'legal_name', s.legal_name, 'organisation_number', s.organisation_number,
                 'vat_registered', coalesce(ws.vat_registered, true),
                 'vat_number', case when coalesce(ws.vat_registered, true) then ws.vat_number end,
                 'address', s.postal_address, 'country', s.country, 'email', s.contact_email,
                 'bank_account', ws.bank_account, 'bic', ws.bic, 'payment_note', ws.payment_note,
                 'invoice_footer', ws.invoice_footer, 'late_payment_note', ws.late_payment_note),
               jsonb_build_object('name', coalesce(nullif(trim(c.legal_name), ''), c.name), 'client_name', c.name,
                 'organisation_number', c.organisation_number, 'vat_number', c.vat_number, 'address', c.billing_address,
                 'country', c.country, 'email', c.billing_email, 'contact_name', c.contact_name, 'business', c.business,
                 'vat_treatment', c.vat_treatment),
               ${accountId}::uuid
          from commerce.stores s
          join commerce.work_clients c on c.store_id = s.id and c.id = ${i.clientId}::uuid
          left join commerce.work_settings ws on ws.store_id = s.id
         where s.id = ${storeId}::uuid
        on conflict do nothing
        returning id
      `);
      if (inserted.length === 0) continue;
      invoices += 1;
      await tx.execute(sql`
        insert into commerce.work_invoice_lines (id, store_id, invoice_id, position, description, unit, quantity_hundredths, unit_price_minor, discount_bp,
          vat_category, vat_rate, excl_minor, vat_minor, incl_minor, quantity_manual)
        values ${values(
          i.lines.map(
            (l) =>
              sql`(${l.id}::uuid, ${storeId}::uuid, ${i.id}::uuid, ${l.position}::int, ${l.description}, ${l.unit}, ${l.quantityHundredths}::int, ${l.unitPriceMinor}::bigint,
                   ${l.discountBp}::int, ${l.vatCategory}, ${l.vatRate}::numeric, ${l.exclMinor}::bigint, ${l.vatMinor}::bigint, ${l.inclMinor}::bigint, true)`,
          ),
        )}
        on conflict do nothing
      `);
      await tx.execute(sql`
        select commerce.work_event(${storeId}::uuid, 'invoice', ${i.id}::uuid, 'invoice.imported',
          ${JSON.stringify({ import: "tripletex", tripletex_invoice_id: i.theirId, legacy_number: legacy, status: i.status, total_minor: i.totalMinor, currency: i.currency })}::jsonb, ${accountId}::uuid)
      `);
    }

    // One of Life's without a number takes Tripletex's, when no other invoice here has it.
    let numbered = 0;
    for (const m of plan.matched.filter((x) => x.giveNumber)) {
      const rows = await tx.execute(sql`
        update commerce.work_invoices i set legacy_number = ${m.giveNumber}, document_number = ${m.giveNumber}
         where i.store_id = ${storeId}::uuid and i.id = ${m.invoiceId}::uuid and i.imported and i.legacy_number is null
           and not exists (select 1 from commerce.work_invoices o where o.store_id = i.store_id and o.id <> i.id
                            and (o.legacy_number = ${m.giveNumber} or (o.document_number = ${m.giveNumber} and (not o.imported or o.legacy_number is not null))))
        returning i.id
      `);
      if (rows.length === 0) continue;
      numbered += 1;
      await tx.execute(sql`
        select commerce.work_event(${storeId}::uuid, 'invoice', ${m.invoiceId}::uuid, 'invoice.numbered',
          ${JSON.stringify({ import: "tripletex", tripletex_invoice_id: m.theirId, legacy_number: m.giveNumber })}::jsonb, ${accountId}::uuid)
      `);
    }

    // The money Tripletex has: one payment row each, so the invoice's status follows it.
    const payments = [
      ...plan.invoices.filter((i) => i.payment && i.status === "sent").map((i) => ({ invoiceId: i.id, payment: i.payment! })),
      ...plan.matched.filter((m) => m.payment).map((m) => ({ invoiceId: m.invoiceId, payment: m.payment! })),
    ];
    let paid = 0;
    if (payments.length > 0) {
      const rows = await tx.execute(sql`
        insert into commerce.work_invoice_payments (id, store_id, invoice_id, amount_minor, currency, received_on, method, reference, recorded_by)
        select v.id, ${storeId}::uuid, v.invoice_id, v.amount, v.currency, v.received_on, 'other', 'Tripletex', ${accountId}::uuid
          from (values ${values(
            payments.map((p) => sql`(${p.payment.id}::uuid, ${p.invoiceId}::uuid, ${p.payment.amountMinor}::bigint, ${p.payment.currency}::char(3), ${p.payment.receivedOn}::date)`),
          )}) as v(id, invoice_id, amount, currency, received_on)
          join commerce.work_invoices i on i.store_id = ${storeId}::uuid and i.id = v.invoice_id and i.status = 'sent'
        on conflict do nothing
        returning id
      `);
      paid = rows.length;
    }
    return { invoices, clients, payments: paid, numbered };
  });

  // The clients' Tripletex cards: after the clients are filled in, so the card remembered is the one the sync would send.
  let linked = 0;
  try {
    linked = await adoptTripletexCustomers(storeId, planned.session, plan.links);
  } catch (error) {
    log("warn", "tripletex.invoices_link", { storeId }, error);
  }
  log("info", "tripletex.invoices_imported", { storeId, ...made, linked, skipped: plan.skipped.length });
  await audit(accountId, storeId, "integration.tripletex_invoices_imported", { from, ...made, linked, skipped: plan.skipped.length });
  return { ok: true, summary: summarisePlan(plan), made: { ...made, linked } };
}
