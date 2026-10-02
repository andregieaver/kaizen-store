import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * What the analytics settings page (D152, `docs/analytics.md`) shows about the store's set-up, counted from the database and
 * never guessed: how many of the store's variants have a cost, how many earlier order lines the costs entered since could still
 * be applied to, and the first day visits were counted.
 */
export type AnalyticsSetupSummary = {
  /** Variants that are on sale: active, on a product that is not archived. */
  activeVariants: number;
  /** Of those, the ones with a cost entered (`product_variants.cost_minor` is not null; a cost of 0 is a cost). */
  variantsWithCost: number;
  /**
   * Earlier order lines that sold without a cost whose variant has one now: what "Apply costs to earlier orders" would fill in.
   * The same rows `backfillCosts()` updates (copied orders are history and left out).
   */
  backfillableLines: number;
  /** The first day (`YYYY-MM-DD`) a visit was counted, or null when none has been. */
  firstCountedDay: string | null;
};

export async function analyticsSetupSummary(storeId: string): Promise<AnalyticsSetupSummary> {
  const [variants, lines, visits] = await Promise.all([
    db().execute<Row>(sql`
      select count(*) as active, count(*) filter (where v.cost_minor is not null) as with_cost
      from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${storeId}::uuid and v.active and p.status <> 'archived'
    `),
    db().execute<Row>(sql`
      select count(*) as lines
      from commerce.order_lines ol
      join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      join commerce.orders o on o.store_id = ol.store_id and o.id = ol.order_id
      where ol.store_id = ${storeId}::uuid and ol.unit_cost_minor is null
        and v.cost_minor is not null and o.copied_from is null
    `),
    db().execute<Row>(sql`select min(day)::text as first_day from commerce.visits where store_id = ${storeId}::uuid`),
  ]);
  return {
    activeVariants: Number(variants[0]?.active ?? 0),
    variantsWithCost: Number(variants[0]?.with_cost ?? 0),
    backfillableLines: Number(lines[0]?.lines ?? 0),
    firstCountedDay: visits[0]?.first_day ? String(visits[0].first_day).slice(0, 10) : null,
  };
}
