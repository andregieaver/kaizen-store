import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Where a shopper in a country can collect an order (D237, `docs/wave-3-shipping-methods.md` 2.6), for the chat agent's `store_info`: the active pickup
 * places of the market, by name and town, in the places' order. No price (the checkout shows it), no hours and no address beyond the town: the agent says
 * only what it is given, and the cart and checkout say the rest. Asked per request (the chat reads it inside a tool call).
 */
export async function pickupFacts(storeId: string, marketCode: string): Promise<{ place: string; town: string }[]> {
  const rows = await db().execute<{ name: string; city: string }>(sql`
    select l.name, l.city
    from commerce.pickup_options po
    join commerce.store_locations l on l.store_id = po.store_id and l.id = po.location_id
    where po.store_id = ${storeId}::uuid and po.market_code = ${marketCode} and po.active
    order by po.position, l.position, l.name
    limit 20
  `);
  return rows.map((r) => ({ place: String(r.name), town: String(r.city ?? "") }));
}
