import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { InvoiceMatchKind } from "@/lib/bank-invoices";
import { INPUT_VAT, PURCHASE_KINDS, vatRateOf, voucherTypeOf, type PurchaseKind, type PurchaseVatRate } from "@/lib/purchases";
import { entryOfBill, entryOfBillPayment, matchBills, PAYABLE_ACCOUNT } from "@/lib/supplier-invoices";

import { audit, type Membership } from "./auth";
import { BANK_ACCOUNT } from "./bank-statements";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { addLedgerAccount, ledgerAccounts, postLedgerEntry, type PostProblem } from "./ledger";
import { log } from "./log";
import { VOUCHER_BYTES } from "./purchases";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Suppliers' invoices, a store's bills (B3 of `docs/own-books-and-sales.md`, D492): the owner adds a bill as it comes (the supplier, its number,
 * its days, its amount, what it was and its VAT, and the PDF or photo, kept first as the entry's voucher), it is posted against what the
 * store owes (`entryOfBill()`), and it waits, unpaid, with its due day; when the bank's statement shows its payment the line is matched to it
 * (`matchBills()`): its number in the line and exactly its amount is recorded when the statement is read, the others offered for one press,
 * and the payment posted against the bank (`entryOfBillPayment()`). A supplier is kept by name as a bill first names it.
 */

export type BillInput = {
  supplier: string;
  organisationNumber?: string | null;
  number?: string | null;
  issuedOn: string;
  dueOn?: string | null;
  totalMinor: number;
  kind: PurchaseKind;
  vatRate: PurchaseVatRate;
  text?: string | null;
};

export type BillProblem = "book" | "file" | "type" | "too_big" | "storage" | "duplicate" | "days" | "amount" | PostProblem;

const day = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);

/** Adds a bill: its voucher kept, its entry posted, the supplier kept or found by name. Owner's; audited. */
export async function addBill(
  member: Membership,
  input: BillInput,
  file: { name: string; bytes: Uint8Array },
  deps: { storage?: DocumentStorage | null } = {},
): Promise<{ ok: true; billId: string; entryId: string } | { ok: false; problem: BillProblem }> {
  const storeId = member.store.id;
  const book = await typedRow(
    z.object({ id: col.uuid, currency: col.currency }),
    sql`select id, currency from commerce.ledger_books where store_id = ${storeId}::uuid and closed_on is null`,
  );
  if (!book) return { ok: false, problem: "book" };
  const issuedOn = day(input.issuedOn);
  const dueOn = input.dueOn ? day(input.dueOn) : null;
  if (!issuedOn || (input.dueOn && !dueOn) || (dueOn && dueOn < issuedOn)) return { ok: false, problem: "days" };
  if (!Number.isSafeInteger(input.totalMinor) || input.totalMinor <= 0) return { ok: false, problem: "amount" };
  if (file.bytes.length === 0) return { ok: false, problem: "file" };
  if (file.bytes.length > VOUCHER_BYTES) return { ok: false, problem: "too_big" };
  const type = voucherTypeOf(file.bytes);
  if (!type) return { ok: false, problem: "type" };
  const name = input.supplier.trim().replace(/\s+/g, " ").slice(0, 120);
  const number = input.number?.trim().slice(0, 60) || null;

  // The supplier, by name; its organisation number kept when given.
  const org = input.organisationNumber?.trim() || null;
  const supplier = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.suppliers (store_id, name, organisation_number, usual_kind) values (${storeId}::uuid, ${name}, ${org}, ${input.kind})
        on conflict (store_id, lower(name)) do update set
          organisation_number = coalesce(excluded.organisation_number, commerce.suppliers.organisation_number),
          usual_kind = excluded.usual_kind, updated_at = now()
        returning id`,
  );
  if (!supplier) return { ok: false, problem: "book" };
  if (number) {
    const twice = await typedRow(
      z.object({ id: col.uuid }),
      sql`select id from commerce.supplier_invoices where store_id = ${storeId}::uuid and supplier_id = ${supplier.id}::uuid and number = ${number}`,
    );
    if (twice) return { ok: false, problem: "duplicate" };
  }

  const billId = randomUUID();
  const text = (input.text?.trim() || `${name}${number ? `, faktura ${number}` : ""}`).slice(0, 200);
  const entry = entryOfBill({ id: billId, day: issuedOn, totalMinor: input.totalMinor, kind: input.kind, vatRate: input.vatRate, text });
  const rate = vatRateOf(input.kind, input.vatRate);
  const needed = [PURCHASE_KINDS[input.kind].account, PAYABLE_ACCOUNT, ...(rate === 0 ? [] : [INPUT_VAT[rate].account])];
  const have = new Set((await ledgerAccounts(book.id)).map((a) => a.number));
  for (const n of needed) if (!have.has(n)) await addLedgerAccount(storeId, book.id, { number: n });

  // The bill's file is kept first: an entry is never posted without its voucher.
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  if (!storage) return { ok: false, problem: "storage" };
  const voucherId = randomUUID();
  const path = `${storeId}/vouchers/${voucherId}.${type.ext}`;
  if (!(await storage.upload(path, file.bytes, type.contentType))) return { ok: false, problem: "storage" };
  const posted = await postLedgerEntry(book.id, entry, member.account.id);
  if (!posted.ok) {
    await storage.remove([path]);
    return { ok: false, problem: posted.problems[0] };
  }
  const fileName = file.name.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 200) || `faktura.${type.ext}`;
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      insert into commerce.supplier_invoices (id, store_id, book_id, supplier_id, number, issued_on, due_on, total_minor, currency, kind, vat_rate, text, entry_id, created_by)
      values (${billId}::uuid, ${storeId}::uuid, ${book.id}::uuid, ${supplier.id}::uuid, ${number}, ${issuedOn}::date, ${dueOn}::date, ${input.totalMinor}, ${book.currency},
              ${input.kind}, ${rate}, ${text}, ${posted.id}::uuid, ${member.account.id}::uuid)`);
    await tx.execute(sql`
      insert into commerce.ledger_vouchers (id, store_id, book_id, entry_id, file_path, file_name, content_type, size_bytes, sha256, uploaded_by)
      values (${voucherId}::uuid, ${storeId}::uuid, ${book.id}::uuid, ${posted.id}::uuid, ${path}, ${fileName}, ${type.contentType}, ${file.bytes.length},
              ${createHash("sha256").update(file.bytes).digest("hex")}, ${member.account.id}::uuid)`);
  });
  await audit(member.account.id, storeId, "work.supplier_invoice_added", { billId, entryId: posted.id, supplierId: supplier.id, totalMinor: input.totalMinor });
  return { ok: true, billId, entryId: posted.id };
}

