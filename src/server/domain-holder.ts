import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Who holds a domain (D317, `docs/domains-standalone.md` 2): an account (the person, or their company as the registrant), and, when a
 * store uses it, that store. The store's pages see the domains the store uses; the holder sees every domain they hold, whether a store
 * uses it or not. Every domain function takes a `HolderRef`: a store's id (as the store's pages and older callers pass) or a holder.
 */

export type Holder = { kind: "store"; storeId: string } | { kind: "account"; accountId: string };
export type HolderRef = string | Holder;

export const holderOf = (ref: HolderRef): Holder => (typeof ref === "string" ? { kind: "store", storeId: ref } : ref);
export const accountHolder = (accountId: string): Holder => ({ kind: "account", accountId });

/** The store a holder stands for, or null for an account. */
export const storeOf = (ref: HolderRef): string | null => {
  const h = holderOf(ref);
  return h.kind === "store" ? h.storeId : null;
};

/** The condition that a row of a domain table (`table` its alias) is the holder's: a store's by `store_id`, an account's by `account_id`. */
export function heldBy(ref: HolderRef, table?: string): SQL {
  const h = holderOf(ref);
  const col = (name: string) => sql.raw(table ? `${table}.${name}` : name);
  return h.kind === "store" ? sql`${col("store_id")} = ${h.storeId}::uuid` : sql`${col("account_id")} = ${h.accountId}::uuid`;
}

/**
 * The account that holds what a holder makes now: an account itself, or a store's first owner (D315 decision 1 makes the owner, or their
 * company, the registrant).
 */
export async function holderAccount(ref: HolderRef, fallback: string | null = null): Promise<string | null> {
  const h = holderOf(ref);
  if (h.kind === "account") return h.accountId;
  const [row] = await db().execute<Record<string, unknown>>(sql`
    select m.account_id from commerce.store_members m
     where m.store_id = ${h.storeId}::uuid and m.role = 'owner' and m.disabled_at is null
     order by m.created_at limit 1
  `);
  return row?.account_id ? String(row.account_id) : fallback;
}

/** A store's id and an account's for a row a holder makes: the store it is for (none for an account) and who holds it. */
export async function holderColumns(ref: HolderRef, actorId: string | null): Promise<{ storeId: string | null; accountId: string | null }> {
  return { storeId: storeOf(ref), accountId: await holderAccount(ref, actorId) };
}
