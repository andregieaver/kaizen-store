import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import { DEFAULT_PRODUCT_SETTINGS, type ProductSettings } from "@/lib/shop-tiles";

import { audit, type Membership } from "./auth";
import { catalogTag } from "@/lib/cache-tags";

import { refreshTag } from "./refresh";
import { col, typedRows } from "./typed-rows";

/**
 * The store's product settings (D557): what a product's tile in a content grid shows besides its picture, title and price. One row a
 * store, made when first saved (a store that never saved reads the defaults). This uncached read is for the tiles' facts route (which
 * reads it with the stock) and the admin; `productSettingsCached()` is only for deciding whether a grid draws the island, under a tag
 * of its own so a change does not refresh the catalogue.
 */
export async function getProductSettings(storeId: string): Promise<ProductSettings> {
  const rows = await typedRows(
    z.object({ tile_stock: col.bool, tile_quantity: col.bool, zero_free: col.bool }),
    sql`select tile_stock, tile_quantity, zero_free from commerce.product_settings where store_id = ${storeId}::uuid`,
  );
  const row = rows[0];
  return row ? { tileStock: row.tile_stock, tileQuantity: row.tile_quantity, zeroFree: row.zero_free } : DEFAULT_PRODUCT_SETTINGS;
}

export const productSettingsTag = (storeId: string) => `product-settings:${storeId}`;

/** The same two switches, cached for the server's decision whether a grid draws the tile island; refreshed by `saveProductSettings()`. */
export async function productSettingsCached(storeId: string): Promise<ProductSettings> {
  "use cache";
  cacheLife("hours");
  cacheTag(productSettingsTag(storeId));
  return getProductSettings(storeId);
}

/** Saves the settings (the action layer needs `settings:write`) and writes one audit entry naming what changed. */
export async function saveProductSettings(member: Pick<Membership, "account" | "store">, next: ProductSettings): Promise<ProductSettings> {
  const before = await getProductSettings(member.store.id);
  await db().execute(sql`
    insert into commerce.product_settings (store_id, tile_stock, tile_quantity, zero_free)
    values (${member.store.id}::uuid, ${next.tileStock}, ${next.tileQuantity}, ${next.zeroFree})
    on conflict (store_id) do update set tile_stock = excluded.tile_stock, tile_quantity = excluded.tile_quantity, zero_free = excluded.zero_free,
      updated_at = now()
  `);
  refreshTag(productSettingsTag(member.store.id));
  // The catalogue's prices carry whether a price of nothing says Free (D913).
  if (next.zeroFree !== before.zeroFree) refreshTag(catalogTag(member.store.id));
  const changed = (Object.keys(next) as (keyof ProductSettings)[]).filter((key) => next[key] !== before[key]);
  if (changed.length > 0) await audit(member.account.id, member.store.id, "product.settings_changed", { changed });
  return next;
}
