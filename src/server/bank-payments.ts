import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { matchInvoices, type InvoiceMatchKind } from "@/lib/bank-invoices";

import { audit, type Membership } from "./auth";
import { BANK_ACCOUNT } from "./bank-statements";
import { postWorkPaymentNow } from "./ledger";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";
import { recordPayment } from "./work-invoices";

/**
 * A client's payment on the bank's statement paying the Work invoice it names (B4 of `docs/own-books-and-sales.md`, D487). The store's
 * open invoices are compared with the statement's lines of money in not yet matched to the books (`matchInvoices()`): a line that names an
 * invoice and pays exactly what is outstanding records the payment when the statement is read; the others are offered to the owner on
 * the Books screen, one press each. A payment recorded so is an ordinary Work payment (by bank, on the day the bank booked it), posted to
 * the books at once and matched to its line.
 */

const OPEN_INVOICE = z.object({
  id: col.uuid,
  printed_number: col.text,
  number: col.minorOrNull,
  client: col.text,
  currency: col.currency,
  issued_on: col.text,
  outstanding_minor: col.minor,
});

const MONEY_IN = z.object({ id: col.uuid, day: col.text, amount_minor: col.minor, currency: col.currency, text: col.text, reference: col.textOrNull, counterparty: col.textOrNull });

export type InvoiceOffer = { invoiceId: string; printedNumber: string; client: string; outstandingMinor: number; kind: InvoiceMatchKind };

/** The invoice each line of money in of a book most likely pays, by the line's id. */
export async function invoiceOffers(storeId: string, bookId: string): Promise<Map<string, InvoiceOffer>> {
  const lines = await typedRows(
    MONEY_IN,
    sql`select id, booked_on::text as day, amount_minor, currency, text, reference, counterparty from commerce.bank_lines
         where store_id = ${storeId}::uuid and book_id = ${bookId}::uuid and ledger_account = ${BANK_ACCOUNT}
           and entry_id is null and amount_minor > 0`,
  );
  if (lines.length === 0) return new Map();
  const invoices = await typedRows(
    OPEN_INVOICE,
    sql`
      select i.id, coalesce(case when i.imported then i.legacy_number else i.document_number end, '') as printed_number,
             case when i.imported then null else i.number end as number,
             coalesce(nullif(i.buyer ->> 'name', ''), c.name) as client, i.currency, i.issued_on::text, a.outstanding_minor
        from commerce.work_invoices i
        join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
        cross join lateral commerce.work_invoice_amounts(i.store_id, i.id) a
       where i.store_id = ${storeId}::uuid and i.status = 'sent' and i.issued_on is not null and a.outstanding_minor > 0`,
  );
  if (invoices.length === 0) return new Map();
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const matches = matchInvoices(
    lines.map((l) => ({ id: l.id, day: l.day, amountMinor: l.amount_minor, currency: l.currency, text: l.text, reference: l.reference, counterparty: l.counterparty })),
    invoices.map((i) => ({
      id: i.id,
      printedNumber: i.printed_number,
      number: i.number,
      client: i.client,
      currency: i.currency,
      issuedOn: i.issued_on,
      outstandingMinor: i.outstanding_minor,
    })),
  );
  const out = new Map<string, InvoiceOffer>();
  for (const m of matches) {
    const invoice = byId.get(m.invoiceId)!;
    out.set(m.lineId, { invoiceId: invoice.id, printedNumber: invoice.printed_number, client: invoice.client, outstandingMinor: invoice.outstanding_minor, kind: m.kind });
  }
  return out;
}

export type PayProblem = "line" | "invoice";

/**
 * Records a line of the statement as the payment of a Work invoice (the owner's press, or a certain match when the statement is read):
 * paid by bank on the day the bank booked it, as much as the line, with what the bank says of it (the payer, the words, the reference). The payment is posted to the books at once
 * and matched to the line; when it cannot be posted yet, it waits for the ledger's job, which matches it after. Audited.
 */
export async function payInvoiceFromBank(
  member: Membership,
  lineId: string,
  invoiceId: string,
): Promise<{ ok: true; printedNumber: string } | { ok: false; problem: PayProblem }> {
  const storeId = member.store.id;
  const line = await typedRow(
    MONEY_IN,
    sql`select b.id, b.booked_on::text as day, b.amount_minor, b.currency, b.text, b.reference, b.counterparty
          from commerce.bank_lines b join commerce.ledger_books k on k.id = b.book_id
         where b.id = ${lineId}::uuid and b.store_id = ${storeId}::uuid and b.ledger_account = ${BANK_ACCOUNT}
           and b.entry_id is null and b.amount_minor > 0 and k.closed_on is null`,
  );
  if (!line) return { ok: false, problem: "line" };
  const invoice = await typedRow(
    z.object({ printed_number: col.text, currency: col.currency }),
    sql`select coalesce(case when imported then legacy_number else document_number end, '') as printed_number, currency
          from commerce.work_invoices where store_id = ${storeId}::uuid and id = ${invoiceId}::uuid`,
  );
  if (!invoice || invoice.currency !== line.currency) return { ok: false, problem: "invoice" };
  const recorded = await recordPayment(member, {
    invoiceId,
    amountMinor: line.amount_minor,
    receivedOn: line.day,
    method: "bank",
    reference: [line.counterparty, line.text, line.reference].filter(Boolean).join(" · ").slice(0, 200) || undefined,
  });
  if (!recorded.ok) return { ok: false, problem: "invoice" };
  const entryId = await postWorkPaymentNow(storeId, recorded.paymentId);
  if (entryId) {
    try {
      await db().execute(sql`
        update commerce.bank_lines set entry_id = ${entryId}::uuid, matched_at = now()
         where id = ${lineId}::uuid and store_id = ${storeId}::uuid and entry_id is null`);
    } catch (error) {
      // The entry was matched to another line meanwhile: this one waits for the matching.
      log("info", "bank.payment_match_taken", { storeId, lineId }, error);
    }
  }
  await audit(member.account.id, storeId, "work.bank_payment_recorded", { lineId, invoiceId, paymentId: recorded.paymentId, posted: entryId !== null });
  return { ok: true, printedNumber: invoice.printed_number };
}

/** Records every certain match of the store's open book (see `matchInvoices()`); returns the numbers of the invoices paid. */
export async function payCertainInvoices(member: Membership): Promise<string[]> {
  const book = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.ledger_books where store_id = ${member.store.id}::uuid and closed_on is null`,
  );
  if (!book) return [];
  const offers = await invoiceOffers(member.store.id, book.id);
  const paid: string[] = [];
  for (const [lineId, offer] of offers) {
    if (offer.kind !== "certain") continue;
    const done = await payInvoiceFromBank(member, lineId, offer.invoiceId);
    if (done.ok) paid.push(done.printedNumber);
  }
  return paid;
}
