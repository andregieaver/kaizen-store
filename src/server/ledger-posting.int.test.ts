import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

// A gift card's code is hashed with the settings key (store credit is a card, D364).
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const fx = await import("./invoice-test-fixture");
const ledger = await import("./ledger");

import type { Membership } from "./auth";
import type { InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * Our own ledger's step 2 (D478) against a real database: a store's Work invoices and its shop's invoices, issued in the book's days, are
 * posted by the job once each, on the receivable, income and VAT accounts; one in another currency waits with why and is not tried again
 * the same day; one a person reversed is not posted again.
 */

const run = Date.now().toString(36);
let counter = 0;

afterAll(async () => {
  await closeDb();
});

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

async function workStore(): Promise<{ storeId: string; actor: WorkActor & { account: { id: string } } }> {
  counter += 1;
  const name = `ldg-${run}-${counter}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(20_000_000 + counter).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  return { storeId, actor: { account: { id: String(owner.id) }, store: { id: storeId } } };
}

async function client(storeId: string, currency = "NOK"): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
    values (${storeId}::uuid, 'Acme', 'Acme AS', '987654321', 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, ${currency}, 'nb-NO', true, 'domestic', 'faktura@acme.example')
    returning id`);
  return String(row.id);
}

/** 10 hours at 1 200.00 with 25 % VAT: 15 000.00 in all. */
async function issued(actor: WorkActor, clientId: string, o: { fxRate?: string } = {}): Promise<string> {
  const draft = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
  ok(await invoices.saveLines(actor, draft, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 1000, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]));
  return ok(await invoices.issueInvoice(actor, { invoiceId: draft, ...(o.fxRate ? { fxRate: o.fxRate } : {}) })).invoice.invoiceId;
}

