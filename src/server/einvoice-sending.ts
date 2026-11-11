import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { ScreensMessages } from "@/lib/admin-messages/screens.en";
import { adminText } from "@/lib/admin-text";
import { participantOf, type PeppolDocument } from "@/lib/peppol";
import { workDocumentUbl } from "@/lib/work-einvoice";

import { configuredAccessPoint, type AccessPoint } from "./access-point";
import { documentUbl } from "./einvoices";
import { log } from "./log";
import { prunePeppolReceivers, receiverOf, type Lookup } from "./peppol-lookup";
import { col, typedRows } from "./typed-rows";
import { creditNoteDocumentData, invoiceDocumentData } from "./work-invoices";

/**
 * Sending sales documents as e-invoices (B1 of `docs/own-books-and-sales.md`, D463), a job of the five-minute dispatcher. Every invoice and
 * credit note issued to a business in the last two days (a shop's, D159, and Work's, D122) is looked at once: its buyer's participant from
 * the document's own country and organisation number (`participantOf()`), its UBL from the frozen document (`documentUbl()`,
 * `workDocumentUbl()`), and the network asked whether the buyer receives that document (`receiverOf()`). Then it is
 * - `not_valid` when EN 16931 would reject it (the reasons kept, for staff to see),
 * - `not_receiver` when the buyer does not receive it on Peppol (it went by email, as every document does today),
 * - `waiting` when the buyer does but no access point is connected (also by email; never sent later, so nothing goes twice), or
 * - `pending`, then handed to the access point (`sent`), tried again with a growing wait when it fails, and `refused` when the access
 *   point or the receiver turns it down; an access point that reports deliveries moves it to `delivered`.
 * A document issued before `EINVOICES_FROM` is never looked at. A lookup that could not finish leaves the document for the next run.
 */

export const EINVOICES_FROM = "2026-11-07";
const WINDOW_DAYS = 2;
const MAX_ATTEMPTS = 6;
const BATCH = 50;
/** Batches a run looks at, at most: 20 of up to 50 of each kind of document. */
const PAGES = 20;

export type DocType = "invoice" | "credit_note" | "work_invoice" | "work_credit_note";

const candidate = z.object({
  type: z.enum(["invoice", "credit_note", "work_invoice", "work_credit_note"]),
  store_id: col.uuid,
  id: col.uuid,
  buyer_country: col.textOrNull,
  buyer_org: col.textOrNull,
  seller_country: col.textOrNull,
  seller_org: col.textOrNull,
});
type Candidate = z.infer<typeof candidate>;

const peppolDocument = (type: DocType): PeppolDocument => (type === "invoice" || type === "work_invoice" ? "invoice" : "credit_note");

/** Documents issued to a business within the window that the job has not looked at yet. */
async function candidates(since: string, skip: readonly string[]): Promise<Candidate[]> {
  // Those this run has looked at already: a business with no Peppol number is never recorded (it went by email), so without this it would
  // keep its place in every batch, and past 50 such documents in the window the newer ones were never looked at.
  const seen = skip.length > 0 ? sql`array[${sql.join(skip.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]` : sql`'{}'::uuid[]`;
  return typedRows(
    candidate,
    sql`
      (select 'invoice' as type, i.store_id, i.id,
              i.snapshot -> 'buyer' -> 'address' ->> 'country' as buyer_country, i.snapshot -> 'buyer' ->> 'organisationNumber' as buyer_org,
              i.snapshot -> 'seller' ->> 'country' as seller_country, i.snapshot -> 'seller' ->> 'organisationNumber' as seller_org
       from commerce.invoices i
       where i.issued_on >= ${since}::date and i.anonymised_at is null and i.snapshot -> 'buyer' ->> 'type' = 'business'
         and not exists (select 1 from commerce.einvoice_sends e where e.store_id = i.store_id and e.document_type = 'invoice' and e.document_id = i.id)
         and not (i.id = any(${seen}))
       limit ${BATCH})
      union all
      (select 'credit_note', c.store_id, c.id,
              c.snapshot -> 'buyer' -> 'address' ->> 'country', c.snapshot -> 'buyer' ->> 'organisationNumber',
              c.snapshot -> 'seller' ->> 'country', c.snapshot -> 'seller' ->> 'organisationNumber'
       from commerce.credit_notes c
       where c.issued_on >= ${since}::date and c.anonymised_at is null and c.snapshot -> 'buyer' ->> 'type' = 'business'
         and not exists (select 1 from commerce.einvoice_sends e where e.store_id = c.store_id and e.document_type = 'credit_note' and e.document_id = c.id)
         and not (c.id = any(${seen}))
       limit ${BATCH})
      union all
      (select 'work_invoice', w.store_id, w.id, w.buyer ->> 'country', w.buyer ->> 'organisation_number', w.seller ->> 'country', w.seller ->> 'organisation_number'
       from commerce.work_invoices w
       where w.status <> 'draft' and not w.imported and w.issued_on >= ${since}::date and (w.buyer ->> 'business')::boolean is true
         and not exists (select 1 from commerce.einvoice_sends e where e.store_id = w.store_id and e.document_type = 'work_invoice' and e.document_id = w.id)
         and not (w.id = any(${seen}))
       limit ${BATCH})
      union all
      (select 'work_credit_note', n.store_id, n.id, n.buyer ->> 'country', n.buyer ->> 'organisation_number', n.seller ->> 'country', n.seller ->> 'organisation_number'
       from commerce.work_credit_notes n
       where n.issued_on >= ${since}::date and (n.buyer ->> 'business')::boolean is true
         and not exists (select 1 from commerce.einvoice_sends e where e.store_id = n.store_id and e.document_type = 'work_credit_note' and e.document_id = n.id)
         and not (n.id = any(${seen}))
       limit ${BATCH})
    `,
  );
}

