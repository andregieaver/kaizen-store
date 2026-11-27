import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { auditChange } from "./audit";
import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { storeTag } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * Straight to payment, past the cart page (D915): the only writer and reader of `stores.skip_cart` (`saveSkipCart()`, `settings:write`, audited
 * `store.skip_cart`; `storeSkipsCart()`), and the basket's own rule (`cartSkips()`): every product in it skips the cart (`commerce.skips_cart()`, the product's choice
 * over its tags', categories' and the store's), so one that needs the cart keeps it for the whole basket.
 */

/** The store's own choice (Settings > Checkout): whether Buy now goes straight to payment where nothing below says otherwise. */
export async function storeSkipsCart(storeId: string): Promise<boolean> {
  const row = await typedRow(z.object({ skip_cart: col.bool }), sql`select skip_cart from commerce.stores where id = ${storeId}::uuid`);
  return row?.skip_cart ?? false;
}

export async function saveSkipCart(member: Membership, on: boolean): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "settings:write")) return { ok: false, problems: ["Not allowed."] };
  const { store } = member;
  const was = await db().transaction(async (tx) => {
    const row = await typedRow(z.object({ skip_cart: col.bool }), sql`select skip_cart from commerce.stores where id = ${store.id}::uuid for update`, tx);
    await tx.execute(sql`update commerce.stores set skip_cart = ${on} where id = ${store.id}::uuid`);
    return row?.skip_cart ?? false;
  });
  if (was !== on) {
    await auditChange(member, "store.skip_cart", { type: "store", id: store.id, label: store.name }, { skipCart: was }, { skipCart: on }, "store");
  }
  refreshTag(storeTag(store.slug));
  return { ok: true };
}

/** Whether a basket goes past the cart page (D915): it holds something, and every product in it skips the cart. */
export async function cartSkips(storeId: string, cartId: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ skips: col.bool }),
    sql`
    select coalesce(bool_and(commerce.skips_cart(cl.store_id, v.product_id)), false) as skips
    from commerce.cart_lines cl
    join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
    where cl.store_id = ${storeId}::uuid and cl.cart_id = ${cartId}::uuid
  `,
  );
  return row?.skips ?? false;
}
