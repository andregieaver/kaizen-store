import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import type { Market } from "@/lib/markets";

import { changeLine } from "./cart";
import { getCustomer } from "./customers";

type Row = Record<string, unknown>;

/**
 * Wishlists (decision D34). A shopper saves products with the heart on
 * product cards and product pages, keeps them in one or more lists, moves
 * them between lists, and adds all or some to the cart, choosing per list
 * whether they then stay in the list. Signed-in customers' lists belong to
 * the account; a shopper not signed in keeps lists in this browser, which
 * join the account at sign-in.
 */

export const MAX_LISTS = 20;
export const MAX_ITEMS = 200;
const COOKIE_DAYS = 365;

const cookieName = (storeId: string) => `wishlist_${storeId}`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

type Owner = { customerId: string } | { browserTokenHash: string };

/** Whose lists these are: the signed-in customer, or this browser; made for the browser on first save. */
async function currentOwner(storeId: string, create = false): Promise<Owner | null> {
  const customer = await getCustomer(storeId);
  if (customer) return { customerId: customer.id };
  const jar = await cookies();
  const token = jar.get(cookieName(storeId))?.value;
  if (token && token.length <= 100) return { browserTokenHash: sha256(token) };
  if (!create) return null;
  const fresh = randomBytes(32).toString("base64url");
  jar.set(cookieName(storeId), fresh, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
  });
  return { browserTokenHash: sha256(fresh) };
}

const owns = (owner: Owner, alias = "w"): SQL =>
  "customerId" in owner
    ? sql`${sql.raw(alias)}.customer_id = ${owner.customerId}::uuid`
    : sql`${sql.raw(alias)}.browser_token_hash = ${owner.browserTokenHash} and ${sql.raw(alias)}.customer_id is null`;

// ---------------------------------------------------------------------------
// The heart
// ---------------------------------------------------------------------------

/** The products this shopper has saved in any list, for the hearts. */
export async function savedProductIds(storeId: string): Promise<string[]> {
  const owner = await currentOwner(storeId);
  if (!owner) return [];
  const rows = await db().execute<Row>(sql`
    select distinct i.product_id from commerce.wishlist_items i
    join commerce.wishlists w on w.store_id = i.store_id and w.id = i.wishlist_id
    where w.store_id = ${storeId}::uuid and ${owns(owner)}
  `);
  return rows.map((row) => String(row.product_id));
}

/** The shopper's first list, made (with this name) if they have none. */
async function defaultList(storeId: string, owner: Owner, name: string): Promise<string> {
  const [existing] = await db().execute<Row>(sql`
    select w.id from commerce.wishlists w where w.store_id = ${storeId}::uuid and ${owns(owner)}
    order by w.created_at, w.id limit 1
  `);
  if (existing) return String(existing.id);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.wishlists (store_id, customer_id, browser_token_hash, name)
    values (${storeId}::uuid, ${"customerId" in owner ? owner.customerId : null}::uuid,
            ${"browserTokenHash" in owner ? owner.browserTokenHash : null}, ${name})
    returning id
  `);
  return String(row.id);
}

/**
 * The heart: saves the product in the shopper's first list, or, when it is
 * saved already, takes it out of every list. A product with one variant is
 * saved with it, ready for the cart.
 */
export async function toggleSavedProduct(
  storeId: string,
  productId: string,
  defaultName: string,
): Promise<{ saved: boolean; products: string[] }> {
  const owner = await currentOwner(storeId, true);
  if (!owner) return { saved: false, products: [] };
  const removed = await db().execute<Row>(sql`
    delete from commerce.wishlist_items i using commerce.wishlists w
    where w.store_id = i.store_id and w.id = i.wishlist_id and w.store_id = ${storeId}::uuid and ${owns(owner)}
      and i.product_id = ${productId}::uuid
    returning i.id
  `);
  let saved = false;
  if (removed.length === 0) {
    const [product] = await db().execute<Row>(sql`
      select p.id, (select case when count(*) = 1 then min(v.id::text) end from commerce.product_variants v
                    where v.product_id = p.id and v.active) as only_variant
      from commerce.products p where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid and p.status = 'active'
    `);
    if (product) {
      const listId = await defaultList(storeId, owner, defaultName);
      const [count] = await db().execute<Row>(sql`
        select count(*)::int as n from commerce.wishlist_items where wishlist_id = ${listId}::uuid
      `);
      if (Number(count.n) < MAX_ITEMS) {
        await db().execute(sql`
          insert into commerce.wishlist_items (store_id, wishlist_id, product_id, variant_id)
          values (${storeId}::uuid, ${listId}::uuid, ${productId}::uuid, ${product.only_variant ? String(product.only_variant) : null}::uuid)
          on conflict (wishlist_id, product_id) do nothing
        `);
        saved = true;
      }
    }
  }
  return { saved, products: await savedProductIds(storeId) };
}

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

export type WishlistSummary = { id: string; name: string; items: number; keepAfterCart: boolean };

export async function listWishlists(storeId: string): Promise<WishlistSummary[]> {
  const owner = await currentOwner(storeId);
  if (!owner) return [];
  const rows = await db().execute<Row>(sql`
    select w.id, w.name, w.keep_after_cart,
      (select count(*)::int from commerce.wishlist_items i where i.wishlist_id = w.id) as items
    from commerce.wishlists w where w.store_id = ${storeId}::uuid and ${owns(owner)}
    order by w.created_at, w.id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    items: Number(row.items),
    keepAfterCart: Boolean(row.keep_after_cart),
  }));
}

