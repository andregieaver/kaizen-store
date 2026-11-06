import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COPY_RULES } from "@/lib/store-copy-rules";
import { STORE_EXPORT_LEFT_OUT } from "@/lib/store-export-scope";

import { createTestDatabase } from "./testing";

/**
 * Our own ledger (B2, D478): the rules the database holds, run against real Postgres (PGlite) with every migration applied. Entries are
 * posted only by `commerce.ledger_post()`: balanced, of two lines or more on active accounts of their own book, dated within its days and
 * after its lock, numbered in their series and year without gaps, and posted once for what they were posted from. Nothing posted is ever
 * changed or deleted; a reversal puts a mistake right, once. A book keeps what it opened with and is never deleted.
 */

let db: PGlite;
let shop: string;
let book: string;
let otherBook: string;
let account: string;

type Row = Record<string, unknown>;

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function store(slug: string): Promise<string> {
  return (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug])).id;
}

async function openBook(storeId: string, openedOn = "2027-01-01"): Promise<string> {
  const { id } = await one<{ id: string }>(
    "insert into commerce.ledger_books (store_id, legal_name, organisation_number, country, currency, opened_on) values ($1, 'Human Web AS', '999999999', 'NO', 'NOK', $2) returning id",
    [storeId, openedOn],
  );
  for (const [number, kind] of [
    [1500, "asset"],
    [1920, "asset"],
    [2000, "equity"],
    [2700, "liability"],
    [3000, "income"],
    [7770, "expense"],
  ] as const) {
    await db.query("insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind) values ($1, $2, $3, $4, $5, $6)", [storeId, id, number, `Account ${number}`, String(number), kind]);
  }
  return id;
}

const lines = (...pairs: [number, number][]) => JSON.stringify(pairs.map(([acct, amount]) => ({ account: acct, amount })));

const post = (b: string, date: string, l: string, o: { series?: string; source?: [string, string] } = {}) =>
  one<{ id: string }>("select commerce.ledger_post($1, $2, $3::date, 'An entry', $4, $5, $6::jsonb, $7) as id", [b, o.series ?? "S", date, o.source?.[0] ?? null, o.source?.[1] ?? null, l, account]);

const sale = lines([1500, 125_000], [3000, -100_000], [2700, -25_000]);

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await store("ledger-shop");
  account = (await one<{ id: string }>("insert into commerce.accounts (email) values ('owner@example.com') returning id")).id;
  book = await openBook(shop);
  otherBook = await openBook(await store("ledger-other"));
});

afterAll(async () => {
  await db?.close();
});

describe("posting", () => {
  it("numbers entries in their series and year without gaps, and keeps their lines", async () => {
    const first = await post(book, "2027-01-14", sale);
    const second = await post(book, "2027-02-01", sale);
    const manual = await post(book, "2027-02-01", lines([1920, 3_000_000], [2000, -3_000_000]), { series: "M" });
    const nextYear = await post(book, "2028-01-03", sale);
    const numbers = await db.query<Row>("select series, year, number from commerce.ledger_entries where id = any($1::uuid[]) order by posted_at, number", [[first.id, second.id, manual.id, nextYear.id]]);
    expect(numbers.rows).toEqual([
      { series: "S", year: 2027, number: 1 },
      { series: "S", year: 2027, number: 2 },
      { series: "M", year: 2027, number: 1 },
      { series: "S", year: 2028, number: 1 },
    ]);
    const kept = await db.query<Row>("select line, account, amount_minor::int as amount from commerce.ledger_lines where entry_id = $1 order by line", [first.id]);
    expect(kept.rows).toEqual([
      { line: 1, account: 1500, amount: 125_000 },
      { line: 2, account: 3000, amount: -100_000 },
      { line: 3, account: 2700, amount: -25_000 },
    ]);
  });

  it("refuses an entry that does not balance, has one line or a zero, or a line on an account not active in its own book", async () => {
    await rejects("select commerce.ledger_post($1, 'S', '2027-03-01', 'x', null, null, $2::jsonb, null)", [book, lines([1500, 100], [3000, -99])], /ledger\.balance/);
    await rejects("select commerce.ledger_post($1, 'S', '2027-03-01', 'x', null, null, $2::jsonb, null)", [book, lines([1500, 0], [3000, 0])], /ledger\.zero/);
    await rejects("select commerce.ledger_post($1, 'S', '2027-03-01', 'x', null, null, $2::jsonb, null)", [book, lines([1500, 100])], /ledger\.lines/);
    await rejects("select commerce.ledger_post($1, 'S', '2027-03-01', 'x', null, null, $2::jsonb, null)", [book, lines([1500, 100], [3999, -100])], /ledger\.account/);
    await db.query("update commerce.ledger_accounts set active = false where book_id = $1 and number = 7770", [book]);
    await rejects("select commerce.ledger_post($1, 'S', '2027-03-01', 'x', null, null, $2::jsonb, null)", [book, lines([1920, -100], [7770, 100])], /ledger\.account/);
    await db.query("update commerce.ledger_accounts set active = true where book_id = $1 and number = 7770", [book]);
    // Nothing was numbered by the refusals: the next is the next.
    const next = await post(book, "2027-03-01", sale);
    expect(await one("select number from commerce.ledger_entries where id = $1", [next.id])).toEqual({ number: 3 });
  });

  it("is the only way in, and nothing posted is changed or deleted", async () => {
    const { id } = await post(book, "2027-03-02", sale);
    await rejects(
      "insert into commerce.ledger_entries (store_id, book_id, series, year, number, entry_date, text) values ($1, $2, 'S', 2027, 99, '2027-03-02', 'sneaked')",
      [shop, book],
      /ledger\.writer/,
    );
    await rejects("update commerce.ledger_entries set text = 'changed' where id = $1", [id], /ledger\.fixed/);
    await rejects("update commerce.ledger_lines set amount_minor = 1 where entry_id = $1 and line = 1", [id], /ledger\.fixed/);
    await rejects("delete from commerce.ledger_lines where entry_id = $1", [id], /ledger\.fixed/);
    await rejects("delete from commerce.ledger_entries where id = $1", [id], /ledger\.fixed/);
    await rejects("update commerce.ledger_counters set last = 1 where book_id = $1", [book], /ledger\.writer/);
  });

  it("keeps entries within the book's days and after its lock", async () => {
    await rejects("select commerce.ledger_post($1, 'S', '2026-12-31', 'x', null, null, $2::jsonb, null)", [book, sale], /ledger\.open/);
    await db.query("update commerce.ledger_books set locked_through = '2027-01-31' where id = $1", [book]);
    await rejects("select commerce.ledger_post($1, 'S', '2027-01-31', 'x', null, null, $2::jsonb, null)", [book, sale], /ledger\.locked/);
    await post(book, "2027-02-01", sale);
  });
});

