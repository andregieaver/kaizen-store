import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { CreditNoteSnapshot } from "@/lib/credit-allocation";
import type { OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";
import { todayIn } from "@/lib/analytics-period";
import { minorOf } from "@/lib/tripletex";
import { type TripletexFailure } from "@/lib/tripletex-errors";
import {
  customerKey,
  shopCreditNoteDoc,
  shopCustomerBody,
  shopInvoiceDoc,
  stableJson,
  voucherBody,
  workCreditNoteDoc,
  workCustomerBody,
  workInvoiceDoc,
  type BookingDoc,
  type CustomerBody,
  type CustomerRef,
  type VoucherIds,
} from "@/lib/tripletex-map";
import { BOOKING_KEYS, type TripletexSettings } from "@/lib/tripletex-settings";
import type { Chart } from "@/lib/tripletex-setup";

import { audit } from "./auth";
import { readPdf, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { sendAccountingAlert } from "./staff-alerts";
import { getTripletexConnection, readChart, tripletexAttention, tripletexCredential, type TripletexConnection } from "./tripletex";
import { listAll, openSession, type TripletexDeps, type TripletexSession } from "./tripletex-client";
import { col, typedRow, typedRows } from "./typed-rows";
import { workEvent } from "./work";

/**
 * Tripletex (D453): sending a store's documents, the only writer of `commerce.tripletex_sync`. Every five minutes, per store
 * whose connection is on (one store at a time: Tripletex's limits are per token), it finds the invoices and credit notes
 * issued since `sync_from` that have no row yet, claims the due ones (`for update skip locked`, then a claim that expires, so
 * two runs never send the same row), and sends each: its customer card first (found by organisation number, made once, sent
 * again only when something on it changed), then its voucher. A row tried before is first looked up by its external number,
 * so a voucher whose answer was lost is adopted and never booked twice. A failure is classified: tried again on a ladder,
 * waited out (a rate limit), paused for the whole store (the token stopped working), or left for a person with a reason in
 * words. Never throws for one store or one document; never puts a token, a body or a person's data in a log or a row.
 */

const BATCH = 25;
const BUDGET_MS = 40_000;
const CLAIM_MINUTES = 5;
/** Minutes before each automatic retry (D41's ladder), then once a day, then a person decides. */
const LADDER_MINUTES = [1, 5, 30, 120, 360];
const DAILY_TRIES = 14;

export type TripletexRun = { stores: number; sent: number; adopted: number; failed: number; blocked: number; waiting: number; attached: number; alerted: number };

export type SyncOptions = {
  now?: () => Date;
  deps?: TripletexDeps;
  storeIds?: readonly string[];
  budgetMs?: number;
  /** Where the documents' PDFs are kept (tests pass one in memory); the private bucket by default. */
  storage?: DocumentStorage | null;
  /** The daily alert's sender (tests pass their own); `sendAccountingAlert()` by default. */
  alert?: typeof sendAccountingAlert;
};

type Kind = "work_invoice" | "work_credit_note" | "shop_invoice" | "shop_credit_note";

type Claimed = { kind: Kind; localId: string; attempts: number; externalKey: string; posting: number };

type Ctx = {
  storeId: string;
  connection: TripletexConnection & { settings: TripletexSettings; syncFrom: string };
  session: TripletexSession;
  ids: Omit<VoucherIds, "customerId"> | null;
  chart: Chart | null;
  countries: Map<string, number> | null;
  now: Date;
  run: TripletexRun;
};

const at = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

/** The external number of a document as the database writes it at the sweep; `externalVoucherNumber()` in `src/lib/tripletex.ts` is the same (a test holds them equal). */
const EXTERNAL = sql`'kf/' || left(replace(store_id::text, '-', ''), 8) || '/' || document_number`;

// ---------------------------------------------------------------------------------------------------------------------
// Finding and claiming
// ---------------------------------------------------------------------------------------------------------------------

/** Rows for the documents issued since the start day that have none: invoices before their credit notes. */
async function sweep(storeId: string, connection: Ctx["connection"]): Promise<void> {
  const { mode } = connection;
  const company = connection.company.id;
  const from = connection.syncFrom;
  if (connection.settings.sources.work) {
    await db().execute(sql`
      insert into commerce.tripletex_sync (store_id, mode, company_id, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${mode}, ${company}, 'work_invoice', id::text, ${EXTERNAL}, total_minor, currency
        from commerce.work_invoices
       where store_id = ${storeId}::uuid and status <> 'draft' and not imported and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
    await db().execute(sql`
      insert into commerce.tripletex_sync (store_id, mode, company_id, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${mode}, ${company}, 'work_credit_note', id::text, ${EXTERNAL}, total_minor, currency
        from commerce.work_credit_notes
       where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
  }
  if (connection.settings.sources.shop) {
    await db().execute(sql`
      insert into commerce.tripletex_sync (store_id, mode, company_id, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${mode}, ${company}, 'shop_invoice', id::text, ${EXTERNAL}, total_minor, currency
        from commerce.invoices
       where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
    await db().execute(sql`
      insert into commerce.tripletex_sync (store_id, mode, company_id, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${mode}, ${company}, 'shop_credit_note', id::text, ${EXTERNAL}, total_minor, currency
        from commerce.credit_notes
       where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
  }
}

async function claim(storeId: string, connection: Ctx["connection"], now: Date): Promise<Claimed[]> {
  const rows = await typedRows(
    z.object({ kind: z.enum(["work_invoice", "work_credit_note", "shop_invoice", "shop_credit_note"]), local_id: col.text, attempts: col.int, external_key: col.text, posting: col.int }),
    sql`
      with due as (
        select store_id, mode, company_id, kind, local_id from commerce.tripletex_sync
         where store_id = ${storeId}::uuid and mode = ${connection.mode} and company_id = ${connection.company.id} and kind <> 'customer'
           and ((state in ('pending', 'failed') and coalesce(next_attempt_at, '-infinity') <= ${now.toISOString()}::timestamptz)
             or (state = 'sending' and claimed_until < ${now.toISOString()}::timestamptz))
         order by case when kind in ('work_invoice', 'shop_invoice') then 0 else 1 end, created_at, local_id
         limit ${BATCH}
         for update skip locked
      )
      update commerce.tripletex_sync t
         set state = 'sending', claimed_until = ${at(now, CLAIM_MINUTES)}::timestamptz, attempts = t.attempts + 1, updated_at = now()
        from due
       where t.store_id = due.store_id and t.mode = due.mode and t.company_id = due.company_id and t.kind = due.kind and t.local_id = due.local_id
      returning t.kind, t.local_id, t.attempts, t.external_key, t.posting
    `,
  );
  const order = (k: Kind) => (k === "work_invoice" || k === "shop_invoice" ? 0 : 1);
  return rows.map((r) => ({ kind: r.kind, localId: r.local_id, attempts: r.attempts, externalKey: r.external_key, posting: r.posting })).sort((a, b) => order(a.kind) - order(b.kind));
}

/** A row's key, for its updates. */
const where = (ctx: Ctx, kind: string, localId: string) =>
  sql`store_id = ${ctx.storeId}::uuid and mode = ${ctx.connection.mode} and company_id = ${ctx.connection.company.id} and kind = ${kind} and local_id = ${localId}`;

/** Gives a claimed row back untried (the run stopped before it): as it was, without counting the try. */
async function release(ctx: Ctx, row: Claimed, nextAt: string | null = null): Promise<void> {
  await db().execute(sql`
    update commerce.tripletex_sync set state = case when attempts > 1 then 'failed' else 'pending' end, attempts = greatest(attempts - 1, 0),
           claimed_until = null, next_attempt_at = ${nextAt}::timestamptz, updated_at = now()
     where ${where(ctx, row.kind, row.localId)} and state = 'sending'
  `);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading documents
// ---------------------------------------------------------------------------------------------------------------------

type Loaded = { doc: BookingDoc; invoiceId: string | null; workInvoiceId: string | null };

async function loadDocument(storeId: string, kind: Kind, id: string): Promise<Loaded | null> {
  if (kind === "work_invoice") {
    const row = await typedRow(
      z.object({ id: col.uuid, document_number: col.text, issued_on: col.text, currency: col.currency, total_minor: col.minor, vat_minor: col.minor, client_id: col.uuid, buyer_name: col.textOrNull, lines: z.array(z.object({ description: col.text, vat_category: col.text, vat_rate: col.text, incl_minor: col.minor })) }),
      sql`select i.id, i.document_number, i.issued_on::text as issued_on, i.currency, i.total_minor, i.vat_minor, i.client_id, i.buyer ->> 'name' as buyer_name,
                 coalesce((select json_agg(json_build_object('description', l.description, 'vat_category', l.vat_category, 'vat_rate', l.vat_rate::text, 'incl_minor', l.incl_minor) order by l.position, l.id)
                             from commerce.work_invoice_lines l where l.store_id = i.store_id and l.invoice_id = i.id), '[]') as lines
            from commerce.work_invoices i where i.store_id = ${storeId}::uuid and i.id = ${id}::uuid`,
    );
    if (!row) return null;
    const doc = workInvoiceDoc({
      id: row.id,
      documentNumber: row.document_number,
      issuedOn: row.issued_on,
      currency: row.currency,
      totalMinor: row.total_minor,
      vatMinor: row.vat_minor,
      clientId: row.client_id,
      buyerName: row.buyer_name ?? "",
      lines: row.lines.map((l) => ({ description: l.description, vatCategory: l.vat_category, vatRate: l.vat_rate, inclMinor: l.incl_minor })),
    });
    return { doc, invoiceId: null, workInvoiceId: row.id };
  }
  if (kind === "work_credit_note") {
    const row = await typedRow(
      z.object({ id: col.uuid, document_number: col.text, invoice_number: col.text, invoice_id: col.uuid, issued_on: col.text, currency: col.currency, total_minor: col.minor, vat_minor: col.minor, client_id: col.uuid, buyer_name: col.textOrNull, lines: z.unknown() }),
      sql`select c.id, c.document_number, i.document_number as invoice_number, c.invoice_id, c.issued_on::text as issued_on, c.currency, c.total_minor, c.vat_minor,
                 i.client_id, c.buyer ->> 'name' as buyer_name, c.lines
            from commerce.work_credit_notes c join commerce.work_invoices i on i.store_id = c.store_id and i.id = c.invoice_id
           where c.store_id = ${storeId}::uuid and c.id = ${id}::uuid`,
    );
    if (!row) return null;
    const doc = workCreditNoteDoc({
      id: row.id,
      documentNumber: row.document_number,
      invoiceNumber: row.invoice_number,
      issuedOn: row.issued_on,
      currency: row.currency,
      totalMinor: row.total_minor,
      vatMinor: row.vat_minor,
      clientId: row.client_id,
      buyerName: row.buyer_name ?? "",
      lines: row.lines,
    });
    return { doc, invoiceId: row.invoice_id, workInvoiceId: row.invoice_id };
  }
  if (kind === "shop_invoice") {
    const row = await typedRow(z.object({ id: col.uuid, snapshot: z.record(z.string(), z.unknown()) }), sql`select id, snapshot from commerce.invoices where store_id = ${storeId}::uuid and id = ${id}::uuid`);
    return row ? { doc: shopInvoiceDoc(row.id, row.snapshot as unknown as OrderInvoiceSnapshot), invoiceId: null, workInvoiceId: null } : null;
  }
  const row = await typedRow(
    z.object({ id: col.uuid, invoice_id: col.uuid, snapshot: z.record(z.string(), z.unknown()), invoice_snapshot: z.record(z.string(), z.unknown()) }),
    sql`select c.id, c.invoice_id, c.snapshot, i.snapshot as invoice_snapshot
          from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
         where c.store_id = ${storeId}::uuid and c.id = ${id}::uuid`,
  );
  if (!row) return null;
  return {
    doc: shopCreditNoteDoc(row.id, row.snapshot as unknown as CreditNoteSnapshot, row.invoice_snapshot as unknown as OrderInvoiceSnapshot),
    invoiceId: row.invoice_id,
    workInvoiceId: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The company's ids, once a run
// ---------------------------------------------------------------------------------------------------------------------

async function idsOf(ctx: Ctx): Promise<{ ok: true; ids: Omit<VoucherIds, "customerId"> } | { ok: false; failure: TripletexFailure }> {
  if (ctx.ids) return { ok: true, ids: ctx.ids };
  const chart = await readChart(ctx.session);
  if (!chart.ok) return chart;
  ctx.chart = chart.chart;
  const accountId = (number: number) => chart.chart.accounts.find((a) => a.number === number)?.id;
  const vatId = (code: string) => chart.chart.vatTypes.find((v) => v.number.trim() === code)?.id;
  const bookings: VoucherIds["bookings"] = {};
  for (const key of BOOKING_KEYS) {
    const booking = ctx.connection.settings.bookings[key];
    const a = booking ? accountId(booking.account) : undefined;
    const v = booking ? vatId(booking.vatCode) : undefined;
    if (a !== undefined && v !== undefined) bookings[key] = { accountId: a, vatTypeId: v };
  }
  const receivable = accountId(ctx.connection.settings.receivableAccount);
  ctx.ids = { receivableAccountId: receivable ?? 0, bookings, voucherTypeId: ctx.connection.settings.voucherTypeId };
  return { ok: true, ids: ctx.ids };
}

async function countryId(ctx: Ctx, code: string | null): Promise<number | null> {
  if (!code) return null;
  if (!ctx.countries) {
    const list = await listAll<{ id: number; isoAlpha2Code?: string }>(ctx.session, "/country", { fields: "id,isoAlpha2Code" });
    ctx.countries = new Map(list.ok ? list.value.filter((c) => typeof c.isoAlpha2Code === "string").map((c) => [c.isoAlpha2Code!.toUpperCase(), c.id]) : []);
  }
  return ctx.countries.get(code.toUpperCase()) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------------

type Outcome<T> = { ok: true; value: T } | { ok: false; failure: TripletexFailure } | { ok: false; block: string };

const hashOf = (body: CustomerBody) => createHash("sha256").update(stableJson(body)).digest("hex").slice(0, 32);

async function customerBodyOf(ctx: Ctx, ref: CustomerRef): Promise<CustomerBody | null> {
  if (ref.kind !== "work_client") return shopCustomerBody(ref, ctx.connection.settings.language);
  const client = await typedRow(
    z.object({
      name: col.text,
      legal_name: col.textOrNull,
      organisation_number: col.textOrNull,
      vat_number: col.textOrNull,
      business: col.bool,
      country: col.textOrNull,
      billing_address: z.record(z.string(), z.unknown()).nullable(),
      billing_email: col.textOrNull,
      locale: col.textOrNull,
      payment_days: col.int.nullable(),
    }),
    sql`select name, legal_name, organisation_number, vat_number, business, country, billing_address, billing_email, locale, payment_days
          from commerce.work_clients where store_id = ${ctx.storeId}::uuid and id = ${ref.clientId}::uuid`,
  );
  if (!client) return null;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const address = client.billing_address ?? {};
  return workCustomerBody(
    {
      name: client.name,
      legalName: client.legal_name,
      organisationNumber: client.organisation_number,
      vatNumber: client.vat_number,
      business: client.business,
      country: client.country,
      billingAddress: { line1: text(address.line1), line2: text(address.line2), postalCode: text(address.postalCode), city: text(address.city) },
      billingEmail: client.billing_email,
      locale: client.locale,
      paymentDays: client.payment_days,
    },
    { sendContactEmail: ctx.connection.settings.sendContactEmail, countryId: await countryId(ctx, client.country) },
  );
}

/** The customer's Tripletex id: kept, found by organisation number, or made; its card sent again when it changed. */
async function ensureCustomer(ctx: Ctx, ref: CustomerRef): Promise<Outcome<number>> {
  const key = customerKey(ref);
  const body = await customerBodyOf(ctx, ref);
  if (!body) return { ok: false, block: "customer_missing" };
  const hash = hashOf(body);
  const kept = await typedRow(
    z.object({ their_id: col.minorOrNull, their_version: col.int.nullable(), content_hash: col.textOrNull }),
    sql`select their_id, their_version, content_hash from commerce.tripletex_sync where ${where(ctx, "customer", key)}`,
  );
  const remember = async (id: number, version: number | null, ref2: string | null) => {
    await db().execute(sql`
      insert into commerce.tripletex_sync (store_id, mode, company_id, kind, local_id, their_id, their_version, their_ref, content_hash, state, synced_at)
      values (${ctx.storeId}::uuid, ${ctx.connection.mode}, ${ctx.connection.company.id}, 'customer', ${key}, ${id}, ${version}, ${ref2}, ${hash}, 'synced', now())
      on conflict (store_id, mode, company_id, kind, local_id) do update set
        their_id = excluded.their_id, their_version = excluded.their_version, their_ref = coalesce(excluded.their_ref, tripletex_sync.their_ref),
        content_hash = excluded.content_hash, state = 'synced', synced_at = now(), error_key = null, error_detail = null, updated_at = now()
    `);
  };
  type CustomerAnswer = { value?: { id?: unknown; version?: unknown; customerNumber?: unknown } };
  const refOf = (v: CustomerAnswer["value"]) => (v?.customerNumber === undefined || v?.customerNumber === null ? null : String(v.customerNumber).slice(0, 60));

  if (kept?.their_id) {
    if (kept.content_hash === hash) return { ok: true, value: kept.their_id };
    // Something we send changed: the card again, with the version Tripletex has (read again once if it moved).
    for (let tryNo = 0; tryNo < 2; tryNo += 1) {
      const current = await ctx.session.get<CustomerAnswer>(`/customer/${kept.their_id}`, { fields: "id,version" });
      if (!current.ok) {
        if (current.failure.class === "drift") break; // deleted in Tripletex: found or made again below
        return { ok: false, failure: current.failure };
      }
      const put = await ctx.session.put<CustomerAnswer>(`/customer/${kept.their_id}`, { ...body, id: kept.their_id, version: Number(current.value?.value?.version ?? 0) });
      if (put.ok) {
        await remember(kept.their_id, Number(put.value?.value?.version ?? 0), refOf(put.value?.value));
        return { ok: true, value: kept.their_id };
      }
      if (put.failure.class === "drift") break;
      if (put.failure.class !== "revision") return { ok: false, failure: put.failure };
    }
  }

  if (body.organizationNumber) {
    const found = await ctx.session.get<{ values?: { id?: unknown; version?: unknown; customerNumber?: unknown }[] }>("/customer", {
      organizationNumber: body.organizationNumber,
      fields: "id,version,customerNumber",
      count: 2,
    });
    if (!found.ok) return { ok: false, failure: found.failure };
    const first = found.value?.values?.[0];
    const id = Number(first?.id);
    if (Number.isSafeInteger(id) && id > 0) {
      // An existing card is adopted as it is: the accountant's own details on it are not overwritten.
      await remember(id, Number(first?.version ?? 0), refOf(first));
      return { ok: true, value: id };
    }
  }
  const made = await ctx.session.post<CustomerAnswer>("/customer", body);
  if (!made.ok) return { ok: false, failure: made.failure };
  const id = Number(made.value?.value?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, failure: { class: "transient", status: null, code: null, key: "bad_answer", requestId: null, retryAfter: null, detail: null } };
  await remember(id, Number(made.value?.value?.version ?? 0), refOf(made.value?.value));
  return { ok: true, value: id };
}

// ---------------------------------------------------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------------------------------------------------

type VoucherAnswer = { id?: unknown; number?: unknown; year?: unknown; numberAsString?: unknown; postings?: { amountGross?: unknown; amount?: unknown }[] };

const refOfVoucher = (v: VoucherAnswer | undefined): string | null => {
  if (typeof v?.numberAsString === "string" && v.numberAsString.trim() !== "") return v.numberAsString.slice(0, 60);
  if (v?.number !== undefined && v?.year !== undefined) return `${v.year}/${v.number}`.slice(0, 60);
  return null;
};

/** The VAT Tripletex worked out on a voucher, positive for an invoice: the gross less the net of every posting, turned. */
function vatOfVoucher(v: VoucherAnswer | undefined, kind: "invoice" | "credit_note"): number | null {
  const postings = Array.isArray(v?.postings) ? v.postings : [];
  let sum = 0;
  for (const p of postings) {
    const gross = minorOf(p.amountGross);
    const net = minorOf(p.amount);
    if (gross === null || net === null) return null;
    sum += gross - net;
  }
  return kind === "invoice" ? -sum : sum;
}

async function booked(ctx: Ctx, row: Claimed, loaded: Loaded, voucher: VoucherAnswer | undefined, adopted: boolean): Promise<void> {
  const id = Number(voucher?.id);
  // Read it back for the VAT Tripletex worked out (the answer to a POST may not carry the postings' amounts).
  let full = voucher;
  if (!Array.isArray(voucher?.postings) || voucher.postings.some((p) => p.amount === undefined)) {
    const read = await ctx.session.get<{ value?: VoucherAnswer }>(`/ledger/voucher/${id}`, { fields: "id,number,year,numberAsString,postings(amountGross,amount)" });
    if (read.ok) full = { ...voucher, ...read.value?.value };
  }
  const vat = vatOfVoucher(full, loaded.doc.kind);
  const variance = vat === null || vat === loaded.doc.vatMinor ? null : vat - loaded.doc.vatMinor;
  const ref = refOfVoucher(full);
  await db().execute(sql`
    update commerce.tripletex_sync set state = 'synced', their_id = ${id}, their_ref = ${ref}, variance_minor = ${variance}, synced_at = now(),
           error_key = null, error_detail = null, request_id = null, claimed_until = null, next_attempt_at = null, updated_at = now()
     where ${where(ctx, row.kind, row.localId)}
  `);
  if (loaded.workInvoiceId) {
    await workEvent(db(), ctx.storeId, "invoice", loaded.workInvoiceId, "tripletex.synced", { document: loaded.doc.documentNumber, voucher: ref, adopted, variance }, null);
  }
  if (adopted) ctx.run.adopted += 1;
  else ctx.run.sent += 1;
}

/** A document that waits for a person, with its reason; once a day at most in Work's history. */
async function blockRow(ctx: Ctx, row: Claimed, key: string, detail: string | null, loaded: Loaded | null, requestId: string | null = null): Promise<void> {
  await db().execute(sql`
    update commerce.tripletex_sync set state = 'blocked', error_key = ${key.slice(0, 40)}, error_detail = ${detail ? detail.slice(0, 400) : null},
           request_id = ${requestId ? requestId.slice(0, 100) : null}, claimed_until = null, next_attempt_at = null, updated_at = now()
     where ${where(ctx, row.kind, row.localId)}
  `);
  ctx.run.blocked += 1;
  if (loaded?.workInvoiceId) {
    const [recent] = await db().execute(sql`
      select 1 from commerce.work_events where store_id = ${ctx.storeId}::uuid and entity_type = 'invoice' and entity_id = ${loaded.workInvoiceId}::uuid
         and type = 'tripletex.blocked' and created_at > now() - interval '1 day' limit 1
    `);
    if (!recent) await workEvent(db(), ctx.storeId, "invoice", loaded.workInvoiceId, "tripletex.blocked", { document: loaded.doc.documentNumber, reason: key }, null);
  }
}

/** A failure that is tried again by itself: the ladder, then daily, then a person. */
async function failRow(ctx: Ctx, row: Claimed, failure: TripletexFailure, loaded: Loaded | null): Promise<void> {
  if (row.attempts > LADDER_MINUTES.length + DAILY_TRIES) {
    await blockRow(ctx, row, failure.key, failure.detail, loaded, failure.requestId);
    return;
  }
  const minutes = LADDER_MINUTES[row.attempts - 1] ?? 24 * 60;
  await db().execute(sql`
    update commerce.tripletex_sync set state = 'failed', error_key = ${failure.key.slice(0, 40)}, error_detail = null,
           request_id = ${failure.requestId ? failure.requestId.slice(0, 100) : null}, claimed_until = null,
           next_attempt_at = ${at(ctx.now, minutes)}::timestamptz, updated_at = now()
     where ${where(ctx, row.kind, row.localId)}
  `);
  ctx.run.failed += 1;
}

/** What a failure does to the row and to the run: `stop` ends the store's run (the token, or a rate limit). */
async function onFailure(ctx: Ctx, row: Claimed, failure: TripletexFailure, loaded: Loaded | null): Promise<"go_on" | "stop"> {
  switch (failure.class) {
    case "auth":
      await release(ctx, row);
      await db().execute(sql`
        update commerce.tripletex_connections set state = 'auth_failed', last_error_key = ${failure.key}, last_error_at = now(), failures_in_a_row = failures_in_a_row + 1
         where store_id = ${ctx.storeId}::uuid and state = 'on'
      `);
      log("warn", "tripletex.auth_failed", { storeId: ctx.storeId });
      return "stop";
    case "rate_limit":
      await release(ctx, row, at(ctx.now, (failure.retryAfter ?? 60) / 60));
      return "stop";
    case "transient":
    case "revision":
    case "duplicate":
      await failRow(ctx, row, failure, loaded);
      return "go_on";
    default:
      await blockRow(ctx, row, failure.key, failure.detail, loaded, failure.requestId);
      return "go_on";
  }
}

async function sendOne(ctx: Ctx, row: Claimed): Promise<"go_on" | "stop"> {
  const loaded = await loadDocument(ctx.storeId, row.kind, row.localId);
  if (!loaded) {
    await blockRow(ctx, row, "document_missing", null, null);
    return "go_on";
  }

  // A credit note waits for its invoice's voucher, when its invoice is one this connection sends.
  if (loaded.invoiceId) {
    const invoiceKind = row.kind === "work_credit_note" ? "work_invoice" : "shop_invoice";
    const invoice = await typedRow(z.object({ state: col.text }), sql`select state from commerce.tripletex_sync where ${where(ctx, invoiceKind, loaded.invoiceId)}`);
    if (invoice && invoice.state !== "synced") {
      if (invoice.state === "blocked" || invoice.state === "drifted" || invoice.state === "skipped") await blockRow(ctx, row, "waiting_for_invoice", null, loaded);
      else await release(ctx, row, at(ctx.now, 5));
      return "go_on";
    }
  }

  // Tried before: it may be booked already and its answer lost. Look it up by its external number and adopt it.
  if (row.attempts > 1) {
    const found = await ctx.session.get<{ values?: VoucherAnswer[] }>("/ledger/voucher/>externalVoucherNumber", {
      externalVoucherNumber: row.externalKey,
      fields: "id,number,year,numberAsString,postings(amountGross,amount)",
    });
    if (!found.ok) return onFailure(ctx, row, found.failure, loaded);
    const existing = found.value?.values?.[0];
    if (existing && Number.isSafeInteger(Number(existing.id))) {
      await booked(ctx, row, loaded, existing, true);
      return "go_on";
    }
  }

  const ids = await idsOf(ctx);
  if (!ids.ok) return onFailure(ctx, row, ids.failure, loaded);
  if (!ids.ids.receivableAccountId) {
    await blockRow(ctx, row, "settings_problem", null, loaded);
    return "go_on";
  }

  // Before anything is written: a document that cannot be booked as it is waits, and no customer is made for it.
  const dry = voucherBody(loaded.doc, { ...ids.ids, customerId: 1 }, { storeId: ctx.storeId, language: ctx.connection.settings.language, posting: row.posting });
  if (!dry.ok) {
    await blockRow(ctx, row, dry.code, dry.detail ?? null, loaded);
    return "go_on";
  }

  const customer = await ensureCustomer(ctx, loaded.doc.customer);
  if (!customer.ok) {
    if ("block" in customer) {
      await blockRow(ctx, row, customer.block, null, loaded);
      return "go_on";
    }
    return onFailure(ctx, row, customer.failure, loaded);
  }
  const body = voucherBody(loaded.doc, { ...ids.ids, customerId: customer.value }, { storeId: ctx.storeId, language: ctx.connection.settings.language, posting: row.posting });
  if (!body.ok) {
    await blockRow(ctx, row, body.code, body.detail ?? null, loaded);
    return "go_on";
  }
  if (body.body.externalVoucherNumber !== row.externalKey) {
    // The database's number and the code's disagree: never send under a number the lookup would not find.
    log("error", "tripletex.external_key_mismatch", { storeId: ctx.storeId, kind: row.kind });
    await blockRow(ctx, row, "totals_mismatch", null, loaded);
    return "go_on";
  }
  const posted = await ctx.session.post<{ value?: VoucherAnswer }>("/ledger/voucher", body.body, { sendToLedger: true });
  if (!posted.ok) return onFailure(ctx, row, posted.failure, loaded);
  await booked(ctx, row, loaded, posted.value?.value, false);
  return "go_on";
}

// ---------------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------------

async function syncStore(storeId: string, options: SyncOptions, run: TripletexRun, deadline: number): Promise<void> {
  const connection = await getTripletexConnection(storeId);
  if (!connection || connection.state !== "on" || !connection.settings || !connection.syncFrom) return;
  const ready = { ...connection, settings: connection.settings, syncFrom: connection.syncFrom };
  const now = (options.now ?? (() => new Date()))();
  await sweep(storeId, ready);
  const rows = await claim(storeId, ready, now);
  const wantPdf = ready.settings.attachPdf;
  if (rows.length === 0 && !(wantPdf && (await attachable(storeId, ready, now)).length > 0)) return;
  run.stores += 1;

  const ctx: Ctx = { storeId, connection: ready, session: null as unknown as TripletexSession, ids: null, chart: null, countries: null, now, run };
  const credential = await tripletexCredential(storeId);
  if (!credential) {
    for (const row of rows) await release(ctx, row);
    return;
  }
  const opened = await openSession(credential, options.deps);
  if (!opened.ok) {
    if (opened.failure.class === "auth") await onFailure(ctx, rows[0], opened.failure, null);
    for (const row of rows) await release(ctx, row, opened.failure.class === "rate_limit" ? at(now, (opened.failure.retryAfter ?? 60) / 60) : null);
    await noteConnection(storeId, opened.failure.key);
    return;
  }
  ctx.session = opened.session;

  let stopped = false;
  const before = { booked: run.sent + run.adopted, problems: run.failed + run.blocked };
  for (const row of rows) {
    if (stopped || Date.now() > deadline) {
      await release(ctx, row);
      continue;
    }
    try {
      if ((await sendOne(ctx, row)) === "stop") stopped = true;
    } catch (error) {
      log("error", "tripletex.document_failed", { storeId, kind: row.kind }, error);
      await release(ctx, row, at(now, 5));
    }
  }
  // Then the PDFs of what is booked, including what was just booked when its PDF is already made.
  if (!stopped && wantPdf && Date.now() <= deadline) {
    try {
      if ((await attachPdfs(ctx, await attachable(storeId, ready, now), options.storage)) === "stop") stopped = true;
    } catch (error) {
      log("error", "tripletex.attach_failed", { storeId }, error);
    }
  }
  const booked = run.sent + run.adopted - before.booked;
  const problems = run.failed + run.blocked - before.problems;
  if (stopped) return;
  await noteConnection(storeId, booked === 0 && problems > 0 ? "not_sent" : null);
}

// ---------------------------------------------------------------------------------------------------------------------
// The documents' PDFs
// ---------------------------------------------------------------------------------------------------------------------

/** How long, and how often, a booked document's PDF is tried: a PDF is made by its own job a few minutes after issue. */
const ATTACH_DAYS = 7;
const ATTACH_TRIES = 20;
const ATTACH_BATCH = 10;

type Attachable = { kind: "shop_invoice" | "shop_credit_note"; localId: string; theirId: number; number: string };

/** Booked shop documents of the last week whose PDF is made and not yet attached to their voucher. */
async function attachable(storeId: string, connection: Ctx["connection"], now: Date): Promise<Attachable[]> {
  const rows = await typedRows(
    z.object({ kind: z.enum(["shop_invoice", "shop_credit_note"]), local_id: col.text, their_id: col.minor, number: col.text }),
    sql`select t.kind, t.local_id, t.their_id, coalesce(si.document_number, sc.document_number) as number
          from commerce.tripletex_sync t
          left join commerce.invoices si on t.kind = 'shop_invoice' and si.store_id = t.store_id and si.id::text = t.local_id
          left join commerce.credit_notes sc on t.kind = 'shop_credit_note' and sc.store_id = t.store_id and sc.id::text = t.local_id
         where t.store_id = ${storeId}::uuid and t.mode = ${connection.mode} and t.company_id = ${connection.company.id}
           and t.kind in ('shop_invoice', 'shop_credit_note') and t.state = 'synced' and t.attached_at is null and t.their_id is not null
           and t.attach_tries < ${ATTACH_TRIES} and t.synced_at > ${now.toISOString()}::timestamptz - make_interval(days => ${ATTACH_DAYS})
           and coalesce(si.pdf_path, sc.pdf_path) is not null and coalesce(si.anonymised_at, sc.anonymised_at) is null
         order by t.synced_at
         limit ${ATTACH_BATCH}`,
  );
  return rows.map((r) => ({ kind: r.kind, localId: r.local_id, theirId: r.their_id, number: r.number }));
}

/**
 * Each document's stored PDF to its voucher's attachment (the bookkeeping document, "bilag"). A failure never touches the voucher:
 * it is counted and tried again next run, for a week at most. Stops with the store's run on a refused token or a rate limit.
 */
async function attachPdfs(ctx: Ctx, rows: readonly Attachable[], storage: DocumentStorage | null | undefined): Promise<"go_on" | "stop"> {
  for (const row of rows) {
    const bytes = await readPdf(ctx.storeId, row.kind === "shop_invoice" ? "invoice" : "credit_note", row.localId, storage === undefined ? {} : { storage });
    if (!bytes) continue;
    const sent = await ctx.session.postFile(`/ledger/voucher/${row.theirId}/attachment`, {
      name: `${row.number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`,
      type: "application/pdf",
      bytes,
    });
    if (sent.ok) {
      await db().execute(sql`update commerce.tripletex_sync set attached_at = now(), updated_at = now() where ${where(ctx, row.kind, row.localId)}`);
      ctx.run.attached += 1;
      continue;
    }
    await db().execute(sql`update commerce.tripletex_sync set attach_tries = attach_tries + 1, updated_at = now() where ${where(ctx, row.kind, row.localId)}`);
    if (sent.failure.class === "auth") {
      await db().execute(sql`
        update commerce.tripletex_connections set state = 'auth_failed', last_error_key = ${sent.failure.key}, last_error_at = now(), failures_in_a_row = failures_in_a_row + 1
         where store_id = ${ctx.storeId}::uuid and state = 'on'
      `);
      return "stop";
    }
    if (sent.failure.class === "rate_limit") return "stop";
  }
  return "go_on";
}

/** The connection's last good contact and last problem, for the card and the alerts. */
async function noteConnection(storeId: string, problem: string | null): Promise<void> {
  if (problem === null) {
    await db().execute(sql`update commerce.tripletex_connections set last_ok_at = now(), failures_in_a_row = 0 where store_id = ${storeId}::uuid`);
  } else {
    await db().execute(sql`
      update commerce.tripletex_connections set last_error_key = ${problem.slice(0, 40)}, last_error_at = now(), failures_in_a_row = failures_in_a_row + 1
       where store_id = ${storeId}::uuid
    `);
  }
}

/**
 * The five-minute job: every store whose connection is on and which is open, one at a time, within a time budget so a slow
 * Tripletex never holds the dispatcher up. Never throws.
 */
export async function syncDueTripletex(options: SyncOptions = {}): Promise<TripletexRun> {
  const run: TripletexRun = { stores: 0, sent: 0, adopted: 0, failed: 0, blocked: 0, waiting: 0, attached: 0, alerted: 0 };
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS);
  let stores: { id: string; timeZone: string }[];
  try {
    const rows = await typedRows(
      z.object({ store_id: col.uuid, time_zone: col.text }),
      sql`select c.store_id, s.time_zone from commerce.tripletex_connections c join commerce.stores s on s.id = c.store_id
           where c.state in ('on', 'auth_failed') and s.status = 'active' order by c.last_ok_at nulls first`,
    );
    stores = rows.map((r) => ({ id: r.store_id, timeZone: r.time_zone })).filter((store) => !options.storeIds || options.storeIds.includes(store.id));
  } catch (error) {
    log("error", "tripletex.run_failed", {}, error);
    return run;
  }
  const now = (options.now ?? (() => new Date()))();
  for (const store of stores) {
    if (Date.now() > deadline) break;
    try {
      await syncStore(store.id, options, run, deadline);
    } catch (error) {
      log("error", "tripletex.store_failed", { storeId: store.id }, error);
    }
    // What needs a person, told once a day while it lasts (the alert's own recipients, owners by default).
    try {
      const attention = await tripletexAttention(store.id);
      if (attention && (attention.tokenRefused || attention.waiting > 0)) {
        const sent = await (options.alert ?? sendAccountingAlert)(store.id, attention, todayIn(now, store.timeZone));
        if (sent && sent.sent > 0) run.alerted += 1;
      }
    } catch (error) {
      log("error", "tripletex.alert_failed", { storeId: store.id }, error);
    }
  }
  return run;
}

/**
 * Try again: documents that wait for a person or failed go back to the queue, their tries counted again from the start (an
 * owner's or an admin's press, or the AI manager's on the owner's yes). A row tried before keeps one try, so its next send
 * looks its voucher up first. Only those with the given reasons, when given. Returns how many.
 */
export async function retryTripletex(
  storeId: string,
  options: { errorKeys?: readonly string[]; kind?: Kind; localId?: string; accountId?: string } = {},
): Promise<number> {
  const connection = await getTripletexConnection(storeId);
  if (!connection) return 0;
  const rows = await db().execute(sql`
    update commerce.tripletex_sync set state = 'pending', attempts = least(attempts, 1), next_attempt_at = null, claimed_until = null, error_key = null, error_detail = null, updated_at = now()
     where store_id = ${storeId}::uuid and mode = ${connection.mode} and company_id = ${connection.company.id} and kind <> 'customer'
       and state in ('failed', 'blocked')
       ${options.errorKeys && options.errorKeys.length > 0 ? sql`and error_key in (${sql.join(options.errorKeys.map((k) => sql`${k}`), sql`, `)})` : sql``}
       ${options.kind ? sql`and kind = ${options.kind}` : sql``}
       ${options.localId ? sql`and local_id = ${options.localId}` : sql``}
    returning local_id
  `);
  // A person's press is written down (the sync's own re-tries after a settings change are not: the save is).
  if (options.accountId && rows.length > 0) await audit(options.accountId, storeId, "integration.tripletex_retried", { count: rows.length, ...(options.kind ? { kind: options.kind } : {}) });
  return rows.length;
}
