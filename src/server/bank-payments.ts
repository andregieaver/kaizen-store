import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { matchInvoices, type InvoiceMatchKind, type OpenInvoice } from "@/lib/bank-invoices";
import { BANK_OWN_ACCOUNTS, bankOwnKind, entryOfBankOwnLine, type BankOwnKind } from "@/lib/bank-own-lines";
import { MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";

import { audit, type Membership } from "./auth";
import { BANK_ACCOUNT } from "./bank-statements";
import { addLedgerAccount, ledgerAccounts, postLedgerEntry, postShopPaymentNow, postWorkPaymentNow, type PostProblem } from "./ledger";
import { log } from "./log";
import { recordTermsPaidOutside } from "./payment-terms";
import { col, typedRow, typedRows } from "./typed-rows";
import { recordPayment } from "./work-invoices";

/**
 * A client's payment on the bank's statement paying the invoice it names (B4 of `docs/own-books-and-sales.md`, D487): a Work invoice, or a
 * shop's order on payment terms (D293, its invoice's number or the order's). The store's open ones are compared with the statement's lines of
 * money in not yet matched to the books (`matchInvoices()`): a line that names one and pays exactly what is outstanding records the payment
 * when the statement is read; the others are offered to the owner on the Books screen, one press each. A payment recorded so is an ordinary
 * one (a Work payment by bank, or money received outside towards the balance on terms, by bank transfer), on the day the bank booked it,
 * posted to the books at once and matched to its line.
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

const OPEN_ORDER = OPEN_INVOICE.extend({ order_number: col.text, paid_from: col.text });

const MONEY_IN = z.object({ id: col.uuid, day: col.text, amount_minor: col.minor, currency: col.currency, text: col.text, reference: col.textOrNull, counterparty: col.textOrNull });

export type InvoiceOffer = {
  invoiceId: string;
  /** A Work invoice, or a shop's order on terms (whose id this is). */
  source: "work" | "shop";
  printedNumber: string;
  /** A shop's order's own number. */
  orderNumber: string | null;
  client: string;
  outstandingMinor: number;
  kind: InvoiceMatchKind;
};

type Open = OpenInvoice & { source: "work" | "shop"; orderNumber: string | null };

/** The store's open Work invoices, and its shop's orders on terms with a balance (their invoice's number, and the order's). */
async function openDocuments(storeId: string): Promise<Open[]> {
  const [work, shop] = await Promise.all([
    typedRows(
      OPEN_INVOICE,
      sql`
        select i.id, coalesce(case when i.imported then i.legacy_number else i.document_number end, '') as printed_number,
               case when i.imported then null else i.number end as number,
               coalesce(nullif(i.buyer ->> 'name', ''), c.name) as client, i.currency, i.issued_on::text, a.outstanding_minor
          from commerce.work_invoices i
          join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
          cross join lateral commerce.work_invoice_amounts(i.store_id, i.id) a
         where i.store_id = ${storeId}::uuid and i.status = 'sent' and i.issued_on is not null and a.outstanding_minor > 0`,
    ),
    typedRows(
      OPEN_ORDER,
      sql`
        select o.id, coalesce(inv.document_number, o.number) as printed_number, inv.number, o.number as order_number,
               coalesce(co.name, '') as client, trim(o.currency) as currency,
               coalesce(inv.issued_on, (o.placed_at at time zone s.time_zone)::date)::text as issued_on, o.balance_minor as outstanding_minor,
               (commerce.store_day(o.store_id, now()) - ${MANUAL_RECEIVED_DAYS_MAX}::int)::text as paid_from
          from commerce.orders o
          join commerce.order_payment_terms t on t.store_id = o.store_id and t.order_id = o.id
          join commerce.stores s on s.id = o.store_id
          left join commerce.customer_companies co on co.store_id = t.store_id and co.id = t.company_id
          left join lateral (
            select i.document_number, i.number, i.issued_on from commerce.invoices i
             where i.store_id = o.store_id and i.order_id = o.id and i.kind = 'order' order by i.issued_at limit 1
          ) inv on true
         where o.store_id = ${storeId}::uuid and t.paid_at is null and o.status in ('paid', 'fulfilled') and o.balance_minor > 0
           and o.copied_from is null`,
    ),
  ]);
  return [
    ...work.map((i): Open => ({
      id: i.id,
      source: "work",
      printedNumber: i.printed_number,
      number: i.number,
      orderNumber: null,
      client: i.client,
      currency: i.currency,
      issuedOn: i.issued_on,
      outstandingMinor: i.outstanding_minor,
    })),
    ...shop.map((o): Open => ({
      id: o.id,
      source: "shop",
      printedNumber: o.printed_number,
      number: o.number,
      alsoNamed: [o.order_number],
      orderNumber: o.order_number,
      client: o.client,
      currency: o.currency,
      issuedOn: o.issued_on,
      outstandingMinor: o.outstanding_minor,
      paidFrom: o.paid_from,
    })),
  ];
}