export type BillView = {
  id: string;
  supplier: string;
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  totalMinor: number;
  text: string;
  entryId: string;
};

const BILL = z.object({
  id: col.uuid,
  supplier: col.text,
  number: col.textOrNull,
  issued_on: col.text,
  due_on: col.textOrNull,
  total_minor: col.minor,
  currency: col.currency,
  text: col.text,
  entry_id: col.uuid,
});

/** A book's unpaid bills, the soonest due first (those with no due day last). */
export async function unpaidBills(storeId: string, bookId: string, limit = 50): Promise<BillView[]> {
  const rows = await typedRows(
    BILL,
    sql`select b.id, s.name as supplier, b.number, b.issued_on::text, b.due_on::text, b.total_minor, b.currency, b.text, b.entry_id
          from commerce.supplier_invoices b join commerce.suppliers s on s.store_id = b.store_id and s.id = b.supplier_id
         where b.store_id = ${storeId}::uuid and b.book_id = ${bookId}::uuid and b.paid_entry_id is null
         order by b.due_on nulls last, b.issued_on, b.id limit ${limit}`,
  );
  return rows.map((r) => ({ id: r.id, supplier: r.supplier, number: r.number, issuedOn: r.issued_on, dueOn: r.due_on, totalMinor: r.total_minor, text: r.text, entryId: r.entry_id }));
}

export type BillOffer = { billId: string; supplier: string; number: string | null; totalMinor: number; kind: InvoiceMatchKind };

const MONEY_OUT = z.object({ id: col.uuid, day: col.text, amount_minor: col.minor, currency: col.currency, text: col.text, reference: col.textOrNull, counterparty: col.textOrNull });

