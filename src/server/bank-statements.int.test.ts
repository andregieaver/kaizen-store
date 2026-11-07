import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { importBankStatement, matchBankStatement, bankSummary } = await import("./bank-statements");

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * Bank statements in a store's books (B4 route 1, D486) against a real database: a statement is read, its lines kept once, and each matched
 * to the entry of the books that moved the same money on the bank's account. The payout and the client's payment are found; the card
 * purchase waits until it is posted; what the books have that the bank does not show is said; the bank's closing balance stands beside the
 * books'. Uploaded again, nothing is added; in another currency, it is refused.
 */

const run = Date.now().toString(36);
const bytes = (text: string) => new TextEncoder().encode(text);

afterAll(async () => {
  await closeDb();
});

const CAMT = (currency = "NOK") => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
  <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>${currency}</Ccy></Acct>
  <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="${currency}">0.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2027-01-01</Dt></Dt></Bal>
  <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="${currency}">1465.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2027-01-31</Dt></Dt></Bal>
  <Ntry><Amt Ccy="${currency}">965.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2027-01-18</Dt></BookgDt><AcctSvcrRef>${run}-1</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>STRIPE PAYMENTS EUROPE</Nm></Dbtr></RltdPties><RmtInf><Ustrd>STRIPE PAYOUT</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="${currency}">1500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2027-01-20</Dt></BookgDt><AcctSvcrRef>${run}-2</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Acme AS</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>0012345678903</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="${currency}">1000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2027-01-25</Dt></BookgDt><AcctSvcrRef>${run}-3</AcctSvcrRef>
    <AddtlNtryInf>Varekjøp Kontorbutikken</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

async function booksOfStore(label: string): Promise<{ member: Membership; storeId: string; bookId: string }> {
  const name = `bank-${run}-${label}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Banken') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Banken', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Banken AS', 'NO', 'NOK', '2027-01-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k
      from (values (1500, 'asset'), (1579, 'asset'), (1920, 'asset'), (6800, 'expense'), (7770, 'expense')) as a(n, k)`);
  const member = { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership;
  return { member, storeId, bookId };
}

const post = async (bookId: string, day: string, text: string, lines: { account: number; amount: number }[]) =>
  String((await db().execute<Row>(sql`select commerce.ledger_post(${bookId}::uuid, 'B', ${day}::date, ${text}, null, null, ${JSON.stringify(lines)}::jsonb, null) as id`))[0].id);

describe("a bank statement uploaded to the books (B4)", () => {
  it("keeps its lines once, matches the payout and the client's payment, and says what is left on either side", async () => {
    const { member, storeId, bookId } = await booksOfStore("a");
    // The books: Stripe's payout reached the bank on the 16th, the client paid on the 19th, and cash was put in on the 22nd.
    const payout = await post(bookId, "2027-01-16", "Utbetaling fra Stripe", [{ account: 1920, amount: 96_500 }, { account: 1579, amount: -96_500 }]);
    const paid = await post(bookId, "2027-01-19", "Innbetaling faktura 1042", [{ account: 1920, amount: 150_000 }, { account: 1500, amount: -150_000 }]);
    await post(bookId, "2027-01-22", "Innskudd kontanter", [{ account: 1920, amount: 5_000 }, { account: 1500, amount: -5_000 }]);

    const first = await importBankStatement(member, { name: "kontoutskrift-januar.xml", bytes: bytes(CAMT()) });
    expect(first).toEqual({ ok: true, statementId: expect.any(String), lines: 3, newLines: 3, matched: 2 });
    const lines = await db().execute<Row>(sql`select line_key, amount_minor::int as amount, entry_id from commerce.bank_lines where book_id = ${bookId}::uuid order by booked_on`);
    expect(lines.map((l) => [l.amount, l.entry_id])).toEqual([
      [96_500, payout],
      [150_000, paid],
      [-100_000, null],
    ]);

    const summary = await bankSummary(bookId);
    expect(summary).toMatchObject({ statements: 1, lines: 3, matched: 2, fromDay: "2027-01-01", toDay: "2027-01-31" });
    // The card purchase is in the bank and not the books; the cash put in is in the books and not the bank.
    expect(summary.bankOnly.map((l) => [l.day, l.amountMinor, l.text])).toEqual([["2027-01-25", -100_000, "Varekjøp Kontorbutikken"]]);
    expect(summary.booksOnly.map((l) => [l.day, l.amountMinor, l.text])).toEqual([["2027-01-22", 5_000, "Innskudd kontanter"]]);
    // The bank's closing balance beside what the books hold on the bank's account at the end of that day.
    expect(summary.closing).toEqual({ day: "2027-01-31", bankMinor: 146_500, booksMinor: 251_500 });

    // Uploaded again: nothing new, nothing matched twice.
    expect(await importBankStatement(member, { name: "kontoutskrift-januar.xml", bytes: bytes(CAMT()) })).toEqual({
      ok: true,
      statementId: expect.any(String),
      lines: 3,
      newLines: 0,
      matched: 0,
    });
    expect((await bankSummary(bookId)).lines).toBe(3);

    // The purchase posted by hand afterwards: the ledger's job matches it.
    const purchase = await post(bookId, "2027-01-25", "Kontorrekvisita", [{ account: 6800, amount: 100_000 }, { account: 1920, amount: -100_000 }]);
    expect(await matchBankStatement(storeId, bookId)).toBe(1);
    const [matched] = await db().execute<Row>(sql`select entry_id from commerce.bank_lines where book_id = ${bookId}::uuid and amount_minor = -100000`);
    expect(matched.entry_id).toBe(purchase);
    // The purchase reversed: its bank line waits again, in the bank and not the books.
    await db().execute(sql`select commerce.ledger_reverse(${purchase}::uuid, '2027-01-26'::date, 'Feilført', null)`);
    expect(await matchBankStatement(storeId, bookId)).toBe(0);
    const [released] = await db().execute<Row>(sql`select entry_id, matched_at from commerce.bank_lines where book_id = ${bookId}::uuid and amount_minor = -100000`);
    expect(released).toEqual({ entry_id: null, matched_at: null });
    expect((await bankSummary(bookId)).bankOnly.map((l) => l.amountMinor)).toEqual([-100_000]);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.bank_statement_imported'`);
    expect(audited.n).toBe(2);
  });

  it("refuses a statement in another currency than the books', or one it cannot read, and keeps nothing of it", async () => {
    const { member, bookId } = await booksOfStore("b");
    expect(await importBankStatement(member, { name: "eur.xml", bytes: bytes(CAMT("EUR")) })).toEqual({ ok: false, problem: "book_currency", currency: "EUR" });
    expect(await importBankStatement(member, { name: "x.csv", bytes: bytes("hello;world\n1;2\n") })).toEqual({ ok: false, problem: "format" });
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.bank_statements where book_id = ${bookId}::uuid`);
    expect(kept.n).toBe(0);
  });
});
