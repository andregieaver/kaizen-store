import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The few reads the shipping settings' screens need beyond `getShippingSetup()` (D237, `docs/wave-3-shipping-methods.md` 2.1, 5.4): the store's
 * products to put in a profile, and the profiles to choose from in the product editor. Every query names the store; nothing here writes.
 */

export type ProfileProduct = {
  id: string;
  title: string;
  status: "draft" | "active" | "archived";
  /** The profile it is in, null for General. */
  profileId: string | null;
  /** It has an active variant that is shipped: only such products are priced by shipping methods. */
  shipped: boolean;
};

/** The store's products that are not archived, by title, with the profile each is in (the Profiles page's chooser). */
export async function listProfileProducts(store: Pick<Store, "id" | "markets">): Promise<ProfileProduct[]> {
  const locale = store.markets[0]?.locale ?? "en";
  const rows = await db().execute<Row>(sql`
    select p.id, p.status, p.shipping_profile_id, coalesce(tl.title, tf.title, p.handle) as title,
      exists (select 1 from commerce.product_variants v where v.store_id = p.store_id and v.product_id = p.id and v.active and v.delivery = 'physical') as shipped
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    where p.store_id = ${store.id}::uuid and p.status <> 'archived'
    order by lower(coalesce(tl.title, tf.title, p.handle)), p.id
  `);
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    status: r.status === "active" ? "active" : r.status === "archived" ? "archived" : "draft",
    profileId: r.shipping_profile_id ? String(r.shipping_profile_id) : null,
    shipped: Boolean(r.shipped),
  }));
}

/** The store's shipping profiles by name, for the product editor's *Shipping profile* field (General is the empty choice). */
export async function profileChoices(storeId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db().execute<Row>(sql`
    select id, name from commerce.shipping_profiles where store_id = ${storeId}::uuid order by position, lower(name), id
  `);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}
