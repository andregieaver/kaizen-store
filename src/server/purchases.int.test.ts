import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { importBankStatement } = await import("./bank-statements");
const { postPurchaseFromBank, readVoucher, vouchersOf } = await import("./purchases");

import type { Membership } from "./auth";
import type { DocumentStorage } from "./invoice-storage";

type Row = Record<string, unknown>;

/**
 * A purchase the bank's statement shows, posted with its receipt (B3, D490) against a real database: the receipt is kept as the entry's
 * voucher (here in a bucket in memory), the cost and the deductible VAT posted apart against the bank and the line matched; pressed again,
 * the line is matched; a file that is no photo or PDF is refused, and so is posting when the receipt cannot be kept, leaving nothing.
 */

const run = Date.now().toString(36);

afterAll(async () => {
  await closeDb();
});

/** A bucket in memory, as the private `documents` bucket behaves: a path written once. */
function memoryBucket(): DocumentStorage & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async upload(path, bytes) {
      if (files.has(path)) return false;
      files.set(path, bytes);
      return true;
    },
    async download(path) {
      return files.get(path) ?? null;
    },
    async remove(paths) {
      for (const p of paths) files.delete(p);
      return true;
    },
  };
}

async function booksWithStatement(): Promise<{ storeId: string; bookId: string; member: Membership; lineId: string }> {
  const name = `buy-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Kjøp') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Kjøp', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Kjøp AS', 'NO', 'NOK', '2027-01-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k from (values (1920, 'asset'), (2710, 'liability')) as a(n, k)`);
  const member = { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership;
  const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
    <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
    <Ntry><Amt Ccy="NOK">1000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2027-01-25</Dt></BookgDt><AcctSvcrRef>${run}-buy</AcctSvcrRef>
      <AddtlNtryInf>Varekjøp Kontorbutikken</AddtlNtryInf></Ntry>
    <Ntry><Amt Ccy="NOK">500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2027-01-26</Dt></BookgDt><AcctSvcrRef>${run}-in</AcctSvcrRef>
      <AddtlNtryInf>Innbetaling</AddtlNtryInf></Ntry>
  </Stmt></BkToCstmrStmt></Document>`;
  expect(await importBankStatement(member, { name: "konto.xml", bytes: new TextEncoder().encode(camt) })).toMatchObject({ ok: true, newLines: 2 });
  const [line] = await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-buy`}`);
  return { storeId, bookId, member, lineId: String(line.id) };
}

const PDF = new TextEncoder().encode("%PDF-1.7\n% kvittering\n1 0 obj << >> endobj\n%%EOF\n");

describe("a purchase posted from the bank with its receipt (B3, D490)", () => {
  it("keeps the receipt as the voucher, posts the cost and the VAT apart against the bank, and matches the line once", async () => {
    const { storeId, bookId, member, lineId } = await booksWithStatement();
    const bucket = memoryBucket();

    // Nothing that is no photo or PDF, and nothing without a place to keep the receipt.
    expect(await postPurchaseFromBank(member, lineId, { kind: "office", vatRate: 25 }, { name: "x.html", bytes: new TextEncoder().encode("<html>") }, { storage: bucket })).toEqual({
      ok: false,
      problem: "type",
    });
    expect(await postPurchaseFromBank(member, lineId, { kind: "office", vatRate: 25 }, { name: "k.pdf", bytes: PDF }, { storage: null })).toEqual({ ok: false, problem: "storage" });
    expect(bucket.files.size).toBe(0);

    const posted = await postPurchaseFromBank(member, lineId, { kind: "office", vatRate: 25, text: "Printerpapir" }, { name: "kvittering.pdf", bytes: PDF }, { storage: bucket });
    expect(posted).toEqual({ ok: true, entryId: expect.any(String), voucherId: expect.any(String), account: 6800 });
    if (!posted.ok) return;
    const lines = await db().execute<Row>(sql`
      select e.series, e.entry_date::text as day, e.text, l.account, l.amount_minor::int as amount, l.vat_code
        from commerce.ledger_entries e join commerce.ledger_lines l on l.entry_id = e.id where e.id = ${posted.entryId}::uuid order by l.line`);
    expect(lines.map((l) => [l.series, l.day, l.text, l.account, l.amount, l.vat_code])).toEqual([
      ["B", "2027-01-25", "Printerpapir", 6800, 80_000, "1"],
      ["B", "2027-01-25", "Printerpapir", 2710, 20_000, "1"],
      ["B", "2027-01-25", "Printerpapir", 1920, -100_000, null],
    ]);
    // The account the book lacked was added from the standard chart.
    const [chart] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ledger_accounts where book_id = ${bookId}::uuid and number = 6800`);
    expect(chart.n).toBe(1);
    const [line] = await db().execute<Row>(sql`select entry_id from commerce.bank_lines where id = ${lineId}::uuid`);
    expect(line.entry_id).toBe(posted.entryId);

    // The voucher: kept once at its path, readable by the store, by the entry it documents.
    const [voucher] = await db().execute<Row>(sql`select file_path, file_name, content_type, size_bytes, bank_line_id from commerce.ledger_vouchers where id = ${posted.voucherId}::uuid`);
    expect(voucher).toEqual({ file_path: `${storeId}/vouchers/${posted.voucherId}.pdf`, file_name: "kvittering.pdf", content_type: "application/pdf", size_bytes: PDF.length, bank_line_id: lineId });
    expect([...bucket.files.keys()]).toEqual([`${storeId}/vouchers/${posted.voucherId}.pdf`]);
    expect(await readVoucher(storeId, posted.voucherId, { storage: bucket })).toEqual({ bytes: PDF, contentType: "application/pdf", fileName: "kvittering.pdf" });
    expect(await readVoucher(crypto.randomUUID(), posted.voucherId, { storage: bucket })).toBeNull();
    expect((await vouchersOf(storeId, [posted.entryId])).get(posted.entryId)).toMatchObject({ id: posted.voucherId, fileName: "kvittering.pdf" });
    // A voucher is never changed or deleted.
    await expect(db().execute(sql`delete from commerce.ledger_vouchers where id = ${posted.voucherId}::uuid`)).rejects.toThrow();

    // Pressed again, the line is matched; money in is no purchase.
    expect(await postPurchaseFromBank(member, lineId, { kind: "office", vatRate: 25 }, { name: "k.pdf", bytes: PDF }, { storage: bucket })).toEqual({ ok: false, problem: "line" });
    const [moneyIn] = await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-in`}`);
    expect(await postPurchaseFromBank(member, String(moneyIn.id), { kind: "office", vatRate: 25 }, { name: "k.pdf", bytes: PDF }, { storage: bucket })).toEqual({ ok: false, problem: "line" });
    expect(bucket.files.size).toBe(1);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.purchase_posted'`);
    expect(audited.n).toBe(1);
  });
});