/** The document's UBL, or why it cannot be one; null when the document is gone or anonymised. */
async function ublOf(storeId: string, type: DocType, id: string): Promise<{ ok: true; xml: string } | { ok: false; problems: string[] } | null> {
  if (type === "invoice" || type === "credit_note") return documentUbl(storeId, type, id);
  const doc = type === "work_invoice" ? await invoiceDocumentData(storeId, id) : await creditNoteDocumentData(storeId, id);
  return doc ? workDocumentUbl(doc) : null;
}

async function record(c: Pick<Candidate, "store_id" | "type" | "id">, state: string, problem: string | null, now: Date): Promise<void> {
  await db().execute(sql`
    insert into commerce.einvoice_sends (store_id, document_type, document_id, state, problem, next_attempt_at)
    values (${c.store_id}::uuid, ${c.type}, ${c.id}::uuid, ${state}, ${problem}, ${state === "pending" ? sql`${now.toISOString()}::timestamptz` : sql`null`})
    on conflict (store_id, document_type, document_id) do nothing
  `);
}

/** Looks at one new document and decides its state. Never throws. */
async function decide(c: Candidate, deps: { lookup?: Lookup; accessPoint: AccessPoint | null; now: Date }): Promise<string | null> {
  try {
    const receiver = participantOf(c.buyer_country, c.buyer_org);
    // A business with no organisation number in a scheme here is not on Peppol: nothing to record, it went by email.
    if (!receiver) return null;
    const ubl = await ublOf(c.store_id, c.type, c.id);
    if (!ubl) return null;
    if (!ubl.ok) {
      await record(c, "not_valid", ubl.problems.join(","), deps.now);
      return "not_valid";
    }
    if (!participantOf(c.seller_country, c.seller_org)) {
      await record(c, "not_valid", "seller_organisation_number", deps.now);
      return "not_valid";
    }
    const answer = await receiverOf(receiver, { lookup: deps.lookup, now: deps.now });
    // The network could not tell: the document stays new and is asked about again on the next run.
    if (answer.problem) return null;
    const receives = peppolDocument(c.type) === "invoice" ? answer.invoice : answer.creditNote;
    const state = !receives ? "not_receiver" : deps.accessPoint ? "pending" : "waiting";
    await record(c, state, null, deps.now);
    return state;
  } catch (error) {
    log("error", "einvoice.decide_failed", { storeId: c.store_id, type: c.type }, error);
    return null;
  }
}

const due = z.object({ id: col.uuid, store_id: col.uuid, document_type: candidate.shape.type, document_id: col.uuid, attempts: col.int });
const waitAfter = (attempts: number) => Math.min(6 * 3600, 60 * 2 ** attempts) * 1000;

