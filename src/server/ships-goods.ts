import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { featureOn } from "@/lib/store-features";

import type { Store } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * Whether the store sends parcels, so needs a shipping price for every country it sells to: its online shop is on and it sells something
 * physical. A website without a shop, or a shop of digital products or services only, sends none. A shop with no active products yet counts as
 * one that does: the owner is asked for shipping until the shop shows it sells only downloads. Read per request (products change).
 */
export async function shipsGoods(store: Pick<Store, "id" | "features">): Promise<boolean> {
  if (!featureOn(store, "shop")) return false;
  const [row] = await typedRows(
    z.object({ any: col.bool, physical: col.bool }),
    sql`
      select exists (select 1 from commerce.products p where p.store_id = ${store.id}::uuid and p.status = 'active') as any,
             exists (
               select 1 from commerce.products p
               join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id
               where p.store_id = ${store.id}::uuid and p.status = 'active' and v.delivery = 'physical'
             ) as physical
    `,
  );
  return !row?.any || row.physical;
}
