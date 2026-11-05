import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { customerKey, type CustomerRef } from "@/lib/accounting-docs";
import { todayIn } from "@/lib/analytics-period";
import { idFromLocation, saleNumberOf } from "@/lib/fiken";
import { fikenFailure, type FikenFailure } from "@/lib/fiken-errors";
import { sameSale, saleBody, shopContactBody, totalsOf, workContactBody, type ContactBody, type SaleAnswer } from "@/lib/fiken-map";
import type { FikenSettings } from "@/lib/fiken-settings";
import { stableJson } from "@/lib/tripletex-map";

import { loadDocument, type DocumentKind, type LoadedDocument } from "./accounting-documents";
import { audit } from "./auth";
import { fikenAccess, fikenAttention, getFikenConnection, type FikenConnection } from "./fiken";
import { fikenApi, type FikenApi, type FikenDeps } from "./fiken-client";
import { readPdf, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { sendAccountingAlert } from "./staff-alerts";
import { col, typedRow, typedRows } from "./typed-rows";
import { workEvent } from "./work";

/**
 * Fiken (D460): sending a store's documents, the only writer of `commerce.fiken_sync`. The same engine as Tripletex's (D453): every five
 * minutes, per store whose connection is on, one store at a time (Fiken takes one call at a time), it finds the invoices and credit notes
 * issued since `sync_from` that have no row yet, claims the due ones (`for update skip locked`, then a claim that expires, so two runs never
 * send the same row), and sends each: its customer contact first (found by organisation number, made once, sent again only when something on
 * it changed), then the sale. Before a sale is made, Fiken is asked for a sale with its number: the same sale (a lost answer, or the owner's
 * own booking of it by hand) is adopted, another one waits for a person, so nothing is ever booked twice. A failure is classified: tried
 * again on a ladder, waited out (a rate limit), stopped for the whole store (the grant is over), or left for a person with a reason in
 * words. Never throws for one store or one document; never puts a token, a body or a person's data in a log or a row.
 */

const BATCH = 25;
const BUDGET_MS = 40_000;
const CLAIM_MINUTES = 5;
/** Minutes before each automatic retry (D41's ladder), then once a day, then a person decides. */
const LADDER_MINUTES = [1, 5, 30, 120, 360];
const DAILY_TRIES = 14;

export type FikenRun = { stores: number; sent: number; adopted: number; failed: number; blocked: number; attached: number; alerted: number };

export type FikenSyncOptions = {
  now?: () => Date;
  deps?: FikenDeps;
  storeIds?: readonly string[];
  budgetMs?: number;
  /** Where the documents' PDFs are kept (tests pass one in memory); the private bucket by default. */
  storage?: DocumentStorage | null;
  /** The daily alert's sender (tests pass their own); `sendAccountingAlert()` by default. */
  alert?: typeof sendAccountingAlert;
};

type Claimed = { kind: DocumentKind; localId: string; attempts: number; externalKey: string };

type Ready = FikenConnection & { company: NonNullable<FikenConnection["company"]>; settings: FikenSettings; syncFrom: string };

type Ctx = { storeId: string; connection: Ready; slug: string; api: FikenApi; now: Date; run: FikenRun };

const at = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

// ---------------------------------------------------------------------------------------------------------------------
// Finding and claiming
// ---------------------------------------------------------------------------------------------------------------------

/** Rows for the documents issued since the start day that have none: invoices before their credit notes. The sale number is the document's. */
async function sweep(storeId: string, connection: Ready): Promise<void> {
  const slug = connection.company.slug;
  const from = connection.syncFrom;
  if (connection.settings.sources.work) {
    await db().execute(sql`
      insert into commerce.fiken_sync (store_id, company_slug, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${slug}, 'work_invoice', id::text, document_number, total_minor, currency
        from commerce.work_invoices
       where store_id = ${storeId}::uuid and status <> 'draft' and not imported and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
    await db().execute(sql`
      insert into commerce.fiken_sync (store_id, company_slug, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${slug}, 'work_credit_note', id::text, document_number, total_minor, currency
        from commerce.work_credit_notes
       where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
  }
  if (connection.settings.sources.shop) {
    await db().execute(sql`
      insert into commerce.fiken_sync (store_id, company_slug, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${slug}, 'shop_invoice', id::text, document_number, total_minor, currency
        from commerce.invoices
       where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
    await db().execute(sql`
      insert into commerce.fiken_sync (store_id, company_slug, kind, local_id, external_key, amount_minor, currency)
      select store_id, ${slug}, 'shop_credit_note', id::text, document_number, total_minor, currency
        from commerce.credit_notes
       where store_id = ${storeId}::uuid and length(document_number) between 1 and 50 and issued_on >= ${from}::date
      on conflict do nothing
    `);
  }
}

async function claim(storeId: string, slug: string, now: Date): Promise<Claimed[]> {
  const rows = await typedRows(
    z.object({ kind: z.enum(["work_invoice", "work_credit_note", "shop_invoice", "shop_credit_note"]), local_id: col.text, attempts: col.int, external_key: col.text }),
    sql`
      with due as (
        select store_id, company_slug, kind, local_id from commerce.fiken_sync
         where store_id = ${storeId}::uuid and company_slug = ${slug} and kind <> 'customer'
           and ((state in ('pending', 'failed') and coalesce(next_attempt_at, '-infinity') <= ${now.toISOString()}::timestamptz)
             or (state = 'sending' and claimed_until < ${now.toISOString()}::timestamptz))
         order by case when kind in ('work_invoice', 'shop_invoice') then 0 else 1 end, created_at, local_id
         limit ${BATCH}
         for update skip locked
      )
      update commerce.fiken_sync f
         set state = 'sending', claimed_until = ${at(now, CLAIM_MINUTES)}::timestamptz, attempts = f.attempts + 1, updated_at = now()
        from due
       where f.store_id = due.store_id and f.company_slug = due.company_slug and f.kind = due.kind and f.local_id = due.local_id
      returning f.kind, f.local_id, f.attempts, f.external_key
    `,
  );
  const order = (k: DocumentKind) => (k === "work_invoice" || k === "shop_invoice" ? 0 : 1);
  return rows.map((r) => ({ kind: r.kind, localId: r.local_id, attempts: r.attempts, externalKey: r.external_key })).sort((a, b) => order(a.kind) - order(b.kind));
}

const where = (ctx: Pick<Ctx, "storeId" | "slug">, kind: string, localId: string) =>
  sql`store_id = ${ctx.storeId}::uuid and company_slug = ${ctx.slug} and kind = ${kind} and local_id = ${localId}`;

/** Gives a claimed row back untried (the run stopped before it): as it was, without counting the try. */
async function release(ctx: Pick<Ctx, "storeId" | "slug">, row: Claimed, nextAt: string | null = null): Promise<void> {
  await db().execute(sql`
    update commerce.fiken_sync set state = case when attempts > 1 then 'failed' else 'pending' end, attempts = greatest(attempts - 1, 0),
           claimed_until = null, next_attempt_at = ${nextAt}::timestamptz, updated_at = now()
     where ${where(ctx, row.kind, row.localId)} and state = 'sending'
  `);
}

// ---------------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------------

type Outcome<T> = { ok: true; value: T } | { ok: false; failure: FikenFailure } | { ok: false; block: string };

const hashOf = (body: ContactBody) => createHash("sha256").update(stableJson(body)).digest("hex").slice(0, 32);

async function contactBodyOf(ctx: Ctx, ref: CustomerRef): Promise<ContactBody | null> {
  if (ref.kind !== "work_client") return shopContactBody(ref, ctx.connection.settings.language);
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
  return workContactBody(
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
    { sendContactEmail: ctx.connection.settings.sendContactEmail },
  );
}

/** The customer's contact id in Fiken: kept, found by organisation number, or made; sent again when something on it changed. */
async function ensureContact(ctx: Ctx, ref: CustomerRef): Promise<Outcome<number>> {
  const key = customerKey(ref);
  const body = await contactBodyOf(ctx, ref);
  if (!body) return { ok: false, block: "customer_missing" };
  const hash = hashOf(body);
  const kept = await typedRow(z.object({ their_id: col.minorOrNull, content_hash: col.textOrNull }), sql`select their_id, content_hash from commerce.fiken_sync where ${where(ctx, "customer", key)}`);
  const remember = async (id: number) => {
    await db().execute(sql`
      insert into commerce.fiken_sync (store_id, company_slug, kind, local_id, their_id, content_hash, state, synced_at)
      values (${ctx.storeId}::uuid, ${ctx.slug}, 'customer', ${key}, ${id}, ${hash}, 'synced', now())
      on conflict (store_id, company_slug, kind, local_id) do update set
        their_id = excluded.their_id, content_hash = excluded.content_hash, state = 'synced', synced_at = now(), error_key = null, error_detail = null, updated_at = now()
    `);
  };
  const base = `/companies/${ctx.slug}/contacts`;

  if (kept?.their_id) {
    if (kept.content_hash === hash) return { ok: true, value: kept.their_id };
    // Something we send changed: the contact again (deleted in Fiken: found or made again below).
    const put = await ctx.api.put(`${base}/${kept.their_id}`, body);
    if (put.ok) {
      await remember(kept.their_id);
      return { ok: true, value: kept.their_id };
    }
    if (put.failure.class !== "drift") return { ok: false, failure: put.failure };
  }

  if (body.organizationNumber) {
    const found = await ctx.api.get<{ contactId?: unknown; inactive?: unknown }[]>(base, { organizationNumber: body.organizationNumber, customer: true, page: 0, pageSize: 2 });
    if (!found.ok) return { ok: false, failure: found.failure };
    const first = (Array.isArray(found.value) ? found.value : []).find((c) => c.inactive !== true);
    const id = Number(first?.contactId);
    if (Number.isSafeInteger(id) && id > 0) {
      // An existing contact is adopted as it is: the accountant's own details on it are not overwritten.
      await remember(id);
      return { ok: true, value: id };
    }
  }
  const made = await ctx.api.post(base, body);
  if (!made.ok) return { ok: false, failure: made.failure };
  const id = idFromLocation(made.location, "contacts");
  if (!id) return { ok: false, failure: fikenFailure("bad_answer", "transient") };
  await remember(id);
  return { ok: true, value: id };
}

// ---------------------------------------------------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------------------------------------------------

/** The journal entry number people read in Fiken for a sale (`Bilag 18`), when Fiken says it. */
async function entryNumberOf(ctx: Ctx, transactionId: unknown): Promise<string | null> {
  const id = Number(transactionId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const read = await ctx.api.get<{ entries?: { journalEntryNumber?: unknown }[] }>(`/companies/${ctx.slug}/transactions/${id}`);
  const number = read.ok ? read.value?.entries?.[0]?.journalEntryNumber : undefined;
  return typeof number === "number" && Number.isSafeInteger(number) ? String(number) : null;
}

async function booked(ctx: Ctx, row: Claimed, loaded: LoadedDocument, sale: SaleAnswer, expected: { vat: number }, adopted: boolean): Promise<void> {
  const id = Number(sale.saleId);
  const vat = Number(sale.vatAmount);
  const sign = loaded.doc.kind === "invoice" ? 1 : -1;
  const variance = Number.isSafeInteger(vat) && vat !== expected.vat ? sign * (vat - expected.vat) : null;
  const ref = await entryNumberOf(ctx, sale.transactionId);
  await db().execute(sql`
    update commerce.fiken_sync set state = 'synced', their_id = ${id}, their_ref = ${ref}, variance_minor = ${variance}, synced_at = now(),
           error_key = null, error_detail = null, request_id = null, claimed_until = null, next_attempt_at = null, updated_at = now()
     where ${where(ctx, row.kind, row.localId)}
  `);
  if (loaded.workInvoiceId) {
    await workEvent(db(), ctx.storeId, "invoice", loaded.workInvoiceId, "fiken.synced", { document: loaded.doc.documentNumber, entry: ref, adopted, variance }, null);
  }
  if (adopted) ctx.run.adopted += 1;
  else ctx.run.sent += 1;
}

/** A document that waits for a person, with its reason; once a day at most in Work's history. */
async function blockRow(ctx: Ctx, row: Claimed, key: string, detail: string | null, loaded: LoadedDocument | null, requestId: string | null = null): Promise<void> {
  await db().execute(sql`
    update commerce.fiken_sync set state = 'blocked', error_key = ${key.slice(0, 40)}, error_detail = ${detail ? detail.slice(0, 400) : null},
           request_id = ${requestId ? requestId.slice(0, 100) : null}, claimed_until = null, next_attempt_at = null, updated_at = now()
     where ${where(ctx, row.kind, row.localId)}
  `);
  ctx.run.blocked += 1;
  if (loaded?.workInvoiceId) {
    const [recent] = await db().execute(sql`
      select 1 from commerce.work_events where store_id = ${ctx.storeId}::uuid and entity_type = 'invoice' and entity_id = ${loaded.workInvoiceId}::uuid
         and type = 'fiken.blocked' and created_at > now() - interval '1 day' limit 1
    `);
    if (!recent) await workEvent(db(), ctx.storeId, "invoice", loaded.workInvoiceId, "fiken.blocked", { document: loaded.doc.documentNumber, reason: key }, null);
  }
}

/** A failure that is tried again by itself: the ladder, then daily, then a person. */
async function failRow(ctx: Ctx, row: Claimed, failure: FikenFailure, loaded: LoadedDocument | null): Promise<void> {
  if (row.attempts > LADDER_MINUTES.length + DAILY_TRIES) {
    await blockRow(ctx, row, failure.key, failure.detail, loaded, failure.requestId);
    return;
  }
  const minutes = LADDER_MINUTES[row.attempts - 1] ?? 24 * 60;
  await db().execute(sql`
    update commerce.fiken_sync set state = 'failed', error_key = ${failure.key.slice(0, 40)}, error_detail = null,
           request_id = ${failure.requestId ? failure.requestId.slice(0, 100) : null}, claimed_until = null,
           next_attempt_at = ${at(ctx.now, minutes)}::timestamptz, updated_at = now()
     where ${where(ctx, row.kind, row.localId)}
  `);
  ctx.run.failed += 1;
}

/** The connection stops: Fiken no longer takes the grant. Everything waits until the owner connects again. */
async function grantRefused(storeId: string, key: string): Promise<void> {
  await db().execute(sql`
    update commerce.fiken_connections set state = 'auth_failed', last_error_key = ${key.slice(0, 40)}, last_error_at = now(), failures_in_a_row = failures_in_a_row + 1
     where store_id = ${storeId}::uuid and state = 'on'
  `);
  log("warn", "fiken.auth_failed", { storeId });
}

/** What a failure does to the row and to the run: `stop` ends the store's run (the grant, or a rate limit). */
async function onFailure(ctx: Ctx, row: Claimed, failure: FikenFailure, loaded: LoadedDocument | null): Promise<"go_on" | "stop"> {
  switch (failure.class) {
    case "auth":
      await release(ctx, row);
      await grantRefused(ctx.storeId, failure.key);
      return "stop";
    case "rate_limit":
      await release(ctx, row, at(ctx.now, (failure.retryAfter ?? 60) / 60));
      return "stop";
    case "transient":
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

  // A credit note waits for its invoice's sale, when its invoice is one this connection sends.
  if (loaded.invoiceId) {
    const invoiceKind = row.kind === "work_credit_note" ? "work_invoice" : "shop_invoice";
    const invoice = await typedRow(z.object({ state: col.text }), sql`select state from commerce.fiken_sync where ${where(ctx, invoiceKind, loaded.invoiceId)}`);
    if (invoice && invoice.state !== "synced") {
      if (invoice.state === "blocked" || invoice.state === "drifted" || invoice.state === "skipped") await blockRow(ctx, row, "waiting_for_invoice", null, loaded);
      else await release(ctx, row, at(ctx.now, 5));
      return "go_on";
    }
  }

  // Before anything is written: a document that cannot be booked as it is waits, and no contact is made for it.
  const settings = ctx.connection.settings;
  const dry = saleBody(loaded.doc, { customerId: 1, bookings: settings.bookings, language: settings.language });
  if (!dry.ok) {
    await blockRow(ctx, row, dry.code, dry.detail ?? null, loaded);
    return "go_on";
  }
  if (saleNumberOf(loaded.doc.documentNumber) !== row.externalKey) {
    // The database's number and the code's disagree: never send under a number the lookup would not find.
    log("error", "fiken.sale_number_mismatch", { storeId: ctx.storeId, kind: row.kind });
    await blockRow(ctx, row, "totals_mismatch", null, loaded);
    return "go_on";
  }

  // Fiken may have this sale already (an answer lost, or the owner's own booking by hand): the same one is adopted, another one waits.
  const sales = `/companies/${ctx.slug}/sales`;
  const found = await ctx.api.get<SaleAnswer[]>(sales, { saleNumber: row.externalKey, page: 0, pageSize: 10 });
  if (!found.ok) return onFailure(ctx, row, found.failure, loaded);
  const there = (Array.isArray(found.value) ? found.value : []).filter((s) => s.deleted !== true);
  const expected = totalsOf(dry.body);
  const same = there.find((s) => sameSale(s, dry.body));
  if (same && Number.isSafeInteger(Number(same.saleId))) {
    await booked(ctx, row, loaded, same, expected, true);
    return "go_on";
  }
  if (there.length > 0) {
    await blockRow(ctx, row, "number_taken", null, loaded);
    return "go_on";
  }

  const contact = await ensureContact(ctx, loaded.doc.customer);
  if (!contact.ok) {
    if ("block" in contact) {
      await blockRow(ctx, row, contact.block, null, loaded);
      return "go_on";
    }
    return onFailure(ctx, row, contact.failure, loaded);
  }
  const body = saleBody(loaded.doc, { customerId: contact.value, bookings: settings.bookings, language: settings.language });
  if (!body.ok) {
    await blockRow(ctx, row, body.code, body.detail ?? null, loaded);
    return "go_on";
  }
  const made = await ctx.api.post(sales, body.body);
  if (!made.ok) return onFailure(ctx, row, made.failure, loaded);
  const saleId = idFromLocation(made.location, "sales");
  if (!saleId) {
    // Made, but its address was not given: the next try finds it by its number and adopts it.
    await failRow(ctx, row, fikenFailure("bad_answer", "transient"), loaded);
    return "go_on";
  }
  const read = await ctx.api.get<SaleAnswer>(`${sales}/${saleId}`);
  await booked(ctx, row, loaded, read.ok && read.value ? { ...read.value, saleId } : { saleId }, expected, false);
  return "go_on";
}

// ---------------------------------------------------------------------------------------------------------------------
// The documents' PDFs
// ---------------------------------------------------------------------------------------------------------------------

const ATTACH_DAYS = 7;
const ATTACH_TRIES = 20;
const ATTACH_BATCH = 10;

type Attachable = { kind: "shop_invoice" | "shop_credit_note"; localId: string; theirId: number; number: string };

/** Booked shop documents of the last week whose PDF is made and not yet attached to their sale. */
async function attachable(storeId: string, slug: string, now: Date): Promise<Attachable[]> {
  const rows = await typedRows(
    z.object({ kind: z.enum(["shop_invoice", "shop_credit_note"]), local_id: col.text, their_id: col.minor, number: col.text }),
    sql`select f.kind, f.local_id, f.their_id, coalesce(si.document_number, sc.document_number) as number
          from commerce.fiken_sync f
          left join commerce.invoices si on f.kind = 'shop_invoice' and si.store_id = f.store_id and si.id::text = f.local_id
          left join commerce.credit_notes sc on f.kind = 'shop_credit_note' and sc.store_id = f.store_id and sc.id::text = f.local_id
         where f.store_id = ${storeId}::uuid and f.company_slug = ${slug}
           and f.kind in ('shop_invoice', 'shop_credit_note') and f.state = 'synced' and f.attached_at is null and f.their_id is not null
           and f.attach_tries < ${ATTACH_TRIES} and f.synced_at > ${now.toISOString()}::timestamptz - make_interval(days => ${ATTACH_DAYS})
           and coalesce(si.pdf_path, sc.pdf_path) is not null and coalesce(si.anonymised_at, sc.anonymised_at) is null
         order by f.synced_at
         limit ${ATTACH_BATCH}`,
  );
  return rows.map((r) => ({ kind: r.kind, localId: r.local_id, theirId: r.their_id, number: r.number }));
}

/** Each document's stored PDF to its sale, as the document of the sale. A failure never touches the sale: counted, tried next run, for a week. */
async function attachPdfs(ctx: Ctx, rows: readonly Attachable[], storage: DocumentStorage | null | undefined): Promise<"go_on" | "stop"> {
  for (const row of rows) {
    const bytes = await readPdf(ctx.storeId, row.kind === "shop_invoice" ? "invoice" : "credit_note", row.localId, storage === undefined ? {} : { storage });
    if (!bytes) continue;
    const sent = await ctx.api.postFile(
      `/companies/${ctx.slug}/sales/${row.theirId}/attachments`,
      { name: `${row.number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`, type: "application/pdf", bytes },
      { attachToSale: true, attachToPayment: false },
    );
    if (sent.ok) {
      await db().execute(sql`update commerce.fiken_sync set attached_at = now(), updated_at = now() where ${where(ctx, row.kind, row.localId)}`);
      ctx.run.attached += 1;
      continue;
    }
    await db().execute(sql`update commerce.fiken_sync set attach_tries = attach_tries + 1, updated_at = now() where ${where(ctx, row.kind, row.localId)}`);
    if (sent.failure.class === "auth") {
      await grantRefused(ctx.storeId, sent.failure.key);
      return "stop";
    }
    if (sent.failure.class === "rate_limit") return "stop";
  }
  return "go_on";
}

/** The connection's last good contact and last problem, for the card and the alerts. */
async function noteConnection(storeId: string, problem: string | null): Promise<void> {
  if (problem === null) {
    await db().execute(sql`update commerce.fiken_connections set last_ok_at = now(), failures_in_a_row = 0 where store_id = ${storeId}::uuid`);
  } else {
    await db().execute(sql`
      update commerce.fiken_connections set last_error_key = ${problem.slice(0, 40)}, last_error_at = now(), failures_in_a_row = failures_in_a_row + 1 where store_id = ${storeId}::uuid
    `);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------------

async function syncStore(storeId: string, options: FikenSyncOptions, run: FikenRun, deadline: number): Promise<void> {
  const connection = await getFikenConnection(storeId);
  if (!connection || connection.state !== "on" || !connection.company || !connection.settings || !connection.syncFrom) return;
  const ready: Ready = { ...connection, company: connection.company, settings: connection.settings, syncFrom: connection.syncFrom };
  const slug = ready.company.slug;
  const now = (options.now ?? (() => new Date()))();
  await sweep(storeId, ready);
  const rows = await claim(storeId, slug, now);
  const wantPdf = ready.settings.attachPdf;
  if (rows.length === 0 && !(wantPdf && (await attachable(storeId, slug, now)).length > 0)) return;
  run.stores += 1;

  const access = await fikenAccess(storeId, options.deps);
  if (!access.ok) {
    const failure = access.failure;
    for (const row of rows) await release({ storeId, slug }, row, failure?.class === "rate_limit" ? at(now, (failure.retryAfter ?? 60) / 60) : null);
    await noteConnection(storeId, access.problem === "grant_refused" ? "http_401" : (failure?.key ?? access.problem));
    return;
  }
  const ctx: Ctx = { storeId, connection: ready, slug, api: fikenApi(access.token, options.deps), now, run };

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
      log("error", "fiken.document_failed", { storeId, kind: row.kind }, error);
      await release(ctx, row, at(now, 5));
    }
  }
  if (!stopped && wantPdf && Date.now() <= deadline) {
    try {
      if ((await attachPdfs(ctx, await attachable(storeId, slug, now), options.storage)) === "stop") stopped = true;
    } catch (error) {
      log("error", "fiken.attach_failed", { storeId }, error);
    }
  }
  const booked = run.sent + run.adopted - before.booked;
  const problems = run.failed + run.blocked - before.problems;
  if (stopped) return;
  await noteConnection(storeId, booked === 0 && problems > 0 ? "not_sent" : null);
}

/** The five-minute job: every store whose connection is on and which is open, one at a time, within a time budget. Never throws. */
export async function syncDueFiken(options: FikenSyncOptions = {}): Promise<FikenRun> {
  const run: FikenRun = { stores: 0, sent: 0, adopted: 0, failed: 0, blocked: 0, attached: 0, alerted: 0 };
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS);
  let stores: { id: string; timeZone: string }[];
  try {
    const rows = await typedRows(
      z.object({ store_id: col.uuid, time_zone: col.text }),
      sql`select c.store_id, s.time_zone from commerce.fiken_connections c join commerce.stores s on s.id = c.store_id
           where c.state in ('on', 'auth_failed') and s.status = 'active' order by c.last_ok_at nulls first`,
    );
    stores = rows.map((r) => ({ id: r.store_id, timeZone: r.time_zone })).filter((store) => !options.storeIds || options.storeIds.includes(store.id));
  } catch (error) {
    log("error", "fiken.run_failed", {}, error);
    return run;
  }
  const now = (options.now ?? (() => new Date()))();
  for (const store of stores) {
    if (Date.now() > deadline) break;
    try {
      await syncStore(store.id, options, run, deadline);
    } catch (error) {
      log("error", "fiken.store_failed", { storeId: store.id }, error);
    }
    // What needs a person, told once a day while it lasts (the alert's own recipients, owners by default).
    try {
      const attention = await fikenAttention(store.id);
      if (attention && (attention.tokenRefused || attention.waiting > 0)) {
        const sent = await (options.alert ?? sendAccountingAlert)(store.id, attention, todayIn(now, store.timeZone), undefined, "fiken");
        if (sent && sent.sent > 0) run.alerted += 1;
      }
    } catch (error) {
      log("error", "fiken.alert_failed", { storeId: store.id }, error);
    }
  }
  return run;
}

/**
 * Try again: documents that wait for a person or failed go back to the queue, their tries counted again from the start (an owner's press).
 * Only those with the given reasons, when given. Returns how many.
 */
export async function retryFiken(storeId: string, options: { errorKeys?: readonly string[]; kind?: DocumentKind; localId?: string; accountId?: string } = {}): Promise<number> {
  const connection = await getFikenConnection(storeId);
  if (!connection?.company) return 0;
  const rows = await db().execute(sql`
    update commerce.fiken_sync set state = 'pending', attempts = least(attempts, 1), next_attempt_at = null, claimed_until = null, error_key = null, error_detail = null, updated_at = now()
     where store_id = ${storeId}::uuid and company_slug = ${connection.company.slug} and kind <> 'customer' and state in ('failed', 'blocked')
       ${options.errorKeys && options.errorKeys.length > 0 ? sql`and error_key in (${sql.join(options.errorKeys.map((k) => sql`${k}`), sql`, `)})` : sql``}
       ${options.kind ? sql`and kind = ${options.kind}` : sql``}
       ${options.localId ? sql`and local_id = ${options.localId}` : sql``}
    returning local_id
  `);
  if (options.accountId && rows.length > 0) await audit(options.accountId, storeId, "integration.fiken_retried", { count: rows.length, ...(options.kind ? { kind: options.kind } : {}) });
  return rows.length;
}

/** Check in Fiken (read-only): is a booked document's sale still there? A sale deleted in Fiken turns the row `drifted`; Post again is the owner's. */
export async function checkFikenDocument(storeId: string, kind: DocumentKind, localId: string, deps: FikenDeps = {}): Promise<"booked" | "gone" | "not_booked" | "cannot_check"> {
  const connection = await getFikenConnection(storeId);
  if (!connection?.company) return "not_booked";
  const slug = connection.company.slug;
  const row = await typedRow(
    z.object({ their_id: col.minorOrNull, state: col.text }),
    sql`select their_id, state from commerce.fiken_sync where store_id = ${storeId}::uuid and company_slug = ${slug} and kind = ${kind} and local_id = ${localId}`,
  );
  if (!row?.their_id || row.state !== "synced") return "not_booked";
  const access = await fikenAccess(storeId, deps);
  if (!access.ok) return "cannot_check";
  const read = await fikenApi(access.token, deps).get<SaleAnswer>(`/companies/${slug}/sales/${row.their_id}`);
  if (read.ok && read.value?.deleted !== true) return "booked";
  if (!read.ok && read.failure.class !== "drift") return "cannot_check";
  await db().execute(sql`
    update commerce.fiken_sync set state = 'drifted', error_key = 'http_404', error_detail = null, updated_at = now()
     where store_id = ${storeId}::uuid and company_slug = ${slug} and kind = ${kind} and local_id = ${localId} and state = 'synced'
  `);
  return "gone";
}

/**
 * Post again: a document whose sale was deleted in Fiken is booked anew under its own number (a deleted sale is reversed in Fiken and never
 * adopted, so the lookup finds nothing in its way). The owner's press, audited.
 */
export async function postFikenAgain(storeId: string, kind: DocumentKind, localId: string, accountId: string): Promise<boolean> {
  const connection = await getFikenConnection(storeId);
  if (!connection?.company) return false;
  const rows = await db().execute(sql`
    update commerce.fiken_sync
       set state = 'pending', posting = posting + 1, their_id = null, their_ref = null, variance_minor = null, synced_at = null, attempts = 0,
           next_attempt_at = null, claimed_until = null, error_key = null, error_detail = null, request_id = null, attached_at = null, attach_tries = 0, updated_at = now()
     where store_id = ${storeId}::uuid and company_slug = ${connection.company.slug} and kind = ${kind} and local_id = ${localId} and state = 'drifted'
    returning posting
  `);
  if (rows.length === 0) return false;
  await audit(accountId, storeId, "integration.fiken_posted_again", { kind, posting: Number((rows[0] as { posting: unknown }).posting) });
  return true;
}