/** Hands the documents that are due to the access point, each once at a time. */
async function sendDue(accessPoint: AccessPoint, now: Date): Promise<{ sent: number; failed: number; refused: number }> {
  const out = { sent: 0, failed: 0, refused: 0 };
  const rows = await typedRows(
    due,
    sql`select id, store_id, document_type, document_id, attempts from commerce.einvoice_sends
        where state in ('pending', 'failed') and next_attempt_at <= ${now.toISOString()}::timestamptz
        order by next_attempt_at limit ${BATCH}`,
  );
  for (const row of rows) {
    const parties = await typedRows(
      candidate.pick({ buyer_country: true, buyer_org: true, seller_country: true, seller_org: true }),
      row.document_type === "invoice" || row.document_type === "credit_note"
        ? sql`select snapshot -> 'buyer' -> 'address' ->> 'country' as buyer_country, snapshot -> 'buyer' ->> 'organisationNumber' as buyer_org,
                     snapshot -> 'seller' ->> 'country' as seller_country, snapshot -> 'seller' ->> 'organisationNumber' as seller_org
              from ${row.document_type === "invoice" ? sql`commerce.invoices` : sql`commerce.credit_notes`}
              where store_id = ${row.store_id}::uuid and id = ${row.document_id}::uuid and anonymised_at is null`
        : // Work's documents keep their parties as they were issued, with snake_case keys (`commerce.issue_work_invoice()`).
          sql`select buyer ->> 'country' as buyer_country, buyer ->> 'organisation_number' as buyer_org, seller ->> 'country' as seller_country,
                     seller ->> 'organisation_number' as seller_org
              from ${row.document_type === "work_invoice" ? sql`commerce.work_invoices` : sql`commerce.work_credit_notes`}
              where store_id = ${row.store_id}::uuid and id = ${row.document_id}::uuid`,
    );
    const p = parties[0];
    const receiver = p ? participantOf(p.buyer_country, p.buyer_org) : null;
    const sender = p ? participantOf(p.seller_country, p.seller_org) : null;
    const ubl = p ? await ublOf(row.store_id, row.document_type, row.document_id) : null;
    if (!receiver || !sender || !ubl || !ubl.ok) {
      await db().execute(sql`update commerce.einvoice_sends set state = 'not_valid', problem = 'document_changed', next_attempt_at = null, updated_at = now() where id = ${row.id}::uuid`);
      continue;
    }
    const result = await accessPoint
      .send({ xml: ubl.xml, document: peppolDocument(row.document_type), sender, receiver, reference: row.id })
      .catch((error: unknown): { ok: false; problem: string; retry: boolean } => {
        log("warn", "einvoice.send_threw", { storeId: row.store_id, accessPoint: accessPoint.name }, error);
        return { ok: false, problem: "network", retry: true };
      });
    if (result.ok) {
      await db().execute(sql`
        update commerce.einvoice_sends
        set state = 'sent', access_point = ${accessPoint.name}, message_id = ${result.messageId}, sent_at = ${now.toISOString()}::timestamptz,
            attempts = attempts + 1, problem = null, next_attempt_at = null, updated_at = now()
        where id = ${row.id}::uuid
      `);
      out.sent++;
    } else if (result.retry && row.attempts + 1 < MAX_ATTEMPTS) {
      await db().execute(sql`
        update commerce.einvoice_sends
        set state = 'failed', problem = ${result.problem}, attempts = attempts + 1,
            next_attempt_at = ${new Date(now.getTime() + waitAfter(row.attempts + 1)).toISOString()}::timestamptz, updated_at = now()
        where id = ${row.id}::uuid
      `);
      out.failed++;
    } else {
      await db().execute(sql`
        update commerce.einvoice_sends set state = 'refused', problem = ${result.problem}, attempts = attempts + 1, next_attempt_at = null, updated_at = now()
        where id = ${row.id}::uuid
      `);
      out.refused++;
    }
  }
  return out;
}

const sentRow = z.object({ id: col.uuid, message_id: col.text });

/** Asks the access point what became of messages handed over in the last two weeks, where it can tell. */
async function followUp(accessPoint: AccessPoint, now: Date): Promise<number> {
  if (!accessPoint.status) return 0;
  const rows = await typedRows(
    sentRow,
    sql`select id, message_id from commerce.einvoice_sends
        where state = 'sent' and access_point = ${accessPoint.name} and sent_at > ${new Date(now.getTime() - 14 * 24 * 3600_000).toISOString()}::timestamptz
        order by sent_at limit ${BATCH}`,
  );
  let moved = 0;
  for (const row of rows) {
    const status = await accessPoint.status(row.message_id).catch(() => null);
    if (!status || status.state === "sent") continue;
    await db().execute(sql`
      update commerce.einvoice_sends
      set state = ${status.state}, problem = ${status.state === "refused" ? (status.problem ?? "receiver_refused") : null},
          delivered_at = ${status.state === "delivered" ? sql`now()` : sql`null`}, updated_at = now()
      where id = ${row.id}::uuid and state = 'sent'
    `);
    moved++;
  }
  return moved;
}

