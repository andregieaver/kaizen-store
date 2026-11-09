import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const watch = await import("./turnover-watch");
const { postLedgerEntry } = await import("./ledger");
const { LEDGER_SERIES } = await import("@/lib/ledger");

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * The threshold watch (D514) against a real database: the turnover over twelve months from the income accounts (net of what was debited
 * back, nothing from before the twelve months), the law's VAT threshold said near and just passed, the owner's own thresholds added, said and
 * taken away, and nothing for a store without books.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

async function books(legalName: string): Promise<{ storeId: string; bookId: string; member: Membership }> {
  const name = `watch-${run}-${legalName.length}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Terskel') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Terskel', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, ${legalName}, 'NO', 'NOK', '2025-01-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k
      from (values (1920, 'asset'), (3000, 'income'), (3100, 'income'), (6800, 'expense')) as a(n, k)`);
  return { storeId, bookId, member: { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership };
}

describe("the threshold watch (D514)", () => {
  it("reads the turnover from the books and says the law's thresholds and the owner's own", async () => {
    const { storeId, bookId, member } = await books("Terskel Enkeltpersonforetak");
    const entry = (date: string, account: number, amount: number) =>
      postLedgerEntry(bookId, { series: LEDGER_SERIES.manual, date, text: "Test", source: null, lines: [{ account, amountMinor: amount, vatCode: null }, { account: 1920, amountMinor: -amount, vatCode: null }] }, member.account.id);
    // Sales of NOK 30 000 and 16 000 and a credit of 1 000 inside the twelve months; NOK 40 000 before them, and a cost, are not turnover.
    expect((await entry("2025-06-01", 3000, -4_000_000)).ok).toBe(true);
    expect((await entry("2026-01-15", 3000, -3_000_000)).ok).toBe(true);
    expect((await entry("2026-09-20", 3100, -1_600_000)).ok).toBe(true);
    expect((await entry("2026-10-01", 3000, 100_000)).ok).toBe(true);
    expect((await entry("2026-10-02", 6800, 50_000)).ok).toBe(true);
    expect(await watch.turnoverOf(bookId, "2026-11-01")).toBe(4_500_000);
    expect(await watch.turnoverOf(bookId, "2026-09-01")).toBe(3_000_000);

    // NOK 45 000 of 50 000: near the VAT registration threshold (from 85 %), and not near the audit limit (this is not an AS).
    const near = await watch.turnoverWatch(storeId, "2026-11-01");
    expect(near?.turnoverMinor).toBe(4_500_000);
    expect(near?.watches.map((w) => [w.kind, w.state])).toEqual([["legal", "near"]]);

    // Past it within the month: said once as passed.
    expect((await entry("2026-10-25", 3000, -1_000_000)).ok).toBe(true);
    expect((await watch.turnoverWatch(storeId, "2026-11-01"))?.watches.map((w) => [w.kind, w.state])).toEqual([["legal", "passed"]]);

    // The owner's own: refused without an amount or a note, then said near and kept.
    expect(await watch.addOwnThreshold(member, { amountMinor: 0, note: "x" })).toEqual({ ok: false, problem: "amount" });
    expect(await watch.addOwnThreshold(member, { amountMinor: 6_000_000, note: "   " })).toEqual({ ok: false, problem: "note" });
    expect(await watch.addOwnThreshold(member, { amountMinor: 6_000_000, note: "  invite   our accountant " })).toEqual({ ok: true });
    const own = await watch.ownThresholds(storeId);
    expect(own).toEqual([{ id: expect.any(String), amountMinor: 6_000_000, currency: "NOK", note: "invite our accountant" }]);
    expect((await watch.turnoverWatch(storeId, "2026-11-01"))?.watches).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "own", state: "near", note: "invite our accountant", amountMinor: 6_000_000 })]),
    );
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.ledger_threshold_added'`);
    expect(Number(audited.n)).toBe(1);

    // Taken away: by this store only, once.
    const other = await books("Annen Butikk AS");
    expect(await watch.removeOwnThreshold(other.member, own[0].id)).toBe(false);
    expect(await watch.removeOwnThreshold(member, own[0].id)).toBe(true);
    expect(await watch.removeOwnThreshold(member, own[0].id)).toBe(false);
    expect(await watch.ownThresholds(storeId)).toEqual([]);

    // A store without books has no watch.
    await db().execute(sql`update commerce.ledger_books set closed_on = '2026-10-31' where id = ${other.bookId}::uuid`);
    expect(await watch.turnoverWatch(other.storeId, "2026-11-01")).toBeNull();
  });
});