export type WishlistItem = {
  id: string;
  productId: string;
  handle: string;
  variantId: string | null;
  quantity: number;
};

/** A list's items, newest first; only the shopper's own list. */
export async function getWishlistItems(storeId: string, wishlistId: string): Promise<WishlistItem[]> {
  const owner = await currentOwner(storeId);
  if (!owner) return [];
  const rows = await db().execute<Row>(sql`
    select i.id, i.product_id, p.handle, i.variant_id, i.quantity
    from commerce.wishlist_items i
    join commerce.wishlists w on w.store_id = i.store_id and w.id = i.wishlist_id
    join commerce.products p on p.store_id = i.store_id and p.id = i.product_id and p.status = 'active'
    where w.store_id = ${storeId}::uuid and w.id = ${wishlistId}::uuid and ${owns(owner)}
    order by i.created_at desc, i.id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    productId: String(row.product_id),
    handle: String(row.handle),
    variantId: row.variant_id ? String(row.variant_id) : null,
    quantity: Number(row.quantity),
  }));
}

export type ListResult = { ok: true; id?: string } | { ok: false; problem: "name" | "limit" | "unknown" };

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 60);

export async function createWishlist(storeId: string, name: string): Promise<ListResult> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, problem: "name" };
  const owner = await currentOwner(storeId, true);
  if (!owner) return { ok: false, problem: "unknown" };
  const [count] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.wishlists w where w.store_id = ${storeId}::uuid and ${owns(owner)}
  `);
  if (Number(count.n) >= MAX_LISTS) return { ok: false, problem: "limit" };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.wishlists (store_id, customer_id, browser_token_hash, name)
    values (${storeId}::uuid, ${"customerId" in owner ? owner.customerId : null}::uuid,
            ${"browserTokenHash" in owner ? owner.browserTokenHash : null}, ${clean})
    returning id
  `);
  return { ok: true, id: String(row.id) };
}

/** Changes a list's name or its choice to keep items once in the cart; only the shopper's own. */
export async function updateWishlist(
  storeId: string,
  wishlistId: string,
  change: { name?: string; keepAfterCart?: boolean },
): Promise<ListResult> {
  const owner = await currentOwner(storeId);
  if (!owner) return { ok: false, problem: "unknown" };
  const name = change.name === undefined ? null : cleanName(change.name);
  if (name === "") return { ok: false, problem: "name" };
  const rows = await db().execute<Row>(sql`
    update commerce.wishlists w set
      name = coalesce(${name}, w.name),
      keep_after_cart = coalesce(${change.keepAfterCart ?? null}::boolean, w.keep_after_cart),
      updated_at = now()
    where w.store_id = ${storeId}::uuid and w.id = ${wishlistId}::uuid and ${owns(owner)}
    returning w.id
  `);
  return rows.length > 0 ? { ok: true } : { ok: false, problem: "unknown" };
}

export async function deleteWishlist(storeId: string, wishlistId: string): Promise<boolean> {
  const owner = await currentOwner(storeId);
  if (!owner) return false;
  const rows = await db().execute<Row>(sql`
    delete from commerce.wishlists w
    where w.store_id = ${storeId}::uuid and w.id = ${wishlistId}::uuid and ${owns(owner)}
    returning w.id
  `);
  return rows.length > 0;
}

/** The shopper's own items among these ids, with their list. */
async function ownItems(storeId: string, owner: Owner, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  return db().execute<Row>(sql`
    select i.id, i.wishlist_id, i.product_id, i.variant_id, i.quantity
    from commerce.wishlist_items i
    join commerce.wishlists w on w.store_id = i.store_id and w.id = i.wishlist_id
    where w.store_id = ${storeId}::uuid and ${owns(owner)}
      and i.id in (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
}

/**
 * Moves items to another of the shopper's lists. A product already in that
 * list stays there once; the moved copy goes.
 */
export async function moveWishlistItems(storeId: string, itemIds: string[], toWishlistId: string): Promise<number> {
  const owner = await currentOwner(storeId);
  if (!owner) return 0;
  const [target] = await db().execute<Row>(sql`
    select w.id from commerce.wishlists w where w.store_id = ${storeId}::uuid and w.id = ${toWishlistId}::uuid and ${owns(owner)}
  `);
  if (!target) return 0;
  const items = await ownItems(storeId, owner, itemIds);
  let moved = 0;
  await db().transaction(async (tx) => {
    for (const item of items) {
      if (String(item.wishlist_id) === toWishlistId) continue;
      await tx.execute(sql`
        insert into commerce.wishlist_items (store_id, wishlist_id, product_id, variant_id, quantity)
        values (${storeId}::uuid, ${toWishlistId}::uuid, ${String(item.product_id)}::uuid,
                ${item.variant_id ? String(item.variant_id) : null}::uuid, ${Number(item.quantity)})
        on conflict (wishlist_id, product_id) do nothing
      `);
      await tx.execute(sql`delete from commerce.wishlist_items where id = ${String(item.id)}::uuid`);
      moved++;
    }
  });
  return moved;
}

export async function removeWishlistItems(storeId: string, itemIds: string[]): Promise<number> {
  const owner = await currentOwner(storeId);
  if (!owner) return 0;
  const items = await ownItems(storeId, owner, itemIds);
  if (items.length === 0) return 0;
  await db().execute(sql`
    delete from commerce.wishlist_items where id in (${sql.join(items.map((i) => sql`${String(i.id)}::uuid`), sql`, `)})
  `);
  return items.length;
}

/** The variant and quantity an item goes to the cart with; the variant must be the product's own. */
export async function setWishlistItem(
  storeId: string,
  itemId: string,
  change: { variantId?: string | null; quantity?: number },
): Promise<boolean> {
  const owner = await currentOwner(storeId);
  if (!owner) return false;
  const [item] = await ownItems(storeId, owner, [itemId]);
  if (!item) return false;
  if (change.variantId) {
    const [variant] = await db().execute<Row>(sql`
      select 1 from commerce.product_variants
      where store_id = ${storeId}::uuid and id = ${change.variantId}::uuid and product_id = ${String(item.product_id)}::uuid
    `);
    if (!variant) return false;
  }
  const quantity = change.quantity === undefined ? null : Math.min(99, Math.max(1, Math.floor(change.quantity)));
  await db().execute(sql`
    update commerce.wishlist_items set
      variant_id = ${change.variantId === undefined ? sql`variant_id` : sql`${change.variantId}::uuid`},
      quantity = coalesce(${quantity}::int, quantity)
    where id = ${itemId}::uuid
  `);
  return true;
}

// ---------------------------------------------------------------------------
// To the cart
// ---------------------------------------------------------------------------

export type CartOutcome = "added" | "capped" | "unavailable" | "needs_variant" | "subscription";

/**
 * Adds items (all of the list's when `itemIds` is null) to the cart, each
 * with its variant and quantity; a product with one variant needs no
 * choice, and one sold only by subscription is chosen on its page. Items
 * that went to the cart leave the list unless the list keeps them.
 */
export async function addWishlistToCart(
  storeId: string,
  market: Market,
  wishlistId: string,
  itemIds: string[] | null,
): Promise<{ outcomes: Record<string, CartOutcome> }> {
  const owner = await currentOwner(storeId);
  if (!owner) return { outcomes: {} };
  const rows = await db().execute<Row>(sql`
    select i.id, i.quantity, p.subscription_only,
      coalesce(i.variant_id, (
        select case when count(*) = 1 then min(v.id::text)::uuid end from commerce.product_variants v
        where v.product_id = p.id and v.active
      )) as variant_id,
      w.keep_after_cart
    from commerce.wishlist_items i
    join commerce.wishlists w on w.store_id = i.store_id and w.id = i.wishlist_id
    join commerce.products p on p.store_id = i.store_id and p.id = i.product_id and p.status = 'active'
    where w.store_id = ${storeId}::uuid and w.id = ${wishlistId}::uuid and ${owns(owner)}
      ${itemIds ? sql`and i.id in (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
    order by i.created_at, i.id
  `);
  const outcomes: Record<string, CartOutcome> = {};
  const added: string[] = [];
  for (const row of rows) {
    const id = String(row.id);
    if (row.subscription_only) {
      outcomes[id] = "subscription";
      continue;
    }
    if (!row.variant_id) {
      outcomes[id] = "needs_variant";
      continue;
    }
    const result = await changeLine({ storeId, market }, String(row.variant_id), Number(row.quantity), "add");
    const outcome = result.outcome === "added" || result.outcome === "capped" ? result.outcome : "unavailable";
    outcomes[id] = outcome;
    if (outcome !== "unavailable") added.push(id);
  }
  if (added.length > 0 && rows[0] && !rows[0].keep_after_cart) {
    await db().execute(sql`
      delete from commerce.wishlist_items where id in (${sql.join(added.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
  }
  return { outcomes };
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

/**
 * At sign-in: this browser's lists join the account. A list with the same
 * name as one of the account's is merged into it; the browser's cookie goes.
 */
export async function claimBrowserWishlists(storeId: string, customerId: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(cookieName(storeId))?.value;
  if (!token || token.length > 100) return;
  const hash = sha256(token);
  await db().transaction(async (tx) => {
    const lists = await tx.execute<Row>(sql`
      select id, name from commerce.wishlists
      where store_id = ${storeId}::uuid and browser_token_hash = ${hash} and customer_id is null
    `);
    for (const list of lists) {
      const [same] = await tx.execute<Row>(sql`
        select id from commerce.wishlists
        where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and lower(name) = lower(${String(list.name)})
        order by created_at limit 1
      `);
      if (same) {
        await tx.execute(sql`
          insert into commerce.wishlist_items (store_id, wishlist_id, product_id, variant_id, quantity, created_at)
          select store_id, ${String(same.id)}::uuid, product_id, variant_id, quantity, created_at
          from commerce.wishlist_items where wishlist_id = ${String(list.id)}::uuid
          on conflict (wishlist_id, product_id) do nothing
        `);
        await tx.execute(sql`delete from commerce.wishlists where id = ${String(list.id)}::uuid`);
      } else {
        await tx.execute(sql`
          update commerce.wishlists set customer_id = ${customerId}::uuid, browser_token_hash = null, updated_at = now()
          where id = ${String(list.id)}::uuid
        `);
      }
    }
  });
  jar.delete(cookieName(storeId));
}