/** One run of the job: new documents decided, due ones sent, sent ones followed up, old register answers forgotten. */
export async function runEinvoiceSending(
  deps: { now?: Date; lookup?: Lookup; accessPoint?: AccessPoint | null; from?: string } = {},
): Promise<Record<string, number>> {
  const now = deps.now ?? new Date();
  const accessPoint = deps.accessPoint === undefined ? configuredAccessPoint() : deps.accessPoint;
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
  const from = deps.from ?? EINVOICES_FROM;
  const since = windowStart > from ? windowStart : from;
  const counts: Record<string, number> = { looked: 0, not_valid: 0, not_receiver: 0, waiting: 0, pending: 0, sent: 0, failed: 0, refused: 0, followed: 0 };
  // Batch after batch until none is left in the window, each leaving out what this run has looked at (at most `PAGES` batches a run).
  const looked: string[] = [];
  for (let page = 0; page < PAGES; page++) {
    const batch = await candidates(since, looked);
    if (batch.length === 0) break;
    for (const c of batch) {
      looked.push(c.id);
      const state = await decide(c, { lookup: deps.lookup, accessPoint, now });
      counts.looked++;
      if (state) counts[state] = (counts[state] ?? 0) + 1;
    }
  }
  if (accessPoint) {
    const sent = await sendDue(accessPoint, now);
    counts.sent = sent.sent;
    counts.failed = sent.failed;
    counts.refused = sent.refused;
    counts.followed = await followUp(accessPoint, now);
  }
  counts.forgotten = await prunePeppolReceivers(now);
  return counts;
}

const stateRow = z.object({ document_type: candidate.shape.type, document_id: col.uuid, state: col.text, problem: col.textOrNull });
export type EinvoiceState = { state: string; problem: string | null };

/** The e-invoice state of a store's documents, by `type:id`, for the pages that list them. */
export async function einvoiceStates(storeId: string, documents: readonly { type: DocType; id: string }[]): Promise<Map<string, EinvoiceState>> {
  const out = new Map<string, EinvoiceState>();
  if (documents.length === 0) return out;
  const ids = [...new Set(documents.map((d) => d.id))];
  const rows = await typedRows(
    stateRow,
    sql`select document_type, document_id, state, problem from commerce.einvoice_sends
        where store_id = ${storeId}::uuid and document_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
  );
  for (const r of rows) out.set(`${r.document_type}:${r.document_id}`, { state: r.state, problem: r.problem });
  return out;
}

/** One document's e-invoice line in the reader's words: the state, and for a refusal or a document that cannot be one, why. */
export function einvoiceLine(state: EinvoiceState, words: ScreensMessages["einvoiceState"], problemWords: Readonly<Record<string, string>>): string {
  const problems = (state.problem ?? "")
    .split(",")
    .filter(Boolean)
    .map((key) => problemWords[key] ?? words.problems[key] ?? key)
    .join("; ");
  const template = (words as unknown as Record<string, string>)[state.state];
  return typeof template === "string" ? fillWords(template, { problems }) : state.state;
}

/** Each document's e-invoice line in the reader's language, by `type:id`; none for a document the job has not looked at (a consumer's, or not yet). */
export async function einvoiceLines(storeId: string, documents: readonly { type: DocType; id: string }[], lang: AdminLang): Promise<Record<string, string>> {
  const states = await einvoiceStates(storeId, documents);
  const words = adminText(lang, "screens").einvoiceState;
  const problems = adminText(lang, "invoices").einvoice.problems as Record<string, string>;
  return Object.fromEntries([...states].map(([key, state]) => [key, einvoiceLine(state, words, problems)]));
}

/** A Work invoice or credit note as UBL for staff (`…/xml`), or why it cannot be one; null for another store's or a draft. */
export async function workDocumentUblOf(storeId: string, kind: "invoice" | "credit_note", id: string) {
  const doc = kind === "invoice" ? await invoiceDocumentData(storeId, id) : await creditNoteDocumentData(storeId, id);
  if (!doc || (doc.kind === "invoice" && doc.draft)) return null;
  return workDocumentUbl(doc);
}
