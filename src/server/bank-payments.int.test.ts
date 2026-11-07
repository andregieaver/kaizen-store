import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const { importBankStatement } = await import("./bank-statements");
const { invoiceOffers, payCertainInvoices, payInvoiceFromBank } = await import("./bank-payments");

import type { Membership } from "./auth";
import type { InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * A client's payment on the bank's statement paying the Work invoice it names (B4, D487) against a real database: a line naming an invoice
 * and paying exactly what is outstanding records the payment when the statement is read, posted to the books and matched to its line; a
 * part payment naming another is offered, and paid with one press; a line that names nothing is offered nothing.
 */

const run = Date.now().toString(36);

afterAll(async () => {
  await closeDb();
});

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

async function workBooks(): Promise<{ storeId: string; bookId: string; member: Membership; actor: WorkActor }> {
  const name = `bpay-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(Date.now()).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Konsulent AS', 'NO', 'NOK', current_date - 30, ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k
      from (values (1500, 'asset'), (1920, 'asset'), (2700, 'liability'), (3000, 'income')) as a(n, k)`);
  const actor = { account: { id: String(owner.id) }, store: { id: storeId } };
  return { storeId, bookId, member: actor as unknown as Membership, actor };
}

/** 10 hours at 1 200.00 with 25 % VAT: 15 000.00 in all, issued ten days ago. */
async function issued(actor: WorkActor, clientId: string, on: string): Promise<{ id: string; printed: string; number: number }> {
  const draft = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
  ok(await invoices.saveLines(actor, draft, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 1000, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]));
  const id = ok(await invoices.issueInvoice(actor, { invoiceId: draft, issuedOn: on })).invoice.invoiceId;
  const [row] = await db().execute<Row>(sql`select document_number, number::int as number from commerce.work_invoices where id = ${id}::uuid`);
  return { id, printed: String(row.document_number), number: Number(row.number) };
}

const camt = (day: string, entries: { ref: string; amount: string; payer: string; words: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
  <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
  ${entries
    .map(
      (e) => `<Ntry><Amt Ccy="NOK">${e.amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${day}</Dt></BookgDt><AcctSvcrRef>${e.ref}</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>${e.payer}</Nm></Dbtr></RltdPties><RmtInf><Ustrd>${e.words}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`,
    )
    .join("\n  ")}
</Stmt></BkToCstmrStmt></Document>`;

describe("a client's payment on the statement, paying the invoice it names (B4, D487)", () => {
  it("records the certain one when the statement is read, offers the part payment, pays it with one press, and offers nothing for the rest", async () => {
    const { storeId, bookId, member, actor } = await workBooks();
    const [days] = await db().execute<Row>(sql`select (current_date - 10)::text as issued, (current_date - 5)::text as paid`);
    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
      values (${storeId}::uuid, 'Acme', 'Acme AS', '987654321', 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 'nb-NO', true, 'domestic', 'faktura@acme.example')
      returning id`);
    const a = await issued(actor, String(client.id), String(days.issued));
    const b = await issued(actor, String(client.id), String(days.issued));

    const file = camt(String(days.paid), [
      { ref: `${run}-a`, amount: "15000.00", payer: "ACME AS", words: `Faktura ${a.printed}` },
      { ref: `${run}-b`, amount: "5000.00", payer: "ACME AS", words: `Delbetaling faktura ${b.number}` },
      { ref: `${run}-c`, amount: "770.00", payer: "DNB", words: "Renter" },
    ]);
    expect(await importBankStatement(member, { name: "konto.xml", bytes: new TextEncoder().encode(file) })).toMatchObject({ ok: true, newLines: 3, matched: 0 });

    // The certain one: invoice A paid by bank on the bank's day, posted to the books, and its line matched to that entry.
    expect(await payCertainInvoices(member)).toEqual([a.printed]);
    const [paidA] = await db().execute<Row>(sql`
      select i.status, p.amount_minor::int as amount, p.received_on::text as day, p.method, p.reference
        from commerce.work_invoices i join commerce.work_invoice_payments p on p.invoice_id = i.id where i.id = ${a.id}::uuid`);
    expect(paidA).toEqual({ status: "paid", amount: 1_500_000, day: String(days.paid), method: "bank", reference: `ACME AS · Faktura ${a.printed}` });
    const [lineA] = await db().execute<Row>(sql`
      select e.source_kind, (select sum(l.amount_minor)::int from commerce.ledger_lines l where l.entry_id = e.id and l.account = 1920) as bank
        from commerce.bank_lines b join commerce.ledger_entries e on e.id = b.entry_id
       where b.book_id = ${bookId}::uuid and b.line_key = ${`ref:${run}-a`}`);
    expect(lineA).toEqual({ source_kind: "work_payment", bank: 1_500_000 });
    // Read again, nothing more is certain.
    expect(await payCertainInvoices(member)).toEqual([]);

    // The part payment is offered for invoice B; the interest names nothing and is offered nothing.
    const offers = await invoiceOffers(storeId, bookId);
    const [lineB] = await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-b`}`);
    expect([...offers.entries()]).toEqual([[String(lineB.id), { invoiceId: b.id, printedNumber: b.printed, client: "Acme AS", outstandingMinor: 1_500_000, kind: "number" }]]);

    expect(await payInvoiceFromBank(member, String(lineB.id), b.id)).toEqual({ ok: true, printedNumber: b.printed });
    const [amountsB] = await db().execute<Row>(sql`select outstanding_minor::int as left from commerce.work_invoice_amounts(${storeId}::uuid, ${b.id}::uuid)`);
    expect(amountsB.left).toBe(1_000_000);
    expect((await invoiceOffers(storeId, bookId)).size).toBe(0);
    // Pressed twice: the line is matched already, and nothing more is paid.
    expect(await payInvoiceFromBank(member, String(lineB.id), b.id)).toEqual({ ok: false, problem: "line" });

    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.bank_payment_recorded'`);
    expect(audited.n).toBe(2);
  });
});
