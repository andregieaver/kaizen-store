import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ROLE_TEMPLATES } from "@/lib/permissions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const ledger = await import("./ledger");
const yearEnd = await import("./year-end");
const clients = await import("./books-clients");
const { showsClients } = await import("@/lib/books-clients");

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * Accountants (B6, D512) against a real database: a member in the Accountant role keeps the books; a lock they set is held, so the owner
 * may lock further but never move it back or reopen the year it closes, and the accountant opens it again; the accountant's clients list
 * the store with what its books need.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

let made = 0;
async function setUp() {
  made += 1;
  const name = `acct-${run}-${made}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'O', 'Klient') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Klient', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id, slug, name from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  await db().execute(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Klient ENK', 'NO', 'NOK', '2025-01-01', ${String(owner.id)}::uuid)`);
  const [accountant] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`${name}-rf@example.com`}, 'Regine') returning id`);
  const permissions = ROLE_TEMPLATES.accountant.permissions;
  const [role] = await db().execute<Row>(sql`
    insert into commerce.store_roles (store_id, name, template, permissions)
    values (${storeId}::uuid, 'Accountant', 'accountant', ${sql`array[${sql.join(permissions.map((k) => sql`${k}`), sql`, `)}]::text[]`})
    on conflict do nothing returning id`);
  const roleId = role ? String(role.id) : String((await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${storeId}::uuid and template = 'accountant'`))[0].id);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role, role_id) values (${storeId}::uuid, ${String(accountant.id)}::uuid, 'admin', ${roleId}::uuid)`);
  const storeFacts = { id: storeId, slug: String(store.slug), name: String(store.name), timeZone: "Europe/Oslo" };
  const ownerMember = { account: { id: String(owner.id) }, store: storeFacts, role: "owner" } as unknown as Membership;
  const accountantMember = { account: { id: String(accountant.id) }, store: storeFacts, role: "admin", roleId, permissions } as unknown as Membership;
  return { storeId, ownerMember, accountantMember, accountantId: String(accountant.id), slug: String(store.slug) };
}

const lockOf = async (storeId: string) =>
  (await db().execute<Row>(sql`select locked_through::text as through, lock_held as held from commerce.ledger_books where store_id = ${storeId}::uuid and closed_on is null`))[0];

describe("accountants (D512)", () => {
  it("holds the accountant's lock against the owner, and lets the accountant open it again", async () => {
    const { storeId, ownerMember, accountantMember } = await setUp();
    expect(ledger.locksAsAccountant(accountantMember)).toBe(true);
    expect(ledger.locksAsAccountant(ownerMember)).toBe(false);

    // The owner's own lock is theirs to move.
    expect(await ledger.lockLedgerThrough(ownerMember, "2025-04-30")).toEqual({ ok: true });
    expect(await ledger.lockLedgerThrough(ownerMember, "2025-02-28")).toEqual({ ok: true });
    expect(await lockOf(storeId)).toEqual({ through: "2025-02-28", held: false });

    // The accountant locks: the owner may lock further, never back, never off.
    expect(await ledger.lockLedgerThrough(accountantMember, "2025-06-30")).toEqual({ ok: true });
    expect(await lockOf(storeId)).toEqual({ through: "2025-06-30", held: true });
    expect(await ledger.lockLedgerThrough(ownerMember, "2025-04-30")).toEqual({ ok: false, problem: "held" });
    expect(await ledger.lockLedgerThrough(ownerMember, null)).toEqual({ ok: false, problem: "held" });
    expect(await ledger.lockLedgerThrough(ownerMember, "2025-08-31")).toEqual({ ok: true });
    expect(await lockOf(storeId)).toEqual({ through: "2025-08-31", held: true });

    // The accountant moves it back, and opens it; then it is the owner's to move again.
    expect(await ledger.lockLedgerThrough(accountantMember, "2025-06-30")).toEqual({ ok: true });
    expect(await lockOf(storeId)).toEqual({ through: "2025-06-30", held: true });
    expect(await ledger.lockLedgerThrough(accountantMember, null)).toEqual({ ok: true });
    expect(await lockOf(storeId)).toEqual({ through: null, held: false });
    expect(await ledger.lockLedgerThrough(ownerMember, "2025-03-31")).toEqual({ ok: true });
    expect(await ledger.lockLedgerThrough(ownerMember, null)).toEqual({ ok: true });

    // A year the accountant locked through is reopened by the accountant, not the owner.
    expect(await ledger.lockLedgerThrough(accountantMember, "2025-12-31")).toEqual({ ok: true });
    expect(await yearEnd.reopenYear(ownerMember, 2025)).toEqual({ ok: false, problem: "held" });
    expect(await yearEnd.reopenYear(accountantMember, 2025)).toEqual({ ok: true });
    expect(await lockOf(storeId)).toEqual({ through: null, held: false });
  });

  it("lists the accountant's clients with what their books need", async () => {
    const { accountantId, slug } = await setUp();
    const stores = await clients.booksClientStores({ id: accountantId });
    expect(stores).toEqual([{ owner: false }]);
    expect(showsClients(stores)).toBe(true);
    const list = await clients.booksClients({ id: accountantId }, new Date("2026-03-05T12:00:00Z"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug, owner: false, keeps: true, bankWaiting: 0, billsDue: 0, inboxWaiting: 0 });
    // January–February 2026 has ended and the books are not locked through it: its VAT is the one to report, due 10 April.
    expect(list[0].book?.lockedThrough).toBeNull();
    expect(list[0].vatTotalMinor).toBe(0);
  });
});
