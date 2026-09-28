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
