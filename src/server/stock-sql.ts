import { sql, type SQL } from "drizzle-orm";

/**
 * The stock of a variant as the owner's own figures say it (wave 3, D172, docs/analytics.md "On hand"): the sum of `inventory_levels.on_hand` over the store's
 * ACTIVE locations. A deactivated location is not for sale, so its units are not the store's stock; a variant that sells on backorder can be below zero (what the
 * store still has to receive). `variantId` is the SQL expression of the variant's id (such as `sql\`v.id\``); the store is the variant's own. It is "on hand", not
 * "available": nothing is taken off for checkouts in progress (the Inventory page shows those as committed).
 */
export const onHandActive = (variantId: SQL): SQL => sql`coalesce((
  select sum(l.on_hand)
  from commerce.inventory_levels l
  join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.active
  where l.variant_id = ${variantId}
), 0)::int`;
