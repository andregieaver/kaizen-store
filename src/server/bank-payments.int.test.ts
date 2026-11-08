import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const { importBankStatement, bankSummary, matchBankStatement } = await import("./bank-statements");
const ledger = await import("./ledger");
const { invoiceOffers, payCertainInvoices, payInvoiceFromBank, postBankOwnLine } = await import("./bank-payments");

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

async function workBooks(label = "a"): Promise<{ storeId: string; bookId: string; member: Membership; actor: WorkActor }> {
  const name = `bpay-${run}-${label}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`;
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

const camt = (day: string, entries: { ref: string; amount: string; payer: string; words: string; side?: "CRDT" | "DBIT" }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
  <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
  ${entries
    .map(
      (e) => `<Ntry><Amt Ccy="NOK">${e.amount}</Amt><CdtDbtInd>${e.side ?? "CRDT"}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${day}</Dt></BookgDt><AcctSvcrRef>${e.ref}</AcctSvcrRef>
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
    expect([...offers.entries()]).toEqual([[String(lineB.id), { invoiceId: b.id, source: "work", printedNumber: b.printed, orderNumber: null, client: "Acme AS", outstandingMinor: 1_500_000, kind: "number" }]]);

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

describe("an old statement paying old invoices, from before the books opened (D495)", () => {
  it("marks each paid once, posts nothing before the books, leaves nothing waiting, and never offers a line twice", async () => {
    const { storeId, bookId, member, actor } = await workBooks("earlier");
    const [days] = await db().execute<Row>(sql`select (current_date - 400)::text as issued, (current_date - 380)::text as first, (current_date - 350)::text as second`);
    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, country, currency, locale) values (${storeId}::uuid, 'Optio', 'NO', 'NOK', 'nb-NO') returning id`);
    // Two of the same amount, brought in as history (Tripletex's 2101 and 2102).
    const old = async (number: string) =>
      db().transaction(async (t) => {
        await t.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
        const [row] = await t.execute<Row>(sql`
          insert into commerce.work_invoices (store_id, client_id, status, document_number, legacy_number, imported, issued_on, due_on, sent_at, currency, locale, payment_days,
            subtotal_minor, vat_minor, total_minor, seller, buyer)
          values (${storeId}::uuid, ${String(client.id)}::uuid, 'sent', ${number}, ${number}, true, ${String(days.issued)}::date, ${String(days.issued)}::date + 14, now(), 'NOK', 'nb-NO', 14,
            99000, 24750, 123750, '{}'::jsonb, '{"name":"Optio AS"}'::jsonb)
          returning id`);
        return String(row.id);
      });
    const first = await old("2101");
    const second = await old("2102");
    void actor;

    const file = camt(String(days.first), [
      { ref: `${run}-e1`, amount: "1237.50", payer: "OPTIO AS", words: "Faktura 2101" },
      { ref: `${run}-e2`, amount: "1237.50", payer: "OPTIO AS", words: "Betaling" },
      { ref: `${run}-e3`, amount: "99.00", payer: "Ukjent", words: "Overføring" },
    ]);
    expect(await importBankStatement(member, { name: "gammel.xml", bytes: new TextEncoder().encode(file) })).toMatchObject({ ok: true, newLines: 3 });

    // The line naming 2101 pays it on reading; no entry is posted before the books opened, and the line is settled, not waiting.
    expect(await payCertainInvoices(member)).toEqual(["2101"]);
    const [paid] = await db().execute<Row>(sql`select i.status, (select count(*)::int from commerce.ledger_entries e where e.book_id = ${bookId}::uuid) as entries
                                                 from commerce.work_invoices i where i.id = ${first}::uuid`);
    expect(paid).toEqual({ status: "paid", entries: 0 });
    const [line1] = await db().execute<Row>(sql`select entry_id, payment_ref from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-e1`}`);
    expect(line1.entry_id).toBeNull();
    expect(String(line1.payment_ref)).toMatch(/^work_payment:[0-9a-f-]{36}$/);

    // The unnamed 1 237.50 is offered for 2102 only; once it pays it, it is offered for nothing more.
    const [line2] = await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-e2`}`);
    const offers = await invoiceOffers(storeId, bookId);
    expect(offers.get(String(line2.id))).toMatchObject({ invoiceId: second, printedNumber: "2102" });
    expect(await payInvoiceFromBank(member, String(line2.id), second)).toEqual({ ok: true, printedNumber: "2102" });
    expect((await invoiceOffers(storeId, bookId)).size).toBe(0);
    expect(await payInvoiceFromBank(member, String(line2.id), second)).toEqual({ ok: false, problem: "line" });

    // The Books screen: nothing waits; the stray line before the books is in the opening balance; no bank balance is compared.
    expect(await bankSummary(bookId)).toMatchObject({ lines: 3, matched: 0, settled: 2, waiting: 0, earlierCount: 1, bankOnly: [], closing: null });
    // What a line paid names a payment, and nothing else.
    await expect(db().execute(sql`update commerce.bank_lines set payment_ref = 'anything' where id = ${String(line2.id)}::uuid`)).rejects.toThrow();
  });
});

describe("the books opened earlier, holding the year (D498)", () => {
  it("posts an invoice brought in from elsewhere and its payment once its days are in the books, and its bank line then matches", async () => {
    const { storeId, bookId, member } = await workBooks("sooner");
    const [days] = await db().execute<Row>(sql`
      select (current_date - 400)::text as before, (current_date - 60)::text as issued, (current_date - 50)::text as paid, (current_date - 90)::text as sooner,
             (current_date - 30)::text as opened`);
    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, country, currency, locale) values (${storeId}::uuid, 'Optio', 'NO', 'NOK', 'nb-NO') returning id`);
    // Invoices issued elsewhere (Tripletex's 3101 in the days to be added, 3001 a year before), each with its line.
    const old = async (number: string, on: string) =>
      db().transaction(async (t) => {
        await t.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
        const [row] = await t.execute<Row>(sql`
          insert into commerce.work_invoices (store_id, client_id, status, document_number, legacy_number, imported, issued_on, due_on, sent_at, currency, locale, payment_days,
            subtotal_minor, vat_minor, total_minor, seller, buyer)
          values (${storeId}::uuid, ${String(client.id)}::uuid, 'sent', ${number}, ${number}, true, ${on}::date, ${on}::date + 14, now(), 'NOK', 'nb-NO', 14,
            100000, 25000, 125000, '{}'::jsonb, '{"name":"Optio AS"}'::jsonb)
          returning id`);
        await t.execute(sql`
          insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, unit, quantity_hundredths, unit_price_minor, discount_bp,
            vat_category, vat_rate, excl_minor, vat_minor, incl_minor, quantity_manual)
          values (${storeId}::uuid, ${String(row.id)}::uuid, 1, 'Rådgivning', 'hour', 100, 100000, 0, 'standard', 0.25, 100000, 25000, 125000, true)`);
        return String(row.id);
      });
    const inDays = await old("3101", String(days.issued));
    await old("3001", String(days.before));

    // Paid from the statement before the books opened: marked paid, posted nowhere, its line settled.
    const file = camt(String(days.paid), [{ ref: `${run}-s1`, amount: "1250.00", payer: "OPTIO AS", words: "Faktura 3101" }]);
    expect(await importBankStatement(member, { name: "tidlig.xml", bytes: new TextEncoder().encode(file) })).toMatchObject({ ok: true, newLines: 1 });
    expect(await payCertainInvoices(member)).toEqual(["3101"]);
    const lineOf = async () => (await db().execute<Row>(sql`select entry_id, payment_ref from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-s1`}`))[0];
    expect((await lineOf()).payment_ref).not.toBeNull();

    // Not later, not while locked.
    expect(await ledger.openLedgerBookEarlier(member, String(days.opened))).toEqual({ ok: false, problem: "later" });
    expect((await ledger.lockLedgerThrough(member, String(days.opened))).ok).toBe(true);
    expect(await ledger.openLedgerBookEarlier(member, String(days.sooner))).toEqual({ ok: false, problem: "locked" });
    expect((await ledger.lockLedgerThrough(member, null)).ok).toBe(true);

    // Opened 90 days back: the invoice of those days and its payment post; the one a year before stays in the opening balance.
    const earlier = await ledger.openLedgerBookEarlier(member, String(days.sooner));
    expect(earlier).toMatchObject({ ok: true, book: { openedOn: String(days.sooner) } });
    expect((await lineOf()).payment_ref).toBeNull();
    const book = (await ledger.openBookOf(storeId))!;
    await ledger.postDueDocuments(storeId, { id: book.id, currency: book.currency, opened_on: book.openedOn, closed_on: book.closedOn });
    const posted = await db().execute<Row>(sql`
      select e.series, e.source_kind, e.entry_date::text as day from commerce.ledger_entries e where e.book_id = ${bookId}::uuid order by e.entry_date`);
    expect(posted).toEqual([
      { series: "S", source_kind: "work_invoice", day: String(days.issued) },
      { series: "B", source_kind: "work_payment", day: String(days.paid) },
    ]);
    const [sale] = await db().execute<Row>(sql`select source_id from commerce.ledger_entries where book_id = ${bookId}::uuid and source_kind = 'work_invoice'`);
    expect(sale.source_id).toBe(inDays);
    await matchBankStatement(storeId, bookId);
    expect((await lineOf()).entry_id).not.toBeNull();
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.ledger_book_opened_earlier'`);
    expect(audited.n).toBe(1);
  }, 60_000);
});