/** The unpaid bill each line of money out of a book most likely pays, by the line's id. */
export async function billOffers(storeId: string, bookId: string): Promise<Map<string, BillOffer>> {
  const lines = await typedRows(
    MONEY_OUT,
    sql`select id, booked_on::text as day, amount_minor, currency, text, reference, counterparty from commerce.bank_lines
         where store_id = ${storeId}::uuid and book_id = ${bookId}::uuid and ledger_account = ${BANK_ACCOUNT} and entry_id is null and amount_minor < 0`,
  );
  if (lines.length === 0) return new Map();
  const bills = await typedRows(
    BILL,
    sql`select b.id, s.name as supplier, b.number, b.issued_on::text, b.due_on::text, b.total_minor, b.currency, b.text, b.entry_id
          from commerce.supplier_invoices b join commerce.suppliers s on s.store_id = b.store_id and s.id = b.supplier_id
         where b.store_id = ${storeId}::uuid and b.book_id = ${bookId}::uuid and b.paid_entry_id is null`,
  );
  if (bills.length === 0) return new Map();
  const byId = new Map(bills.map((b) => [b.id, b]));
  const matches = matchBills(
    lines.map((l) => ({ id: l.id, day: l.day, amountMinor: l.amount_minor, currency: l.currency, text: l.text, reference: l.reference, counterparty: l.counterparty })),
    bills.map((b) => ({ id: b.id, number: b.number, supplier: b.supplier, currency: b.currency, issuedOn: b.issued_on, totalMinor: b.total_minor })),
  );
  const out = new Map<string, BillOffer>();
  for (const m of matches) {
    const b = byId.get(m.invoiceId)!;
    out.set(m.lineId, { billId: b.id, supplier: b.supplier, number: b.number, totalMinor: b.total_minor, kind: m.kind });
  }
  return out;
}

/** Records a line of the statement as the payment of a bill (the owner's press, or a certain match when the statement is read). Audited. */
export async function payBillFromBank(member: Membership, lineId: string, billId: string): Promise<{ ok: true; supplier: string } | { ok: false; problem: "line" | "bill" | PostProblem }> {
  const storeId = member.store.id;
  const line = await typedRow(
    z.object({ id: col.uuid, book_id: col.uuid, day: col.text, amount_minor: col.minor }),
    sql`select b.id, b.book_id, b.booked_on::text as day, b.amount_minor from commerce.bank_lines b join commerce.ledger_books k on k.id = b.book_id
         where b.id = ${lineId}::uuid and b.store_id = ${storeId}::uuid and b.ledger_account = ${BANK_ACCOUNT} and b.entry_id is null
           and b.amount_minor < 0 and k.closed_on is null`,
  );
  if (!line) return { ok: false, problem: "line" };
  const bill = await typedRow(
    z.object({ id: col.uuid, total_minor: col.minor, text: col.text, supplier: col.text, issued_on: col.text }),
    sql`select b.id, b.total_minor, b.text, s.name as supplier, b.issued_on::text from commerce.supplier_invoices b
          join commerce.suppliers s on s.store_id = b.store_id and s.id = b.supplier_id
         where b.id = ${billId}::uuid and b.store_id = ${storeId}::uuid and b.book_id = ${line.book_id}::uuid and b.paid_entry_id is null`,
  );
  if (!bill || bill.issued_on > line.day) return { ok: false, problem: "bill" };
  const entry = entryOfBillPayment({ id: line.id, day: line.day, amountMinor: line.amount_minor }, { totalMinor: bill.total_minor, text: bill.text });
  if (!entry) return { ok: false, problem: "bill" };
  const posted = await postLedgerEntry(line.book_id, entry, member.account.id);
  if (!posted.ok) return { ok: false, problem: posted.problems[0] };
  await db().execute(sql`
    update commerce.supplier_invoices set paid_entry_id = ${posted.id}::uuid, paid_on = ${line.day}::date
     where id = ${bill.id}::uuid and store_id = ${storeId}::uuid and paid_entry_id is null`);
  try {
    await db().execute(sql`
      update commerce.bank_lines set entry_id = ${posted.id}::uuid, matched_at = now()
       where id = ${line.id}::uuid and store_id = ${storeId}::uuid and entry_id is null`);
  } catch (error) {
    log("info", "bank.bill_match_taken", { storeId, lineId }, error);
  }
  await audit(member.account.id, storeId, "work.supplier_invoice_paid", { billId, lineId, entryId: posted.id });
  return { ok: true, supplier: bill.supplier };
}

/** Records every certain bill payment of the store's open book (its number in the line, exactly its amount); returns the suppliers paid. */
export async function payCertainBills(member: Membership): Promise<string[]> {
  const book = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.ledger_books where store_id = ${member.store.id}::uuid and closed_on is null`);
  if (!book) return [];
  const paid: string[] = [];
  for (const [lineId, offer] of await billOffers(member.store.id, book.id)) {
    if (offer.kind !== "certain") continue;
    const done = await payBillFromBank(member, lineId, offer.billId);
    if (done.ok) paid.push(done.supplier);
  }
  return paid;
}