async function openBook(storeId: string, accountId: string): Promise<{ id: string; currency: string; opened_on: string; closed_on: null }> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Konsulent AS', 'NO', 'NOK', current_date - 30, ${accountId}::uuid) returning id, opened_on::text`);
  const id = String(row.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${id}::uuid, n, 'Account ' || n, n::text, k
      from (values (1500, 'asset'), (1920, 'asset'), (2700, 'liability'), (3000, 'income')) as a(n, k)`);
  return { id, currency: "NOK", opened_on: String(row.opened_on), closed_on: null };
}

const entriesOf = async (bookId: string, sourceId?: string) =>
  db().execute<Row>(sql`
    select e.source_kind, l.account, l.amount_minor::int as amount, l.vat_code
      from commerce.ledger_entries e join commerce.ledger_lines l on l.entry_id = e.id
     where e.book_id = ${bookId}::uuid and (${sourceId ?? null}::text is null or e.source_id = ${sourceId ?? null}) order by e.number, l.line`);

describe("a store's documents, posted to its books", () => {
  it("posts each issued Work invoice once, one in euro in kroner at its own rate, lets one on a locked day wait, and never posts again one a person reversed", async () => {
    const { storeId, actor } = await workStore();
    const book = await openBook(storeId, actor.account.id);
    const nok = await issued(actor, await client(storeId));
    const eur = await issued(actor, await client(storeId, "EUR"), { fxRate: "11.5" });

    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 2, waiting: 0 });
    expect(await entriesOf(book.id, nok)).toEqual([
      { source_kind: "work_invoice", account: 1500, amount: 1_500_000, vat_code: null },
      { source_kind: "work_invoice", account: 3000, amount: -1_200_000, vat_code: "3" },
      { source_kind: "work_invoice", account: 2700, amount: -300_000, vat_code: "3" },
    ]);
    // 15 000.00 euro at 11.5: its VAT is what the invoice reported in kroner.
    const [home] = await db().execute<Row>(sql`select vat_home_minor::int as vat from commerce.work_invoices where id = ${eur}::uuid`);
    expect(await entriesOf(book.id, eur)).toEqual([
      { source_kind: "work_invoice", account: 1500, amount: 17_250_000, vat_code: null },
      { source_kind: "work_invoice", account: 3000, amount: -13_800_000, vat_code: "3" },
      { source_kind: "work_invoice", account: 2700, amount: -Number(home.vat), vat_code: "3" },
    ]);
    expect(Number(home.vat)).toBe(3_450_000);
    // 3200 and 3100 were not in this chart: the job added the standard accounts the posting needs.
    expect((await ledger.ledgerAccounts(book.id)).map((a) => a.number)).toEqual(expect.arrayContaining([2701, 2703, 3100, 3200, 2900]));

    // Again the same day: nothing is posted twice.
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 0, waiting: 0 });

    // The books locked through the store's today (its day, as the invoice is dated): a new invoice waits with why, and is not tried again the same day.
    await db().execute(sql`update commerce.ledger_books set locked_through = commerce.store_day(store_id, now()) where id = ${book.id}::uuid`);
    await issued(actor, await client(storeId));
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 0, waiting: 1 });
    expect(await ledger.ledgerWaiting(book.id)).toMatchObject([{ kind: "work_invoice", problem: "locked" }]);
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 0, waiting: 0 });

    // A person reverses the posted NOK invoice: the job leaves it be. A day later what waits is tried again (still locked).
    await db().execute(sql`update commerce.ledger_books set locked_through = null where id = ${book.id}::uuid`);
    const [entry] = await db().execute<Row>(sql`select id from commerce.ledger_entries where book_id = ${book.id}::uuid and source_id = ${nok}`);
    await db().execute(sql`select commerce.ledger_reverse(${String(entry.id)}::uuid, null, 'Tilbakeføring', ${actor.account.id}::uuid)`);
    await db().execute(sql`update commerce.ledger_books set locked_through = commerce.store_day(store_id, now()) where id = ${book.id}::uuid`);
    await db().execute(sql`update commerce.ledger_waiting set tried_at = now() - interval '25 hours' where book_id = ${book.id}::uuid`);
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 0, waiting: 1 });
  });

  it("posts a Work invoice's payments: the money against the receivable, a reversal turning it back, and one in euro with its difference of exchange", async () => {
    const { storeId, actor } = await workStore();
    const book = await openBook(storeId, actor.account.id);
    const nok = await issued(actor, await client(storeId));
    // The store's day, as an invoice and a payment are dated (not the database's, which is UTC: an hour a night they differ in Norway).
    const [{ d: today }] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as d`);
    const paid = ok(await invoices.recordPayment(actor, { invoiceId: nok, amountMinor: 1_000_000, receivedOn: String(today), method: "bank" })).paymentId;
    const reversal = ok(await invoices.reversePayment(actor, { paymentId: paid })).reversalId;
    const card = ok(await invoices.recordPayment(actor, { invoiceId: nok, amountMinor: 500_000, receivedOn: String(today), method: "card" })).paymentId;

    // The invoice, then its payments, the reversal after the payment it takes back.
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 4, waiting: 0 });
    expect(await entriesOf(book.id, paid)).toEqual([
      { source_kind: "work_payment", account: 1920, amount: 1_000_000, vat_code: null },
      { source_kind: "work_payment", account: 1500, amount: -1_000_000, vat_code: null },
    ]);
    expect(await entriesOf(book.id, reversal)).toEqual([
      { source_kind: "work_payment", account: 1920, amount: -1_000_000, vat_code: null },
      { source_kind: "work_payment", account: 1500, amount: 1_000_000, vat_code: null },
    ]);
    // A card payment is with the payment provider until its payout reaches the bank.
    expect(await entriesOf(book.id, card)).toEqual([
      { source_kind: "work_payment", account: 1579, amount: 500_000, vat_code: null },
      { source_kind: "work_payment", account: 1500, amount: -500_000, vat_code: null },
    ]);
    const [series] = await db().execute<Row>(sql`select array_agg(distinct series order by series) as s from commerce.ledger_entries where book_id = ${book.id}::uuid`);
    expect(series.s).toEqual(["B", "S"]);

    // In euro: the receivable at the invoice's 11.5, the money at the ECB's rate of the day, the difference a gain or a loss.
    const eur = await issued(actor, await client(storeId, "EUR"), { fxRate: "11.5" });
    await db().execute(sql`insert into commerce.ecb_reference_rates (rate_date, currency, rate) values (current_date, 'NOK', 11.62) on conflict do nothing`);
    const [{ rate }] = await db().execute<Row>(sql`select rate::text as rate from commerce.ecb_reference_rates where currency = 'NOK' and rate_date <= current_date order by rate_date desc limit 1`);
    const eurPaid = ok(await invoices.recordPayment(actor, { invoiceId: eur, amountMinor: 1_500_000, receivedOn: String(today), method: "bank" })).paymentId;
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 2, waiting: 0 });
    const money = Math.round(1_500_000 * Number(rate));
    const difference = money - 17_250_000;
    expect(await entriesOf(book.id, eurPaid)).toEqual([
      { source_kind: "work_payment", account: 1920, amount: money, vat_code: null },
      { source_kind: "work_payment", account: 1500, amount: -17_250_000, vat_code: null },
      ...(difference === 0 ? [] : [{ source_kind: "work_payment", account: difference > 0 ? 8060 : 8160, amount: -difference, vat_code: null }]),
    ]);
    // Every entry balances, and the books with it.
    const [sum] = await db().execute<Row>(sql`select coalesce(sum(amount_minor), 0)::bigint::text as s from commerce.ledger_lines where book_id = ${book.id}::uuid`);
    expect(sum.s).toBe("0");

    // VAT by code (step 3b): both invoices' 25 % sales, the euro one in kroner at its own rate; payments carry no VAT.
    expect(await ledger.ledgerVatByCode(book.id, book.opened_on, String(today))).toEqual([{ code: "3", base: 1_200_000 + 13_800_000, vat: 300_000 + 3_450_000 }]);
  });

  it("posts an imported invoice issued in the book's days and its payment, and only the payment of one issued before (D494, D498)", async () => {
    const { storeId, actor } = await workStore();
    const book = await openBook(storeId, actor.account.id);
    const clientId = await client(storeId);
    const [{ d: today }] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as d`);
    // Two imported invoices (history from Life or Tripletex), each paid today: one from before the book, one from after it opened.
    const imported = (issuedOn: string, label: string) =>
      db().transaction(async (t) => {
        await t.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
        const [row] = await t.execute<Row>(sql`
          insert into commerce.work_invoices (store_id, client_id, status, document_number, legacy_number, imported, issued_on, due_on, sent_at, currency, locale, payment_days,
            subtotal_minor, vat_minor, total_minor, seller, buyer)
          values (${storeId}::uuid, ${clientId}::uuid, 'sent', ${label}, ${label}, true, ${issuedOn}::date, ${issuedOn}::date + 14, now(), 'NOK', 'nb-NO', 14,
            100000, 25000, 125000, '{}'::jsonb, '{"name":"Acme AS"}'::jsonb)
          returning id`);
        await t.execute(sql`
          insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, unit, quantity_hundredths, unit_price_minor, discount_bp,
            vat_category, vat_rate, excl_minor, vat_minor, incl_minor, quantity_manual)
          values (${storeId}::uuid, ${String(row.id)}::uuid, 1, 'Rådgivning', 'hour', 100, 100000, 0, 'standard', 0.25, 100000, 25000, 125000, true)`);
        return String(row.id);
      });
    const before = await imported("2020-01-01", "T-1");
    const after = await imported(String(today), "T-2");
    const paidBefore = ok(await invoices.recordPayment(actor, { invoiceId: before, amountMinor: 125_000, receivedOn: String(today), method: "bank" })).paymentId;
    const paidAfter = ok(await invoices.recordPayment(actor, { invoiceId: after, amountMinor: 125_000, receivedOn: String(today), method: "bank" })).paymentId;

    // The first's receivable is in the opening balance: only its payment posts. The second was issued in the book's days: the books are
    // the business's, so it posts as any invoice does, and its payment with it (D498).
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 3, waiting: 0 });
    expect(await entriesOf(book.id, paidBefore)).toHaveLength(2);
    expect(await entriesOf(book.id, paidAfter)).toHaveLength(2);
    const [sale] = await db().execute<Row>(sql`select series from commerce.ledger_entries where book_id = ${book.id}::uuid and source_kind = 'work_invoice' and source_id = ${after}`);
    expect(sale.series).toBe("S");
  });

  it("records a draft as an invoice issued elsewhere, with its own number and day, and posts it (D499)", async () => {
    const { storeId, actor } = await workStore();
    const book = await openBook(storeId, actor.account.id);
    const clientId = await client(storeId);
    const [{ d: today, before }] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as d, (commerce.store_day(${storeId}::uuid, now()) - 3)::text as before`);
    const draft = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
    ok(await invoices.saveLines(actor, draft, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 200, unitPriceMinor: 100_000, discountBp: 0, vatCategory: "standard" }]));

    // A day after today, and a due day before the issue day, are refused; nothing changes.
    const tomorrow = new Date(Date.parse(`${String(today)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(await invoices.recordIssuedElsewhere(actor, { invoiceId: draft, number: "E-77", issuedOn: tomorrow })).toMatchObject({ ok: false });
    expect(await invoices.recordIssuedElsewhere(actor, { invoiceId: draft, number: "E-77", issuedOn: String(before), dueOn: "2000-01-01" })).toMatchObject({ ok: false });

    const recorded = ok(await invoices.recordIssuedElsewhere(actor, { invoiceId: draft, number: "E-77", issuedOn: String(before) }));
    const [row] = await db().execute<Row>(sql`
      select status, imported, legacy_number, document_number, number, issued_on::text as issued, due_on::text as due, total_minor::int as total,
             (select count(*)::int from commerce.work_invoice_lines l where l.invoice_id = i.id) as lines,
             (select count(*)::int from commerce.work_invoices d where d.id = ${draft}::uuid) as drafts
        from commerce.work_invoices i where i.id = ${recorded.invoiceId}::uuid`);
    expect(row).toMatchObject({ status: "sent", imported: true, legacy_number: "E-77", document_number: "E-77", number: null, issued: String(before), total: 250_000, lines: 1, drafts: 0 });
    expect(String(row.due) > String(before)).toBe(true);

    // The same number again is refused.
    const second = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
    ok(await invoices.saveLines(actor, second, [{ description: "Mer", unit: "unit", quantityHundredths: 100, unitPriceMinor: 10_000, discountBp: 0, vatCategory: "standard" }]));
    expect(await invoices.recordIssuedElsewhere(actor, { invoiceId: second, number: "E-77", issuedOn: String(before) })).toEqual({ ok: false, problems: ["An invoice numbered E-77 is here already."] });

    // It posts as any invoice of the book's days.
    await ledger.postDueDocuments(storeId, book);
    const [sale] = await db().execute<Row>(sql`
      select e.series, e.entry_date::text as day, (select sum(l.amount_minor)::int from commerce.ledger_lines l where l.entry_id = e.id and l.account = 1500) as receivable
        from commerce.ledger_entries e where e.book_id = ${book.id}::uuid and e.source_kind = 'work_invoice' and e.source_id = ${recorded.invoiceId}`);
    expect(sale).toEqual({ series: "S", day: String(before), receivable: 250_000 });
  });

  it("posts an entry by hand, the opening balance among them, lists it in the journal and reverses it once", async () => {
    const { storeId, actor } = await workStore();
    const book = await openBook(storeId, actor.account.id);
    await db().execute(sql`
      insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
      select ${storeId}::uuid, ${book.id}::uuid, n, 'Account ' || n, n::text, k from (values (2000, 'equity'), (2050, 'equity')) as a(n, k)`);
    const member = { account: { id: actor.account.id }, store: { id: storeId, timeZone: "Europe/Oslo" } } as unknown as Membership;
    const row = (account: string, debit: string, credit: string) => ({ account, debit, credit, vatCode: "" });
    const [{ d: today }] = await db().execute<Row>(sql`select current_date::text as d`);

    // Rows that do not balance: nothing is posted, and the owner is told why.
    expect(await ledger.postHandEntry(member, { series: "IB", date: String(today), text: "Inngående balanse", rows: [row("1920", "100", ""), row("2000", "", "90")] })).toEqual({
      ok: false,
      problems: ["balance"],
      rows: [],
    });
    const opened = await ledger.postHandEntry(member, {
      series: "IB",
      date: String(today),
      text: "Inngående balanse",
      rows: [row("1920", "250000", ""), row("2000", "", "30000"), row("2050", "", "220000"), row("", "", "")],
    });
    if (!opened.ok) throw new Error(opened.problems.join(","));

    const journal = await ledger.ledgerJournal(book.id);
    expect(journal[0]).toMatchObject({ name: `IB${String(today).slice(0, 4)}-1`, text: "Inngående balanse", sourceKind: null, reverses: null, reversedBy: null });
    expect(journal[0].lines.map((l) => [l.account, l.amount])).toEqual([[1920, 25_000_000], [2000, -3_000_000], [2050, -22_000_000]]);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.ledger_entry_posted'`);
    expect(audited.n).toBe(1);

    // Reversed once: the journal says which turned back which, and a second reversal is refused.
    const reversed = await ledger.reverseLedgerEntry(member, opened.id, String(today));
    expect(reversed.ok).toBe(true);
    const after = await ledger.ledgerJournal(book.id);
    expect(after.find((e) => e.id === opened.id)?.reversedBy).toMatch(/^IB\d{4}-2$/);
    expect(after.find((e) => e.reverses !== null)?.lines.map((l) => l.amount)).toEqual([-25_000_000, 3_000_000, 22_000_000]);
    expect(await ledger.reverseLedgerEntry(member, opened.id, String(today))).toEqual({ ok: false, problem: "reversed" });
  });

  it("posts a shop order's invoice and its card payment by the job, then a refund and the payout that settles them, the provider's balance back to nothing", async () => {
    const shop = await fx.makeStore(`ldg-shop-${run}`);
    const book = await openBook(shop.storeId, shop.ownerId);
    const order = await fx.paidOrder(shop, [["DEMO-MUG-WHITE", 2]]);
    const result = await ledger.runLedgerPosting();
    expect(result.posted).toBeGreaterThanOrEqual(2);
    const rows = await entriesOf(book.id);
    const invoice = rows.filter((r) => r.source_kind === "shop_invoice");
    expect(invoice.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(0);
    expect(invoice.find((r) => r.account === 1500 && Number(r.amount) > 0)).toBeTruthy();
    expect(invoice.find((r) => r.account === 2700 && Number(r.amount) < 0)).toBeTruthy();
    // The card payment moves the receivable to the payment provider until its payout.
    expect(rows.filter((r) => r.source_kind === "shop_payment").map((r) => [r.account, Number(r.amount)])).toEqual([
      [1579, order.total],
      [1500, -order.total],
    ]);

    // A refund of 10.00 back to the card, and the payout of the charge less Stripe's 3.00 fee and the refund.
    const [payment] = await db().execute<Row>(sql`select id from commerce.payments where store_id = ${shop.storeId}::uuid and order_id = ${order.orderId}::uuid`);
    const [refund] = await db().execute<Row>(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind)
      values (${shop.storeId}::uuid, ${String(payment.id)}::uuid, 1000, 'requested_by_customer', 'succeeded', 'money') returning id`);
    const amount = order.total - 300 - 1000;
    const [payout] = await db().execute<Row>(sql`
      insert into commerce.payouts (store_id, provider, provider_reference, provider_account, amount_minor, currency, status, automatic, arrival_on, provider_created_at, lines_read_at, lines_complete)
      values (${shop.storeId}::uuid, 'stripe', ${`po_${run}`}, ${shop.account}, ${amount}, 'NOK', 'paid', true, current_date, now(), now(), true) returning id`);
    await db().execute(sql`
      insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, amount_minor, fee_minor, net_minor, currency, provider_created_at)
      values (${shop.storeId}::uuid, ${String(payout.id)}::uuid, ${`txn_c_${run}`}, 'charge', 'charge', ${order.total}, 300, ${order.total - 300}, 'NOK', now()),
             (${shop.storeId}::uuid, ${String(payout.id)}::uuid, ${`txn_r_${run}`}, 'refund', 'refund', -1000, 0, -1000, 'NOK', now()),
             (${shop.storeId}::uuid, ${String(payout.id)}::uuid, ${`txn_p_${run}`}, 'payout', 'payout', ${-amount}, 0, ${-amount}, 'NOK', now())`);
    // The refund, the payout, and the credit note the refund was given as it was made.
    expect(await ledger.postDueDocuments(shop.storeId, book)).toEqual({ posted: 3, waiting: 0 });
    const [credit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ledger_entries where book_id = ${book.id}::uuid and source_kind = 'shop_credit_note'`);
    expect(credit.n).toBe(1);
    expect((await entriesOf(book.id, String(refund.id))).map((r) => [r.account, Number(r.amount)])).toEqual([
      [1579, -1000],
      [1500, 1000],
    ]);
    expect((await entriesOf(book.id, String(payout.id))).map((r) => [r.account, Number(r.amount)])).toEqual([
      [1920, amount],
      [7770, 300],
      [1579, -(amount + 300)],
    ]);
    const [held] = await db().execute<Row>(sql`select coalesce(sum(amount_minor), 0)::bigint::text as s from commerce.ledger_lines where book_id = ${book.id}::uuid and account = 1579`);
    expect(held.s).toBe("0");
  });

  it("posts a euro order's card payment once its payout says what it was worth in kroner, the difference from the invoice's rate a gain", async () => {
    const shop = await fx.makeStore(`ldg-eur-${run}`, { rates: true });
    const book = await openBook(shop.storeId, shop.ownerId);
    const order = await fx.paidOrder(shop, [["DEMO-MUG-WHITE", 2]], { market: fx.noInEuro });
    await ledger.runLedgerPosting();
    // The invoice is posted in kroner at its own rate; the payment waits until Stripe's payout says what it settled for.
    const owed = (await entriesOf(book.id)).filter((r) => r.source_kind === "shop_invoice" && r.account === 1500).reduce((sum, r) => sum + Number(r.amount), 0);
    expect(owed).toBeGreaterThan(order.total);
    const [payment] = await db().execute<Row>(sql`select id from commerce.payments where store_id = ${shop.storeId}::uuid and order_id = ${order.orderId}::uuid`);
    const [waiting] = await db().execute<Row>(sql`select problem from commerce.ledger_waiting where book_id = ${book.id}::uuid and source_id = ${String(payment.id)}`);
    expect(waiting.problem).toBe("lines");

    // Stripe settled the charge for 25.00 kroner more than it was invoiced at, kept 3.00 and paid out the rest.
    const settled = owed + 2_500;
    const [payout] = await db().execute<Row>(sql`
      insert into commerce.payouts (store_id, provider, provider_reference, provider_account, amount_minor, currency, status, automatic, arrival_on, provider_created_at, lines_read_at, lines_complete)
      values (${shop.storeId}::uuid, 'stripe', ${`po_eur_${run}`}, ${shop.account}, ${settled - 300}, 'NOK', 'paid', true, current_date, now(), now(), true) returning id`);
    await db().execute(sql`
      insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, amount_minor, fee_minor, net_minor, currency, provider_created_at, payment_id, order_id)
      values (${shop.storeId}::uuid, ${String(payout.id)}::uuid, ${`txn_eur_${run}`}, 'charge', 'charge', ${settled}, 300, ${settled - 300}, 'NOK', now(), ${String(payment.id)}::uuid, ${order.orderId}::uuid),
             (${shop.storeId}::uuid, ${String(payout.id)}::uuid, ${`txn_eur_p_${run}`}, 'payout', 'payout', ${-(settled - 300)}, 0, ${-(settled - 300)}, 'NOK', now(), null, null)`);
    await db().execute(sql`update commerce.ledger_waiting set tried_at = now() - interval '2 days' where book_id = ${book.id}::uuid`);
    await ledger.postDueDocuments(shop.storeId, book);
    expect((await entriesOf(book.id, String(payment.id))).map((r) => [r.account, Number(r.amount)])).toEqual([
      [1579, settled],
      [1500, -owed],
      [8060, -2_500],
    ]);
    // The receivable is cleared, and the payout leaves nothing on the provider's balance.
    const sumOf = async (account: number) =>
      Number((await db().execute<Row>(sql`select coalesce(sum(amount_minor), 0)::bigint::text as s from commerce.ledger_lines where book_id = ${book.id}::uuid and account = ${account}`))[0].s);
    expect(await sumOf(1500)).toBe(0);
    expect(await sumOf(1579)).toBe(0);
  });

  it("opens the receivable again when a dispute takes a card payment back, and leaves nothing on the provider's balance", async () => {
    const shop = await fx.makeStore(`ldg-dsp-${run}`);
    const book = await openBook(shop.storeId, shop.ownerId);
    const order = await fx.paidOrder(shop, [["DEMO-MUG-WHITE", 1]]);
    await ledger.runLedgerPosting();
    const [payment] = await db().execute<Row>(sql`select id from commerce.payments where store_id = ${shop.storeId}::uuid and order_id = ${order.orderId}::uuid`);
    // The customer disputes the charge: Stripe takes it back with its 15.00 fee, and the payout takes what is short from the bank.
    const amount = order.total - 300 - order.total - 1_500;
    const [payout] = await db().execute<Row>(sql`
      insert into commerce.payouts (store_id, provider, provider_reference, provider_account, amount_minor, currency, status, automatic, arrival_on, provider_created_at, lines_read_at, lines_complete)
      values (${shop.storeId}::uuid, 'stripe', ${`po_dsp_${run}`}, ${shop.account}, ${amount}, 'NOK', 'paid', true, current_date, now(), now(), true) returning id`);
    const [dispute] = await db().execute<Row>(sql`
      insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, amount_minor, fee_minor, net_minor, currency, provider_created_at, payment_id, order_id)
      values (${shop.storeId}::uuid, ${String(payout.id)}::uuid, ${`txn_dsp_c_${run}`}, 'charge', 'charge', ${order.total}, 300, ${order.total - 300}, 'NOK', now(), ${String(payment.id)}::uuid, ${order.orderId}::uuid),
             (${shop.storeId}::uuid, ${String(payout.id)}::uuid, ${`txn_dsp_d_${run}`}, 'dispute', 'adjustment', ${-order.total}, 1500, ${-order.total - 1500}, 'NOK', now(), ${String(payment.id)}::uuid, ${order.orderId}::uuid)
      returning id`);
    expect(await ledger.postDueDocuments(shop.storeId, book)).toEqual({ posted: 2, waiting: 0 });
    // The dispute's own entry, then the payout: the fees as costs, the bank paying what was short.
    const disputeId = String((await db().execute<Row>(sql`select id from commerce.payout_lines where payout_id = ${String(payout.id)}::uuid and kind = 'dispute'`))[0].id);
    expect(dispute).toBeTruthy();
    expect((await entriesOf(book.id, disputeId)).map((r) => [r.source_kind, r.account, Number(r.amount)])).toEqual([
      ["dispute", 1579, -order.total],
      ["dispute", 1500, order.total],
    ]);
    const sumOf = async (account: number) =>
      Number((await db().execute<Row>(sql`select coalesce(sum(amount_minor), 0)::bigint::text as s from commerce.ledger_lines where book_id = ${book.id}::uuid and account = ${account}`))[0].s);
    expect(await sumOf(1579)).toBe(0);
    expect(await sumOf(7770)).toBe(1_800);
    expect(await sumOf(1920)).toBe(amount);
    // Lost, the order's receivable stays open, for the owner to write off with the accountant.
    expect(await sumOf(1500)).toBe(order.total);
  });

  it("owes a refund to store credit on 2900 and takes the credit off as it is spent on a new order, leaving what the card still holds", async () => {
    const { refundOrder } = await import("./order-admin");
    const { placeOrder, completeOrderPayment } = await import("./checkout");
    const shop = await fx.makeStore(`ldg-gift-${run}`);
    await db().execute(sql`update commerce.stores set features = features || array['gift_cards'] where id = ${shop.storeId}::uuid`);
    const book = await openBook(shop.storeId, shop.ownerId);
    const first = await fx.paidOrder(shop, [["DEMO-MUG-WHITE", 2]]);
    // The whole first order back as store credit: a gift card of the order's amount (D364), and a credit note.
    const credited = await refundOrder(shop.storeId, first.orderId, { amountMinor: first.total, reason: "Goodwill", restock: [], toCredit: true }, shop.ownerId);
    if (!credited.ok || !credited.credit) throw new Error(`no credit: ${JSON.stringify(credited)}`);

    // The credit spent on a second, smaller order, which it pays in full.
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${shop.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${shop.storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${shop.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    await db().execute(sql`insert into commerce.cart_gift_cards (store_id, cart_id, card_id) values (${shop.storeId}::uuid, ${String(cart.id)}::uuid, ${credited.credit.cardId}::uuid)`);
    const placed = await placeOrder({ storeId: shop.storeId, market: fx.no }, String(cart.id), {}, { customerId: null });
    if (!placed.ok) throw new Error(`placeOrder: ${placed.problem}`);
    await db().execute(sql`
      update commerce.orders set email = 'kari@example.com',
        billing_address = '{"name": "Kari Nordmann", "line1": "Kirkeveien 5", "postalCode": "0368", "city": "Oslo", "country": "NO"}'::jsonb,
        shipping_address = '{"name": "Kari Nordmann", "line1": "Kirkeveien 5", "postalCode": "0368", "city": "Oslo", "country": "NO"}'::jsonb
      where id = ${placed.order.orderId}::uuid`);
    const [token] = await db().execute<Row>(sql`
      select id, provider_reference from commerce.payments where store_id = ${shop.storeId}::uuid and order_id = ${placed.order.orderId}::uuid and provider = 'gift_card'`);
    await completeOrderPayment(placed.order.orderId, String(token.provider_reference));
    const spent = placed.order.totalMinor;
    expect(spent).toBeLessThan(first.total);

    await ledger.runLedgerPosting();
    // The refund owes the customer; the card's payment comes off what is owed, never off the bank or the provider's balance.
    expect((await entriesOf(book.id, credited.refundId)).map((r) => [r.account, Number(r.amount)])).toEqual([[2900, -first.total], [1500, first.total]]);
    expect((await entriesOf(book.id, String(token.id))).map((r) => [r.account, Number(r.amount)])).toEqual([[2900, spent], [1500, -spent]]);
    const [owed] = await db().execute<Row>(sql`select coalesce(sum(amount_minor), 0)::bigint::text as s from commerce.ledger_lines where book_id = ${book.id}::uuid and account = 2900`);
    const [card] = await db().execute<Row>(sql`select commerce.gift_card_balance(${credited.credit.cardId}::uuid)::bigint::text as b`);
    expect(Number(owed.s)).toBe(-Number(card.b));
    expect(Number(card.b)).toBe(first.total - spent);
    const [bank] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ledger_lines where book_id = ${book.id}::uuid and account in (1900, 1920)`);
    expect(bank.n).toBe(0);
  });
});
