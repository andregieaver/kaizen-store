import "server-only";

import { sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db/client";
import { createClient } from "@/lib/supabase/server";

import { getStore, type Store } from "./stores";

export type Role = "owner" | "admin";

/** A person who can sign in (docs/platform.md, P5). */
export type Account = {
  id: string;
  email: string;
  name: string | null;
  platformAdmin: boolean;
};

/** An account's access to one store. */
export type Membership = { account: Account; store: Store; role: Role };

export type StoreSummary = { slug: string; name: string; role: Role };

type Row = Record<string, unknown>;

const toAccount = (row: Row): Account => ({
  id: String(row.id),
  email: String(row.email),
  name: row.name ? String(row.name) : null,
  platformAdmin: Boolean(row.platform_admin),
});

/**
 * The signed-in account, or null. The Supabase session token is verified
 * (not just read from the cookie) and must belong to an active account.
 */
export const getAccount = cache(async (): Promise<Account | null> => {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return null; // Supabase is not configured (e.g. in CI).
  }
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return null;

  const [row] = await db().execute<Row>(sql`
    select id, email, name, platform_admin from commerce.accounts
    where auth_user_id = ${userId}::uuid and disabled_at is null
  `);
  return row ? toAccount(row) : null;
});

/** For pages and actions: the account, or a redirect to sign in. */
export async function requireAccount(): Promise<Account> {
  const account = await getAccount();
  if (!account) redirect("/admin/sign-in");
  return account;
}

/**
 * For platform pages and actions: a platform admin's account; anyone else
 * signs in or is not found. Every platform page asks for itself: a
 * layout's check does not stop its page rendering (and streaming its data)
 * alongside it.
 */
export async function requirePlatformAdmin(): Promise<Account> {
  const account = await requireAccount();
  if (!account.platformAdmin) notFound();
  return account;
}

/** The stores an account works in, by name. */
export async function listStores(account: Account): Promise<StoreSummary[]> {
  const rows = await db().execute<Row>(sql`
    select s.slug, s.name, m.role
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${account.id}::uuid and m.disabled_at is null
      and s.status <> 'closed'
    order by lower(s.name), s.slug
  `);
  return rows.map((row) => ({
    slug: String(row.slug),
    name: String(row.name),
    role: row.role as Role,
  }));
}

/** The signed-in account's membership of a store, or null. */
export const getMembership = cache(async (storeSlug: string): Promise<Membership | null> => {
  const account = await getAccount();
  if (!account) return null;
  const store = await getStore(storeSlug);
  if (!store || store.status === "closed") return null;

  const [row] = await db().execute<Row>(sql`
    select role from commerce.store_members
    where store_id = ${store.id}::uuid and account_id = ${account.id}::uuid
      and disabled_at is null
  `);
  return row ? { account, store, role: row.role as Role } : null;
});

/**
 * For store admin pages and actions: the membership, a redirect to sign in,
 * or a 404 for a store the account does not work in (so store names cannot
 * be probed).
 */
export async function requireMember(storeSlug: string): Promise<Membership> {
  await requireAccount();
  const membership = await getMembership(storeSlug);
  if (!membership) notFound();
  return membership;
}

/**
 * Whether a sign-in link may be sent to this email: an active account that
 * works in at least one store or runs the platform.
 */
export async function canSignIn(email: string): Promise<boolean> {
  return (await signInAccount(email)) !== null;
}

/**
 * The same check as canSignIn, also saying whether the account has signed in
 * before (and so has a Supabase Auth user that a password can be reset for).
 */
export async function signInAccount(email: string): Promise<{ linked: boolean } | null> {
  const [row] = await db().execute<Row>(sql`
    select a.auth_user_id is not null as linked from commerce.accounts a
    where lower(a.email) = lower(${email}) and a.disabled_at is null
      and (a.platform_admin or exists (
        select 1 from commerce.store_members m
        where m.account_id = a.id and m.disabled_at is null
      ))
  `);
  return row ? { linked: Boolean(row.linked) } : null;
}

/**
 * Links a Supabase Auth user to the account with the same email, on first
 * sign-in. Returns null if the email has no active account.
 */
export async function linkAccount(authUserId: string, email: string): Promise<Account | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.accounts
       set auth_user_id = ${authUserId}::uuid
     where lower(email) = lower(${email})
       and disabled_at is null
       and (auth_user_id is null or auth_user_id = ${authUserId}::uuid)
    returning id, email, name, platform_admin
  `);
  return row ? toAccount(row) : null;
}

/** Records a staff, settings or platform change. Never pass secrets in `details`. */
export async function audit(
  accountId: string | null,
  storeId: string | null,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db().execute(sql`
    insert into commerce.audit_log (account_id, store_id, action, details)
    values (${accountId}::uuid, ${storeId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)
  `);
}
