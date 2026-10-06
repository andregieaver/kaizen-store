import "server-only";

import { sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import { inRankOrder, type StockContext } from "@/lib/inventory";
import { restockPlan, type Part, type RestockPart } from "@/lib/stock-restock";

import { withStockContext } from "./stock-context";

type Row = Record<string, unknown>;

/**
 * Putting units back (wave 3, D172, `docs/wave-3-inventory.md` 2.6): a refund, a cancellation and an inspected return restock through
 * `restockPlan()` (pure): by default to the location(s) the units were taken from, read from the order's own `sale` movements, or to
 * one active location staff choose. The first writer of an order's units back to a level is this module, always inside the caller's
 * transaction and with the stock context set (reason `order_restock` or, for a return, `return_restock`).
 */

/** The ids of the store's ACTIVE locations in rank order (`priority`, `created_at`, `id`): the default and the fallback of a restock. */
export async function activeRank(reader: Pick<Db, "execute">, storeId: string): Promise<string[]> {
  const rows = await reader.execute<Row>(sql`
    select id, priority, created_at from commerce.inventory_locations
    where store_id = ${storeId}::uuid and active
  `);
  return inRankOrder(rows.map((r) => ({ id: String(r.id), priority: Number(r.priority), createdAt: new Date(String(r.created_at)).toISOString() }))).map((l) => l.id);
}

/** What an order took from each location for each variant (its `sale` movements), and what already went back for it (restock movements). */
export async function orderStockHistory(
  reader: Pick<Db, "execute">,
  storeId: string,
  orderId: string,
  variantIds: readonly string[],
): Promise<Map<string, { taken: Part[]; returned: Part[] }>> {
  const history = new Map<string, { taken: Part[]; returned: Part[] }>();
  if (variantIds.length === 0) return history;
  const rows = await reader.execute<Row>(sql`
    select variant_id, location_id,
           coalesce(-sum(delta) filter (where reason = 'sale'), 0)::int as taken,
           coalesce(sum(delta) filter (where reason in ('order_restock', 'return_restock')), 0)::int as returned
    from commerce.inventory_movements
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
      and variant_id in (${sql.join(variantIds.map((id) => sql`${id}::uuid`), sql`, `)})
    group by variant_id, location_id
    order by variant_id, location_id
  `);
  for (const r of rows) {
    const entry = history.get(String(r.variant_id)) ?? { taken: [], returned: [] };
    if (Number(r.taken) > 0) entry.taken.push({ locationId: String(r.location_id), quantity: Number(r.taken) });
    if (Number(r.returned) > 0) entry.returned.push({ locationId: String(r.location_id), quantity: Number(r.returned) });
    history.set(String(r.variant_id), entry);
  }
  return history;
}

export type RestockItem = { variantId: string; sku: string; quantity: number; chosen?: string | null };
export type PlannedItem = RestockItem & { parts: RestockPart[] };

export type RestockPlanResult = { ok: true; items: PlannedItem[] } | { ok: false; problem: string };

const WORDS = {
  location_not_active: "Choose an active stock location of this store to put the units back at.",
  no_active_location: "The store has no active stock location to put the units back at.",
} as const;

/**
 * The plan for every item of a restock, worked out from what the order took and what already went back (items of one variant count
 * what the earlier ones in the same call put back). A chosen location must be an active location of THIS store. Never writes.
 */
export async function planRestock(reader: Pick<Db, "execute">, storeId: string, orderId: string, items: readonly RestockItem[]): Promise<RestockPlanResult> {
  const rank = await activeRank(reader, storeId);
  const history = await orderStockHistory(reader, storeId, orderId, [...new Set(items.map((i) => i.variantId))]);
  const planned: PlannedItem[] = [];
  for (const item of items) {
    const entry = history.get(item.variantId) ?? { taken: [], returned: [] };
    const plan = restockPlan({ taken: entry.taken, returned: entry.returned, quantity: item.quantity, activeRank: rank, chosen: item.chosen ?? null });
    if (!plan.ok) {
      if (plan.reason === "too_many") return { ok: false, problem: `Only ${plan.max} of ${item.sku} can go back in stock.` };
      return { ok: false, problem: WORDS[plan.reason] };
    }
    // What this call puts back counts as returned for the items after it.
    for (const part of plan.parts) entry.returned.push({ locationId: part.locationId, quantity: part.quantity });
    history.set(item.variantId, entry);
    planned.push({ ...item, parts: plan.parts });
  }
  return { ok: true, items: planned };
}

/**
 * Writes a plan inside the caller's transaction: the level rows of each variant are locked in (variant, location) order, the units are
 * added (a level that does not exist is made), and each change is a movement with the context given. Items are written in variant order.
 */
export async function applyRestock(tx: Db, storeId: string, plan: readonly PlannedItem[], context: StockContext): Promise<void> {
  const ordered = [...plan].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
  await withStockContext(tx, context, async () => {
    for (const item of ordered) {
      const places = [...new Set(item.parts.map((p) => p.locationId))].sort();
      if (places.length === 0) continue;
      await tx.execute(sql`
        select 1 from commerce.inventory_levels
        where store_id = ${storeId}::uuid and variant_id = ${item.variantId}::uuid
          and location_id in (${sql.join(places.map((id) => sql`${id}::uuid`), sql`, `)})
        order by location_id for update
      `);
      for (const part of [...item.parts].sort((a, b) => (a.locationId < b.locationId ? -1 : 1))) {
        await tx.execute(sql`
          insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
          values (${storeId}::uuid, ${item.variantId}::uuid, ${part.locationId}::uuid, ${part.quantity})
          on conflict (variant_id, location_id) do update set on_hand = commerce.inventory_levels.on_hand + excluded.on_hand, updated_at = now()
        `);
      }
    }
  });
}
