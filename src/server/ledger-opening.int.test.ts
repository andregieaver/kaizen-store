import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { connectTripletex } = await import("./tripletex");
const { fakeTripletex } = await import("./tripletex-test-support");
const { postOpeningFromTripletex, hasOpeningBalance } = await import("./ledger-opening");
const ledger = await import("./ledger");

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * Our own ledger's step 2d (D478) against a real database and Tripletex in memory: the books open on 1 July, and the opening balance is
 * read from Tripletex's balance sheet for the first half of the year: the balance sheet accounts at what they held, the year's sales and
 * costs at what they moved, and a second bank account of the company's own added to the chart as the standard account it reports as.
 * Posted once in the opening balance's series; reversed, it is read again; a trial balance that does not add up is refused.
 */

const run = Date.now().toString(36);
const BASE = 300_000 + Math.floor(Math.random() * 600_000) * 10;
const token = (label: string) => ["test-tlxr", `eyJhbGciOiJIUzI1NiJ9.${label}.signature0123456789`].join("_");

afterAll(async () => {
  await closeDb();
});

let made = 0;

async function store(): Promise<{ storeId: string; ownerId: string; org: string }> {
  const name = `lopen-${run}-${++made}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [created] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const org = `9${String(40_000_000 + (BASE % 1000) + made).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO'
    where id = ${String(created.id)}::uuid`);
  return { storeId: String(created.id), ownerId: String(owner.id), org };
}

describe("the opening balance read from Tripletex", () => {
  it("posts what each account held the day before the books opened, once, and reads it again after a reversal", async () => {
    const { storeId, ownerId, org } = await store();
    const tx = fakeTripletex({ companyId: BASE + 1, organizationNumber: org });
    tx.apiTokens.add(token(String(BASE + 1)));
    const connected = await connectTripletex(ownerId, storeId, token(String(BASE + 1)), { fetch: tx.fetch });
    if (!connected.ok) throw new Error(connected.problem);
    const member = { account: { id: ownerId }, store: { id: storeId, timeZone: "Europe/Oslo" } } as unknown as Membership;

    // The books here open on 1 July; until then the company kept them in Tripletex. The chart holds the bank and the receivable so far.
    const [row] = await db().execute<Row>(sql`
      insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
      values (${storeId}::uuid, 'Konsulent AS', 'NO', 'NOK', '2027-07-01', ${ownerId}::uuid) returning id`);
    const opened = { book: { id: String(row.id) } };
    await db().execute(sql`
      insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
      select ${storeId}::uuid, ${opened.book.id}::uuid, n, 'Account ' || n, n::text, k from (values (1500, 'asset'), (1920, 'asset')) as a(n, k)`);
    const asked: { dateFrom: string; dateTo: string }[] = [];
    let sheet = [
      { account: { number: 1500, name: "Kundefordringer" }, balanceIn: 5_000, balanceChange: 7_500, balanceOut: 12_500 },
      { account: { number: 1920, name: "Bankinnskudd" }, balanceIn: 100_000, balanceChange: 40_000, balanceOut: 140_000 },
      { account: { number: 1921, name: "Sparekonto" }, balanceIn: 0, balanceChange: 20_000.5, balanceOut: 20_000.5 },
      { account: { number: 2050, name: "Annen egenkapital" }, balanceIn: -105_000, balanceChange: 0, balanceOut: -105_000 },
      { account: { number: 2700, name: "Utgående mva" }, balanceIn: 0, balanceChange: -17_500.5, balanceOut: -17_500.5 },
      { account: { number: 3000, name: "Salgsinntekt" }, balanceIn: 0, balanceChange: -70_000, balanceOut: -70_000 },
      { account: { number: 6800, name: "Kontorrekvisita" }, balanceIn: 0, balanceChange: 20_000, balanceOut: 20_000 },
    ];
    tx.balanceSheet = (period) => {
      asked.push(period);
      return sheet;
    };

    const result = await postOpeningFromTripletex(member, { fetch: tx.fetch });
    expect(result).toEqual({ ok: true, id: expect.any(String), accounts: 7, carriedMinor: 0 });
    // The first half of the year, the day the books open left out.
    expect(asked).toEqual([{ dateFrom: "2027-01-01", dateTo: "2027-07-01" }]);
    const [entry] = await db().execute<Row>(sql`select series, entry_date::text as day, text from commerce.ledger_entries where id = ${result.ok ? result.id : ""}::uuid`);
    expect(entry).toEqual({ series: "IB", day: "2027-07-01", text: "Inngående balanse fra Tripletex" });
    const lines = await db().execute<Row>(sql`select account, amount_minor::bigint::text as amount from commerce.ledger_lines where entry_id = ${result.ok ? result.id : ""}::uuid order by line`);
    expect(lines.map((l) => [Number(l.account), Number(l.amount)])).toEqual([
      [1500, 1_250_000],
      [1920, 14_000_000],
      [1921, 2_000_050],
      [2050, -10_500_000],
      [2700, -1_750_050],
      [3000, -7_000_000],
      [6800, 2_000_000],
    ]);
    // Tripletex's second bank account joins the chart, reporting as the standard bank account.
    const [savings] = await db().execute<Row>(sql`select name, standard from commerce.ledger_accounts where book_id = ${opened.book.id}::uuid and number = 1921`);
    expect(savings).toEqual({ name: "Sparekonto", standard: "1920" });
    expect(await hasOpeningBalance(opened.book.id)).toBe(true);

    // Posted once: a second press posts nothing more.
    expect(await postOpeningFromTripletex(member, { fetch: tx.fetch })).toEqual({ ok: false, problem: "posted" });

    // Reversed in the journal, it can be read again; a balance sheet that does not add up is refused and posts nothing.
    const reversed = await ledger.reverseLedgerEntry(member, result.ok ? result.id : "", "2027-07-01");
    expect(reversed.ok).toBe(true);
    expect(await hasOpeningBalance(opened.book.id)).toBe(false);
    sheet = [...sheet, { account: { number: 1900, name: "Kontanter" }, balanceIn: 0, balanceChange: 0.01, balanceOut: 0.01 }];
    expect(await postOpeningFromTripletex(member, { fetch: tx.fetch })).toEqual({ ok: false, problem: "unbalanced", differenceMinor: 1 });
    sheet = sheet.slice(0, -1);
    const again = await postOpeningFromTripletex(member, { fetch: tx.fetch });
    expect(again).toMatchObject({ ok: true, accounts: 7 });
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.ledger_opening_posted'`);
    expect(audited.n).toBe(2);
  });

  it("on 1 January reads what each account held as the day began, and puts last year's uncarried result on other equity", async () => {
    const { storeId, ownerId, org } = await store();
    const tx = fakeTripletex({ companyId: BASE + 2, organizationNumber: org });
    tx.apiTokens.add(token(String(BASE + 2)));
    const connected = await connectTripletex(ownerId, storeId, token(String(BASE + 2)), { fetch: tx.fetch });
    if (!connected.ok) throw new Error(connected.problem);
    const member = { account: { id: ownerId }, store: { id: storeId, timeZone: "Europe/Oslo" } } as unknown as Membership;
    await db().execute(sql`
      insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
      values (${storeId}::uuid, 'Konsulent AS', 'NO', 'NOK', '2028-01-01', ${ownerId}::uuid)`);
    const asked: { dateFrom: string; dateTo: string }[] = [];
    // Last year's sales of 30 000 were never closed into equity in Tripletex: the sales account still holds them as the year begins.
    tx.balanceSheet = (period) => {
      asked.push(period);
      return [
        { account: { number: 1920, name: "Bankinnskudd" }, balanceIn: 80_000, balanceChange: 1_000, balanceOut: 81_000 },
        { account: { number: 2050, name: "Annen egenkapital" }, balanceIn: -50_000, balanceChange: 0, balanceOut: -50_000 },
        { account: { number: 3000, name: "Salgsinntekt" }, balanceIn: -30_000, balanceChange: -1_000, balanceOut: -31_000 },
      ];
    };
    const result = await postOpeningFromTripletex(member, { fetch: tx.fetch });
    expect(asked).toEqual([{ dateFrom: "2028-01-01", dateTo: "2028-01-02" }]);
    expect(result).toMatchObject({ ok: true, accounts: 3, carriedMinor: -3_000_000 });
    const lines = await db().execute<Row>(sql`select account, amount_minor::bigint::text as amount, text from commerce.ledger_lines where entry_id = ${result.ok ? result.id : ""}::uuid order by line`);
    // The day's own movement and last year's sales stay out; the result they leave is on other equity, said so.
    expect(lines.map((l) => [Number(l.account), Number(l.amount), l.text])).toEqual([
      [1920, 8_000_000, null],
      [2050, -5_000_000, null],
      [2050, -3_000_000, "Resultat fra tidligere år, ikke overført til egenkapital"],
    ]);
  });
});
