import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const fx = await import("./invoice-test-fixture");
const ledger = await import("./ledger");

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

    // The books locked through today: a new invoice waits with why, and is not tried again the same day.
    await db().execute(sql`update commerce.ledger_books set locked_through = current_date where id = ${book.id}::uuid`);
    await issued(actor, await client(storeId));
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 0, waiting: 1 });
    expect(await ledger.ledgerWaiting(book.id)).toMatchObject([{ kind: "work_invoice", problem: "locked" }]);
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 0, waiting: 0 });

    // A person reverses the posted NOK invoice: the job leaves it be. A day later what waits is tried again (still locked).
    await db().execute(sql`update commerce.ledger_books set locked_through = null where id = ${book.id}::uuid`);
    const [entry] = await db().execute<Row>(sql`select id from commerce.ledger_entries where book_id = ${book.id}::uuid and source_id = ${nok}`);
    await db().execute(sql`select commerce.ledger_reverse(${String(entry.id)}::uuid, null, 'Tilbakeføring', ${actor.account.id}::uuid)`);
    await db().execute(sql`update commerce.ledger_books set locked_through = current_date where id = ${book.id}::uuid`);
    await db().execute(sql`update commerce.ledger_waiting set tried_at = now() - interval '25 hours' where book_id = ${book.id}::uuid`);
    expect(await ledger.postDueDocuments(storeId, book)).toEqual({ posted: 0, waiting: 1 });
  });

  it("posts a Work invoice's payments: the money against the receivable, a reversal turning it back, and one in euro with its difference of exchange", async () => {
    const { storeId, actor } = await workStore();
    const book = await openBook(storeId, actor.account.id);
    const nok = await issued(actor, await client(storeId));
    const [{ d: today }] = await db().execute<Row>(sql`select current_date::text as d`);
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

  it("posts a shop order's invoice, by the dispatcher's job", async () => {
    const shop = await fx.makeStore(`ldg-shop-${run}`);
    const book = await openBook(shop.storeId, shop.ownerId);
    await fx.paidOrder(shop, [["DEMO-MUG-WHITE", 2]]);
    const result = await ledger.runLedgerPosting();
    expect(result.posted).toBeGreaterThanOrEqual(1);
    const rows = await entriesOf(book.id);
    expect(rows.every((r) => r.source_kind === "shop_invoice")).toBe(true);
    expect(rows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(0);
    expect(rows.find((r) => r.account === 1500 && Number(r.amount) > 0)).toBeTruthy();
    expect(rows.find((r) => r.account === 2700 && Number(r.amount) < 0)).toBeTruthy();
  });
});