/** The invoice each line of money in of a book most likely pays, by the line's id. */
export async function invoiceOffers(storeId: string, bookId: string): Promise<Map<string, InvoiceOffer>> {
  const lines = await typedRows(
    MONEY_IN,
    sql`select id, booked_on::text as day, amount_minor, currency, text, reference, counterparty from commerce.bank_lines
         where store_id = ${storeId}::uuid and book_id = ${bookId}::uuid and ledger_account = ${BANK_ACCOUNT}
           and entry_id is null and payment_ref is null and amount_minor > 0`,
  );
  if (lines.length === 0) return new Map();
  const open = await openDocuments(storeId);
  if (open.length === 0) return new Map();
  const byId = new Map(open.map((d) => [d.id, d]));
  const matches = matchInvoices(
    lines.map((l) => ({ id: l.id, day: l.day, amountMinor: l.amount_minor, currency: l.currency, text: l.text, reference: l.reference, counterparty: l.counterparty })),
    open,
  );
  const out = new Map<string, InvoiceOffer>();
  for (const m of matches) {
    const d = byId.get(m.invoiceId)!;
    out.set(m.lineId, {
      invoiceId: d.id,
      source: d.source,
      printedNumber: d.printedNumber,
      orderNumber: d.orderNumber,
      client: d.client,
      outstandingMinor: d.outstandingMinor,
      kind: m.kind,
    });
  }
  return out;
}

export type PayProblem = "line" | "invoice";

