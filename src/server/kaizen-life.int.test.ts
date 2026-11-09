import type { SupabaseClient, User } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const life = await import("./kaizen-life");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const owner = `life-owner-${run}@example.com`;
const staff = `life-staff-${run}@example.com`;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${owner}, 'Kari', 'Liv') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`life-${run}`}, 'Liv', null) as id
  `);
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${staff}, 'Ola') returning id`);
  await db().execute(sql`
    insert into commerce.store_members (store_id, account_id, role) values (${String(store.id)}::uuid, ${String(account.id)}::uuid, 'admin')
  `);
});

afterAll(async () => {
  await closeDb();
});

/** A Supabase client that only records signing out, and a user signed in with Kaizen Life. */
function signedIn(email: string) {
  const signOut = vi.fn(async () => ({ error: null }));
  const supabase = { auth: { signOut } } as unknown as SupabaseClient;
  const user = {
    id: crypto.randomUUID(),
    email,
    identities: [{ provider: life.KAIZEN_LIFE_PROVIDER, identity_data: { full_name: "Kari Nordmann", email } }],
  } as unknown as User;
  return { supabase, user, signOut };
}

describe("signing in with Kaizen Life (D95)", () => {
  it("admits a store's owner, linking the Kaizen Life user to the account", async () => {
    const { supabase, user, signOut } = signedIn(owner);
    expect(await life.admitFromKaizenLife(supabase, user)).toEqual({ kind: "admitted" });
    expect(signOut).not.toHaveBeenCalled();
    const [account] = await db().execute<Row>(sql`select auth_user_id from commerce.accounts where email = ${owner}`);
    expect(account.auth_user_id).toBe(user.id);
  });

  it("turns away staff, and sends someone without an account to ask for a store", async () => {
    const other = signedIn(staff);
    expect(await life.admitFromKaizenLife(other.supabase, other.user)).toEqual({ kind: "owners-only" });
    expect(other.signOut).toHaveBeenCalled();
    const stranger = signedIn(`nobody-${run}@example.com`);
    expect(await life.admitFromKaizenLife(stranger.supabase, stranger.user)).toEqual({
      kind: "no-account",
      email: `nobody-${run}@example.com`,
      name: "Kari Nordmann",
    });
    expect(stranger.signOut).toHaveBeenCalled();
  });
});

describe("signing in with Kaizen Life once the accounts are linked (D507)", () => {
  it("admits staff linked to this Kaizen Life user whatever their role, and not through someone else's link", async () => {
    const email = `life-linked-staff-${run}@example.com`;
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${`life-${run}`}`);
    const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, 'Per') returning id`);
    await db().execute(sql`
      insert into commerce.store_members (store_id, account_id, role) values (${String(store.id)}::uuid, ${String(account.id)}::uuid, 'admin')
    `);
    const lifeUserId = crypto.randomUUID();
    const signOut = vi.fn(async () => ({ error: null }));
    const supabase = { auth: { signOut } } as unknown as SupabaseClient;
    const user = {
      id: crypto.randomUUID(),
      email,
      identities: [{ provider: life.KAIZEN_LIFE_PROVIDER, id: lifeUserId, identity_data: { sub: lifeUserId, email } }],
    } as unknown as User;
    expect(await life.admitFromKaizenLife(supabase, user)).toEqual({ kind: "owners-only" });
    // Linked to another Kaizen Life user: still not this one's way in.
    await db().execute(sql`
      insert into commerce.kaizen_life_accounts (account_id, life_user_id, how) values (${String(account.id)}::uuid, ${crypto.randomUUID()}::uuid, 'email')
    `);
    expect(await life.admitFromKaizenLife(supabase, user)).toEqual({ kind: "owners-only" });
    await db().execute(sql`delete from commerce.kaizen_life_accounts where account_id = ${String(account.id)}::uuid`);
    await db().execute(sql`
      insert into commerce.kaizen_life_accounts (account_id, life_user_id, how) values (${String(account.id)}::uuid, ${lifeUserId}::uuid, 'email')
    `);
    signOut.mockClear();
    expect(await life.admitFromKaizenLife(supabase, user)).toEqual({ kind: "admitted" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("reads the Kaizen Life user from the identity's subject, and nothing that is no user id", () => {
    const id = "7D1E2C64-6F0A-4B55-9D3E-2A3B4C5D6E7F";
    expect(life.lifeUserIdOf({ id: "x", identity_data: { sub: id } })).toBe(id.toLowerCase());
    expect(life.lifeUserIdOf({ id, identity_data: {} })).toBe(id.toLowerCase());
    expect(life.lifeUserIdOf({ id: "not-a-uuid", identity_data: { sub: "life-user" } })).toBeNull();
    expect(life.lifeUserIdOf(undefined)).toBeNull();
  });
});