describe("the bank's own fees and interest, posted with a press (B4, D488)", () => {
  it("posts a fee to 7770 and interest to 8050 against the bank, matched to their lines, once, and refuses a purchase", async () => {
    const { storeId, bookId, member } = await workBooks("own");
    const [days] = await db().execute<Row>(sql`select (current_date - 3)::text as day`);
    const file = camt(String(days.day), [
      { ref: `${run}-fee`, amount: "65.00", payer: "DNB", words: "Kontoholdsgebyr", side: "DBIT" },
      { ref: `${run}-int`, amount: "7.70", payer: "DNB", words: "Kreditrenter" },
      { ref: `${run}-buy`, amount: "1000.00", payer: "Kontorbutikken", words: "Varekjøp", side: "DBIT" },
    ]);
    expect(await importBankStatement(member, { name: "konto.xml", bytes: new TextEncoder().encode(file) })).toMatchObject({ ok: true, newLines: 3 });
    const lineOf = async (ref: string) =>
      String((await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-${ref}`}`))[0].id);

    expect(await postBankOwnLine(member, await lineOf("fee"))).toEqual({ ok: true, kind: "fee", account: 7770 });
    expect(await postBankOwnLine(member, await lineOf("int"))).toEqual({ ok: true, kind: "interest_in", account: 8050 });
    const posted = await db().execute<Row>(sql`
      select e.series, e.entry_date::text as day, e.source_kind, l.account, l.amount_minor::int as amount, l.vat_code
        from commerce.bank_lines b join commerce.ledger_entries e on e.id = b.entry_id join commerce.ledger_lines l on l.entry_id = e.id
       where b.book_id = ${bookId}::uuid order by b.amount_minor, l.account`);
    expect(posted.map((r) => [r.series, r.day, r.source_kind, r.account, r.amount, r.vat_code])).toEqual([
      ["B", String(days.day), "bank_line", 1920, -6_500, null],
      ["B", String(days.day), "bank_line", 7770, 6_500, null],
      ["B", String(days.day), "bank_line", 1920, 770, null],
      ["B", String(days.day), "bank_line", 8050, -770, null],
    ]);
    // Pressed again: the line is matched already. A purchase is not the bank's own: it needs its receipt.
    expect(await postBankOwnLine(member, await lineOf("fee"))).toEqual({ ok: false, problem: "line" });
    expect(await postBankOwnLine(member, await lineOf("buy"))).toEqual({ ok: false, problem: "kind" });
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.bank_line_posted'`);
    expect(audited.n).toBe(2);
  });
});