describe("what a document posts", () => {
  it("is posted once, and again only after it was reversed", async () => {
    const first = await post(book, "2027-04-01", sale, { source: ["work_invoice", "inv-42"] });
    expect((await post(book, "2027-04-01", sale, { source: ["work_invoice", "inv-42"] })).id).toBe(first.id);
    // The same source in another book is another posting.
    expect((await post(otherBook, "2027-04-01", sale, { source: ["work_invoice", "inv-42"] })).id).not.toBe(first.id);
    const reversal = await one<{ id: string }>("select commerce.ledger_reverse($1, null, 'Reversal', $2) as id", [first.id, account]);
    const again = await post(book, "2027-04-02", sale, { source: ["work_invoice", "inv-42"] });
    expect(again.id).not.toBe(first.id);
    expect(await one("select reverses, entry_date::text as day from commerce.ledger_entries where id = $1", [reversal.id])).toEqual({ reverses: first.id, day: "2027-04-01" });
  });
});

describe("a reversal", () => {
  it("turns every line's sign, in the entry's series, once, and is not itself reversed", async () => {
    const { id } = await post(book, "2027-05-01", sale);
    const reversal = await one<{ id: string }>("select commerce.ledger_reverse($1, '2027-05-02', 'Reversal', $2) as id", [id, account]);
    const turned = await db.query<Row>("select account, amount_minor::int as amount from commerce.ledger_lines where entry_id = $1 order by line", [reversal.id]);
    expect(turned.rows).toEqual([
      { account: 1500, amount: -125_000 },
      { account: 3000, amount: 100_000 },
      { account: 2700, amount: 25_000 },
    ]);
    await rejects("select commerce.ledger_reverse($1, '2027-05-03', 'Again', null)", [id], /ledger\.reversed/);
    await rejects("select commerce.ledger_reverse($1, '2027-05-03', 'Of a reversal', null)", [reversal.id], /ledger\.reverses/);
    // The book still balances, in every account and in all.
    expect(await one("select sum(amount_minor)::int as total from commerce.ledger_lines where book_id = $1", [book])).toEqual({ total: 0 });
  });
});

describe("a book", () => {
  it("keeps what it opened with, is one open book a store, closes once after its last entry, and is never deleted", async () => {
    await rejects("update commerce.ledger_books set currency = 'EUR' where id = $1", [book], /ledger_books\.fixed/);
    await rejects("delete from commerce.ledger_books where id = $1", [book], /ledger_books\.kept/);
    await rejects(
      "insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on) values ($1, 'Second AS', 'NO', 'NOK', '2027-06-01')",
      [shop],
      /ledger_books_open_key/,
    );
    await rejects("update commerce.ledger_books set closed_on = '2027-03-31' where id = $1", [book], /ledger_books\.closed/);
    const closing = await openBook(await store("ledger-closing"));
    await db.query("update commerce.ledger_books set closed_on = '2027-12-31' where id = $1", [closing]);
    await rejects("update commerce.ledger_books set closed_on = '2028-12-31' where id = $1", [closing], /ledger_books\.closed/);
    await rejects("select commerce.ledger_post($1, 'S', '2028-01-01', 'x', null, null, $2::jsonb, null)", [closing, sale], /ledger\.open/);
  });

  it("keeps an account's kind once it has postings, and its lines keep it from being deleted", async () => {
    await rejects("update commerce.ledger_accounts set kind = 'expense' where book_id = $1 and number = 3000", [book], /ledger_accounts\.kind/);
    await rejects("delete from commerce.ledger_accounts where book_id = $1 and number = 3000", [book], /ledger_lines_account_fk/);
    await db.query("update commerce.ledger_accounts set name = 'Sales, high rate' where book_id = $1 and number = 3000", [book]);
  });
});

describe("where the books' rows go", () => {
  it("are the store's own: never copied to another store, and left out of the whole-store file for the SAF-T export (B5)", () => {
    for (const table of ["ledger_books", "ledger_accounts", "ledger_entries", "ledger_lines", "ledger_counters"]) {
      expect(COPY_RULES[table], table).toBeDefined();
      expect(STORE_EXPORT_LEFT_OUT[table], table).toBeDefined();
    }
  });
});