/**
 * Records a line of the statement as the payment of an open invoice (the owner's press, or a certain match when the statement is read):
 * paid by bank on the day the bank booked it, as much as the line, with what the bank says of it (the payer, the words, the reference) as
 * its reference. A Work invoice through `recordPayment()`, a shop's order on terms through `recordTermsPaidOutside()` (which takes money of
 * the last 31 days). The payment is posted to the books at once and matched to the line; when it cannot be posted yet, it waits for the
 * ledger's job, which matches it after. Audited.
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
           and b.entry_id is null and b.payment_ref is null and b.amount_minor > 0 and k.closed_on is null`,
  );
  if (!line) return { ok: false, problem: "line" };
  const reference = [line.counterparty, line.text, line.reference].filter(Boolean).join(" · ").slice(0, 200) || undefined;
  const open = (await openDocuments(storeId)).find((d) => d.id === invoiceId);
  if (!open || open.currency !== line.currency) return { ok: false, problem: "invoice" };
  let paymentId: string | null = null;
  let entryId: string | null = null;
  if (open.source === "work") {
    const recorded = await recordPayment(member, { invoiceId, amountMinor: line.amount_minor, receivedOn: line.day, method: "bank", reference });
    if (!recorded.ok) return { ok: false, problem: "invoice" };
    paymentId = recorded.paymentId;
    entryId = await postWorkPaymentNow(storeId, paymentId);
  } else {
    const recorded = await recordTermsPaidOutside(
      storeId,
      invoiceId,
      { method: "bank_transfer", receivedOn: line.day, amountMinor: line.amount_minor, ...(reference ? { reference } : {}) },
      member.account.id,
    );
    if (!recorded.ok) return { ok: false, problem: "invoice" };
    // The payment just written: the order's newest by bank of the line's amount and day.
    const payment = await typedRow(
      z.object({ id: col.uuid }),
      sql`select id from commerce.payments
           where store_id = ${storeId}::uuid and order_id = ${invoiceId}::uuid and provider = 'manual' and method = 'bank_transfer'
             and status = 'captured' and amount_minor = ${line.amount_minor} and received_on = ${line.day}::date
           order by created_at desc limit 1`,
    );
    paymentId = payment?.id ?? null;
    entryId = paymentId ? await postShopPaymentNow(storeId, paymentId) : null;
  }
  if (entryId) {
    try {
      await db().execute(sql`
        update commerce.bank_lines set entry_id = ${entryId}::uuid, matched_at = now()
         where id = ${lineId}::uuid and store_id = ${storeId}::uuid and entry_id is null`);
    } catch (error) {
      // The entry was matched to another line meanwhile: this one waits for the matching.
      log("info", "bank.payment_match_taken", { storeId, lineId }, error);
    }
  } else if (paymentId) {
    // Paid with no entry in the books (D495): money before the books opened (in the opening balance), or an invoice that is not in these
    // books. The line has done its work: it is never offered again, nor left waiting for an entry.
    await db().execute(sql`
      update commerce.bank_lines set payment_ref = ${`${open.source}_payment:${paymentId}`}
       where id = ${lineId}::uuid and store_id = ${storeId}::uuid and entry_id is null and payment_ref is null`);
  }
  await audit(member.account.id, storeId, "work.bank_payment_recorded", { lineId, invoiceId, source: open.source, paymentId, posted: entryId !== null });
  return { ok: true, printedNumber: open.printedNumber };
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

/**
 * Posts one of the bank's own lines, a fee or interest (D488, `bankOwnKind()`), against the bank's account in the bank's series on its day,
 * no VAT, once for the line, and matches the line to it (the owner's press). The account is added to the chart when the book has not got it.
 * Audited.
 */
export async function postBankOwnLine(
  member: Membership,
  lineId: string,
): Promise<{ ok: true; kind: BankOwnKind; account: number } | { ok: false; problem: "line" | "kind" | PostProblem }> {
  const storeId = member.store.id;
  const line = await typedRow(
    z.object({ id: col.uuid, book_id: col.uuid, day: col.text, amount_minor: col.minor, text: col.text }),
    sql`select b.id, b.book_id, b.booked_on::text as day, b.amount_minor, b.text
          from commerce.bank_lines b join commerce.ledger_books k on k.id = b.book_id
         where b.id = ${lineId}::uuid and b.store_id = ${storeId}::uuid and b.ledger_account = ${BANK_ACCOUNT}
           and b.entry_id is null and b.payment_ref is null and k.closed_on is null`,
  );
  if (!line) return { ok: false, problem: "line" };
  const kind = bankOwnKind({ amountMinor: line.amount_minor, text: line.text });
  if (!kind) return { ok: false, problem: "kind" };
  const account = BANK_OWN_ACCOUNTS[kind];
  if (!(await ledgerAccounts(line.book_id)).some((a) => a.number === account)) await addLedgerAccount(storeId, line.book_id, { number: account });
  const posted = await postLedgerEntry(line.book_id, entryOfBankOwnLine({ id: line.id, day: line.day, amountMinor: line.amount_minor, text: line.text }, kind), member.account.id);
  if (!posted.ok) return { ok: false, problem: posted.problems[0] };
  try {
    await db().execute(sql`
      update commerce.bank_lines set entry_id = ${posted.id}::uuid, matched_at = now()
       where id = ${lineId}::uuid and store_id = ${storeId}::uuid and entry_id is null`);
  } catch (error) {
    log("info", "bank.own_line_match_taken", { storeId, lineId }, error);
  }
  await audit(member.account.id, storeId, "work.bank_line_posted", { lineId, kind, account, entryId: posted.id });
  return { ok: true, kind, account };
}
