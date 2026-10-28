import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { eraseOwnAccount, erasePreview, erasedEmail } = await import("./account-erasure");
const { newStore } = await import("./inventory-test-support");
const { auditOf } = await import("./data-test-support");

/**
 * An owner's or staff member's own account erased (wave 10 unit P, D377): refused for the last owner of an open store, a platform admin,
 * a host and a domain's holder, changing nothing; otherwise the account is made anonymous (the row stays for what names it), its
 * memberships, AI manager history, devices and recovery codes are deleted, its applications emptied, its staff emails blanked and its
 * sign-in user deleted; what it did in a store stays.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let store: Awaited<ReturnType<typeof newStore>>;

async function makeAccount(label: string, o: { authUser?: string } = {}): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, auth_user_id) values (${`${label}-${run}@example.com`}, ${`Person ${label}`}, ${o.authUser ?? null}) returning id
  `);
  return String(row.id);
}

async function accountRow(id: string): Promise<Row> {
  const [row] = await db().execute<Row>(sql`select email, name, auth_user_id, disabled_at, platform_admin from commerce.accounts where id = ${id}::uuid`);
  return row;
}

beforeAll(async () => {
  store = await newStore("erase");
});

afterAll(async () => {
  await closeDb();
});

describe("erasing one's own account", () => {
  it("refuses the last owner of a store that is not closed, naming it, and changes nothing", async () => {
    const plan = await eraseOwnAccount({ id: store.accountId });
    expect(plan).toMatchObject({ ok: false, refusal: "last_owner" });
    expect(plan.ok ? [] : plan.stores).toHaveLength(1);
    const [member] = await db().execute<Row>(sql`select count(*)::int as n from commerce.store_members where account_id = ${store.accountId}::uuid`);
    expect(member.n).toBe(1);
    expect((await accountRow(store.accountId)).disabled_at).toBeNull();
  });

  it("refuses a platform admin and the holder of a domain", async () => {
    const admin = await makeAccount("admin");
    await db().execute(sql`update commerce.accounts set platform_admin = true where id = ${admin}::uuid`);
    expect(await eraseOwnAccount({ id: admin })).toEqual({ ok: false, refusal: "platform_admin" });
    const holder = await makeAccount("holder");
    await db().execute(sql`insert into commerce.domain_registrations (account_id, apex, registrar) values (${holder}::uuid, ${`erase-${run}.example`}, 'vercel')`);
    expect(await eraseOwnAccount({ id: holder })).toEqual({ ok: false, refusal: "domains" });
  });

  it("lets a second owner go, anonymising the account and deleting what is only theirs", async () => {
    const authUser = crypto.randomUUID();
    const id = await makeAccount("staff", { authUser });
    const email = `staff-${run}@example.com`;
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${store.storeId}::uuid, ${id}::uuid, 'owner')`);
    await db().execute(sql`insert into commerce.assistant_memories (account_id, kind, source, content) values (${id}::uuid, 'preference', 'told', 'Prefers short answers')`);
    await db().execute(sql`insert into commerce.access_requests (email, name, store_name, message) values (${email}, 'Person staff', 'Theirs', 'Hello')`);
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text) values (${store.storeId}::uuid, 'staff.new_order', ${email}, 'New order', '<p>x</p>', 'x')
    `);
    // Something they did in the store stays, under their (now anonymous) id.
    await db().execute(sql`insert into commerce.customer_notes (store_id, email, body, created_by) values (${store.storeId}::uuid, ${`c-${run}@example.com`}, 'Kept', ${id}::uuid)`);

    const preview = await erasePreview({ id });
    expect(preview).toMatchObject({ ok: true, stores: 1, memories: 1 });

    const deleted: string[] = [];
    const done = await eraseOwnAccount({ id }, { deleteAuthUser: async (user) => void deleted.push(user) });
    expect(done.ok).toBe(true);
    expect(deleted).toEqual([authUser]);

    expect(await accountRow(id)).toMatchObject({ email: erasedEmail(id), name: null, auth_user_id: null, platform_admin: false });
    expect((await accountRow(id)).disabled_at).not.toBeNull();
    const [counts] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.store_members where account_id = ${id}::uuid) as members,
             (select count(*)::int from commerce.assistant_memories where account_id = ${id}::uuid) as memories,
             (select count(*)::int from commerce.access_requests where lower(email) = ${email}) as requests,
             (select count(*)::int from commerce.email_messages where to_address = ${email}) as emails,
             (select count(*)::int from commerce.customer_notes where created_by = ${id}::uuid) as notes
    `);
    expect(counts).toEqual({ members: 0, memories: 0, requests: 0, emails: 0, notes: 1 });
    // The store keeps its own owner.
    const [owners] = await db().execute<Row>(sql`select count(*)::int as n from commerce.store_members where store_id = ${store.storeId}::uuid and role = 'owner'`);
    expect(owners.n).toBe(1);
    const [entry] = (await auditOf(store.storeId, "account.erased")).slice(-1);
    expect(entry).toBeUndefined();
    const [logged] = await db().execute<Row>(sql`select details from commerce.audit_log where action = 'account.erased' and account_id = ${id}::uuid`);
    expect(JSON.stringify(logged.details)).not.toContain(email);
    // A second erasure finds no account.
    expect(await eraseOwnAccount({ id })).toEqual({ ok: false, refusal: "not_found" });
  });
});
