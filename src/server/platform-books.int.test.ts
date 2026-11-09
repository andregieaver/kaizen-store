import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const books = await import("./platform-books");

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/**
 * Kaizena Flow's own money in the books (D508) against a real database, with Stripe as a stand-in: the platform names a store with open
 * books; its live sales are posted there once (kroner with 25 % MVA, a sale in euros at what Stripe settled in kroner), test payments and
 * sales before the book opened never; a credit note's share is posted, and posted again when it changes with the earlier one reversed;
 * a payout read from Stripe is posted against the bank with its fees.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

async function store(name: string, withBooks: boolean): Promise<{ storeId: string; ownerId: string }> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Bøker') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Bøker', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [row] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(row.id);
  if (withBooks) {
    await db().execute(sql`
      insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
      values (${storeId}::uuid, 'Plattform ENK', 'NO', 'NOK', '2026-01-01', ${String(owner.id)}::uuid)`);
  }
  return { storeId, ownerId: String(owner.id) };
}

const linesOf = async (sourceKind: string, sourceId: string) =>
  (
    await db().execute<Row>(sql`
      select e.series, e.entry_date::text as day, e.text, l.account, l.amount_minor::int as amount, l.vat_code
        from commerce.ledger_entries e join commerce.ledger_lines l on l.entry_id = e.id
       where e.source_kind = ${sourceKind} and e.source_id = ${sourceId} order by e.posted_at, l.line`)
  ).map((r) => [r.series, r.day, r.account, r.amount, r.vat_code]);

describe("Kaizena Flow's own money in the books (D508)", () => {
  it("posts live sales, credit notes and payouts once into the books the platform names", async () => {
    const { storeId, ownerId } = await store(`platbooks-${run}`, true);
    const other = await store(`platnobooks-${run}`, false);
    const admin = { id: ownerId } as Account;
    const [before] = await db().execute<Row>(sql`select books_store_id from commerce.platform_settings limit 1`);
    try {
      // Only a store with open books can hold it.
      expect(await books.setPlatformBooks(admin, other.storeId)).toBe(false);
      expect(await books.setPlatformBooks(admin, storeId)).toBe(true);
      expect((await books.platformBooks())?.storeId).toBe(storeId);

      const sale = async (id: string, mode: string, paidAt: string, currency: string, net: number, vat: number) => {
        const [row] = await db().execute<Row>(sql`
          insert into commerce.platform_sales (mode, stripe_invoice_id, number, kind, country, paid_at, currency, net_minor, vat_minor, total_minor)
          values (${mode}, ${`in_${run}${id}`}, ${`KF-${id}`}, ${id === "theme" ? "theme" : "plan"}, ${currency === "NOK" ? "NO" : "DE"}, ${paidAt}::timestamptz, ${currency}, ${net}, ${vat}, ${net + vat})
          returning id`);
        return String(row.id);
      };
      const plan = await sale("plan", "live", "2026-11-02T23:30:00Z", "NOK", 29_900, 7_475);
      const theme = await sale("theme", "live", "2026-11-04T09:00:00Z", "EUR", 4_900, 0);
      const early = await sale("early", "live", "2025-12-20T09:00:00Z", "NOK", 1_000, 250);
      const test = await sale("test", "test", "2026-11-04T09:00:00Z", "NOK", 1_000, 250);

      // Stripe, standing in: the euro invoice's charge settled 573.30 kroner with a 10 krone fee; one paid payout and one on its way.
      const stripe = {
        invoicePayments: { list: async function* () { yield { payment: { type: "charge", charge: "ch_1" } }; } },
        charges: { retrieve: async () => ({ balance_transaction: { amount: 57_330, fee: 1_000, currency: "nok" } }) },
        payouts: { list: async function* () {
          yield { id: `po_${run}a`, status: "paid", arrival_date: Date.parse("2026-11-06T00:00:00Z") / 1000, currency: "nok", amount: 36_100 };
          yield { id: `po_${run}b`, status: "in_transit", arrival_date: Date.parse("2026-11-09T00:00:00Z") / 1000, currency: "nok", amount: 5_000 };
        } },
        balanceTransactions: { list: async function* () {
          yield { type: "charge", fee: 1_275 };
          yield { type: "payout", fee: 0 };
        } },
      } as unknown as Stripe;
      expect(await books.readPlatformPayouts("live", "2026-11-01", stripe)).toBe(1);
      const [payout] = await db().execute<Row>(sql`select id, amount_minor::int as amount, fee_minor::int as fee, arrival_on::text as day from commerce.platform_payouts where stripe_payout_id = ${`po_${run}a`}`);
      expect([payout.amount, payout.fee, payout.day]).toEqual([36_100, 1_275, "2026-11-06"]);

      const now = new Date("2026-11-20T12:00:00Z");
      const first = await books.postPlatformMoney({ stripe, now });
      expect(first.posted).toBeGreaterThanOrEqual(2);
      expect(first.payouts).toBeGreaterThanOrEqual(1);

      // The plan paid 23:30 UTC on 2 November is Oslo's 3 November; the theme at what Stripe settled, as a service abroad.
      expect(await linesOf("platform_sale", plan)).toEqual([
        ["S", "2026-11-03", 1579, 37_375, null],
        ["S", "2026-11-03", 3000, -29_900, "3"],
        ["S", "2026-11-03", 2700, -7_475, "3"],
      ]);
      expect(await linesOf("platform_sale", theme)).toEqual([
        ["S", "2026-11-04", 1579, 57_330, null],
        ["S", "2026-11-04", 3200, -57_330, "52"],
      ]);
      const [settled] = await db().execute<Row>(sql`select settled_minor::int as s, settled_currency as c, fee_minor::int as f from commerce.platform_sales where id = ${theme}::uuid`);
      expect([settled.s, settled.c, settled.f]).toEqual([57_330, "NOK", 1_000]);
      expect(await linesOf("platform_payout", String(payout.id))).toEqual([
        ["B", "2026-11-06", 1920, 36_100, null],
        ["B", "2026-11-06", 7770, 1_275, null],
        ["B", "2026-11-06", 1579, -37_375, null],
      ]);
      // Never a test payment, nor a sale before the book opened.
      expect(await linesOf("platform_sale", test)).toEqual([]);
      expect(await linesOf("platform_sale", early)).toEqual([]);

      // Again: nothing more.
      expect(await books.postPlatformMoney({ stripe, now })).toMatchObject({ posted: 0, payouts: 0 });

      // A credit note for part of the plan, then for all of it: the first share reversed, the whole posted.
      await db().execute(sql`update commerce.platform_sales set credited_minor = 12_500 where id = ${plan}::uuid`);
      expect((await books.postPlatformMoney({ stripe, now })).posted).toBe(1);
      expect(await linesOf("platform_credit", `${plan}:12500`)).toEqual([
        ["S", "2026-11-20", 1579, -12_500, null],
        ["S", "2026-11-20", 3000, 10_000, "3"],
        ["S", "2026-11-20", 2700, 2_500, "3"],
      ]);
      await db().execute(sql`update commerce.platform_sales set credited_minor = total_minor where id = ${plan}::uuid`);
      expect((await books.postPlatformMoney({ stripe, now })).posted).toBe(1);
      const credits = await db().execute<Row>(sql`
        select e.source_id, exists (select 1 from commerce.ledger_entries r where r.reverses = e.id) as reversed
          from commerce.ledger_entries e where e.source_kind = 'platform_credit' and e.source_id like ${`${plan}:%`} order by e.posted_at`);
      expect(credits.map((c) => [c.source_id, c.reversed])).toEqual([
        [`${plan}:12500`, true],
        [`${plan}:37375`, false],
      ]);
      expect(await books.postPlatformMoney({ stripe, now })).toMatchObject({ posted: 0, payouts: 0 });

      const state = await books.platformBooksState();
      expect(state.books?.name).toBeTruthy();
      expect(state.posted).toBeGreaterThanOrEqual(2);
      expect(state.payoutsPosted).toBeGreaterThanOrEqual(1);

      // Not named: nothing is posted anywhere.
      expect(await books.setPlatformBooks(admin, null)).toBe(true);
      expect(await books.postPlatformMoney({ stripe, now })).toEqual({ posted: 0, waiting: 0, payouts: 0 });
    } finally {
      await db().execute(sql`update commerce.platform_settings set books_store_id = ${before ? (before.books_store_id as string | null) : null}::uuid`);
      await db().execute(sql`delete from commerce.platform_sales where stripe_invoice_id like ${`in_${run}%`}`);
      await db().execute(sql`delete from commerce.platform_payouts where stripe_payout_id like ${`po_${run}%`}`);
    }
  });
});
