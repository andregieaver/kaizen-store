import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { importBankStatement } = await import("./bank-statements");
const bills = await import("./supplier-invoices");

import type { Membership } from "./auth";
import type { DocumentStorage } from "./invoice-storage";

type Row = Record<string, unknown>;

/**
 * Suppliers' invoices, a store's bills (B3, D492), against a real database: a bill added with its PDF is posted against what the store owes
 * and waits unpaid; the same number from the same supplier again is refused; the bank's statement then pays it by itself when its line names
 * the bill and pays it whole, and another, known by its supplier and amount, is paid with one press. A paid bill is never changed again.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

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

const PDF = new TextEncoder().encode("%PDF-1.7\n% faktura\n%%EOF\n");

async function books(): Promise<{ storeId: string; bookId: string; member: Membership }> {
  const name = `bill-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Regning') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Regning', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Regning AS', 'NO', 'NOK', '2027-01-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k from (values (1920, 'asset')) as a(n, k)`);
  return { storeId, bookId, member: { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership };
}

describe("a supplier's invoice, a bill (B3, D492)", () => {
  it("is posted against what the store owes as it comes, and paid from the bank's statement, by itself or with a press", async () => {
    const { storeId, bookId, member } = await books();
    const bucket = memoryBucket();
    const telenor = { supplier: "Telenor Norge AS", organisationNumber: "976 967 631", number: "88123", issuedOn: "2027-01-10", dueOn: "2027-01-24", totalMinor: 125_000, kind: "phone" as const, vatRate: 25 as const };

    // A due day before the bill's day, and no file that is a bill, are refused.
    expect(await bills.addBill(member, { ...telenor, dueOn: "2027-01-01" }, { name: "f.pdf", bytes: PDF }, { storage: bucket })).toEqual({ ok: false, problem: "days" });
    expect(await bills.addBill(member, telenor, { name: "f.txt", bytes: new TextEncoder().encode("hello") }, { storage: bucket })).toEqual({ ok: false, problem: "type" });

    const added = await bills.addBill(member, telenor, { name: "telenor-88123.pdf", bytes: PDF }, { storage: bucket });
    expect(added).toEqual({ ok: true, billId: expect.any(String), entryId: expect.any(String) });
    if (!added.ok) return;
    const lines = await db().execute<Row>(sql`
      select e.series, e.entry_date::text as day, l.account, l.amount_minor::int as amount, l.vat_code
        from commerce.ledger_entries e join commerce.ledger_lines l on l.entry_id = e.id where e.id = ${added.entryId}::uuid order by l.line`);
    expect(lines.map((l) => [l.series, l.day, l.account, l.amount, l.vat_code])).toEqual([
      ["L", "2027-01-10", 6900, 100_000, "1"],
      ["L", "2027-01-10", 2710, 25_000, "1"],
      ["L", "2027-01-10", 2400, -125_000, null],
    ]);
    const [voucher] = await db().execute<Row>(sql`select file_name, bank_line_id from commerce.ledger_vouchers where entry_id = ${added.entryId}::uuid`);
    expect(voucher).toEqual({ file_name: "telenor-88123.pdf", bank_line_id: null });
    const [supplier] = await db().execute<Row>(sql`select name, organisation_number, usual_kind from commerce.suppliers where store_id = ${storeId}::uuid`);
    expect(supplier).toEqual({ name: "Telenor Norge AS", organisation_number: "976 967 631", usual_kind: "phone" });
    // The same number from the same supplier, named in other letters, is the same bill.
    expect(await bills.addBill(member, { ...telenor, supplier: "TELENOR NORGE AS" }, { name: "f.pdf", bytes: PDF }, { storage: bucket })).toEqual({ ok: false, problem: "duplicate" });

    const office = await bills.addBill(
      member,
      { supplier: "Kontorbutikken AS", issuedOn: "2027-01-12", totalMinor: 45_000, kind: "office", vatRate: 25 },
      { name: "kontor.pdf", bytes: PDF },
      { storage: bucket },
    );
    expect(office.ok).toBe(true);
    expect((await bills.unpaidBills(storeId, bookId)).map((b) => [b.supplier, b.number, b.dueOn, b.totalMinor])).toEqual([
      ["Telenor Norge AS", "88123", "2027-01-24", 125_000],
      ["Kontorbutikken AS", null, null, 45_000],
    ]);

    // The bank's statement: the Telenor bill named and paid whole, the office supplies by their supplier.
    const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
      <Ntry><Amt Ccy="NOK">1250.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2027-01-24</Dt></BookgDt><AcctSvcrRef>${run}-tel</AcctSvcrRef>
        <AddtlNtryInf>Giro 88123</AddtlNtryInf></Ntry>
      <Ntry><Amt Ccy="NOK">450.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2027-01-25</Dt></BookgDt><AcctSvcrRef>${run}-off</AcctSvcrRef>
        <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>KONTORBUTIKKEN AS</Nm></Cdtr></RltdPties></TxDtls></NtryDtls><AddtlNtryInf>Overføring</AddtlNtryInf></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    expect(await importBankStatement(member, { name: "konto.xml", bytes: new TextEncoder().encode(camt) })).toMatchObject({ ok: true, newLines: 2 });
    expect(await bills.payCertainBills(member)).toEqual(["Telenor Norge AS"]);
    const [paid] = await db().execute<Row>(sql`select paid_on::text as paid_on, paid_entry_id from commerce.supplier_invoices where id = ${added.billId}::uuid`);
    expect(paid.paid_on).toBe("2027-01-24");
    const payment = await db().execute<Row>(sql`select l.account, l.amount_minor::int as amount from commerce.ledger_lines l where l.entry_id = ${String(paid.paid_entry_id)}::uuid order by l.line`);
    expect(payment.map((l) => [l.account, l.amount])).toEqual([
      [2400, 125_000],
      [1920, -125_000],
    ]);

    const offers = await bills.billOffers(storeId, bookId);
    const [officeLine] = await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-off`}`);
    expect(offers.get(String(officeLine.id))).toMatchObject({ supplier: "Kontorbutikken AS", totalMinor: 45_000, kind: "amount_name" });
    if (!office.ok) return;
    expect(await bills.payBillFromBank(member, String(officeLine.id), office.billId)).toEqual({ ok: true, supplier: "Kontorbutikken AS" });
    expect(await bills.unpaidBills(storeId, bookId)).toEqual([]);
    // Pressed again: the line is matched. A paid bill is never changed or deleted.
    expect(await bills.payBillFromBank(member, String(officeLine.id), office.billId)).toEqual({ ok: false, problem: "line" });
    await expect(db().execute(sql`update commerce.supplier_invoices set total_minor = 1 where id = ${added.billId}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`delete from commerce.supplier_invoices where id = ${added.billId}::uuid`)).rejects.toThrow();
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action like 'work.supplier_invoice_%'`);
    expect(audited.n).toBe(4);
  });
});
