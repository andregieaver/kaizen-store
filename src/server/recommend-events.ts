import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ATTRIBUTION_DAYS, EVENT_DAYS, type Placement, type RecommendEvents } from "@/lib/recommendations";

type Row = Record<string, unknown>;

/**
 * What shoppers did with recommendations (D139), kept to measure them: products shown and clicked, recommended products
 * put in a cart, and the revenue of the orders that followed, each by the ranking the tab got (`ai`, or the `baseline` the
 * store holds out). A tab is a random id it made itself and keeps only in the tab: it is never joined to a person.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAID = sql`('paid', 'fulfilled', 'closed')`;

/** Records a tab's impressions and clicks, for the store's own products only. */
export async function recordRecommendEvents(storeId: string, input: RecommendEvents): Promise<number> {
  const unique = new Map(input.events.map((e) => [`${e.productId}|${e.event}`, e]));
  const events = [...unique.values()];
  if (events.length === 0) return 0;
  const rows = await db().execute<Row>(sql`
    insert into commerce.recommendation_events (store_id, session, arm, placement, product_id, event)
    select ${storeId}::uuid, ${input.session}, ${input.arm}, ${input.placement}, p.id, e.event
    from (values ${sql.join(events.map((e) => sql`(${e.productId}::uuid, ${e.event})`), sql`, `)}) as e(product_id, event)
    join commerce.products p on p.store_id = ${storeId}::uuid and p.id = e.product_id
    returning 1
  `);
  return rows.length;
}

/** A recommended product put in a cart: remembered with the cart, so the order that follows counts towards it. */
export async function recordRecommendedAdd(storeId: string, cartId: string, productId: string, attribution: { session: string; arm: "ai" | "baseline"; placement: Placement }): Promise<void> {
  if (!UUID.test(cartId) || !UUID.test(productId)) return;
  await db().execute(sql`
    insert into commerce.recommendation_adds (store_id, cart_id, product_id, session, arm, placement)
    select ${storeId}::uuid, ${cartId}::uuid, p.id, ${attribution.session}, ${attribution.arm}, ${attribution.placement}
    from commerce.products p where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid
    on conflict (store_id, cart_id, product_id) do update set
      session = excluded.session, arm = excluded.arm, placement = excluded.placement, created_at = now()
  `);
}

/** The product a variant belongs to, in the store; null for another store's or none. */
export async function productOfVariant(storeId: string, variantId: string): Promise<string | null> {
  if (!UUID.test(variantId)) return null;
  const [row] = await db().execute<Row>(sql`
    select v.product_id from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where p.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid
  `);
  return row ? String(row.product_id) : null;
}

/** Forgets events and adds older than `EVENT_DAYS` (the five-minute cron). */
export async function pruneRecommendEvents(): Promise<number> {
  const events = await db().execute<Row>(sql`delete from commerce.recommendation_events where created_at < now() - make_interval(days => ${EVENT_DAYS}) returning 1`);
  const adds = await db().execute<Row>(sql`delete from commerce.recommendation_adds where created_at < now() - make_interval(days => ${ATTRIBUTION_DAYS + EVENT_DAYS}) returning 1`);
  return events.length + adds.length;
}

/** Counts a visitor's requests so a script cannot fill the log or the database: false past the limit. */
export async function takeRecommendRequest(storeId: string, visitor: string, kind: "ask" | "report"): Promise<boolean> {
  const limit = kind === "ask" ? 240 : 600;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${`rec:${kind}:${visitor}`}, date_bin('10 minutes', now(), '2000-01-01'), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row.count) <= limit;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type ArmFigures = {
  arm: "ai" | "baseline";
  /** Tabs that were shown a recommendation. */
  visitors: number;
  impressions: number;
  clicks: number;
  /** Recommended products put in a cart. */
  adds: number;
  /** Orders of those carts that held the product, placed within the attribution window, and what those products' lines came to (with VAT, after discounts), per currency. */
  orders: number;
  revenue: { currency: string; minor: number; orders: number }[];
};

export type PlacementFigures = { placement: Placement; impressions: number; clicks: number; adds: number };

export type RecommendReport = { days: number; arms: ArmFigures[]; placements: PlacementFigures[]; topProducts: { productId: string; title: string; impressions: number; clicks: number; adds: number }[] };

export async function recommendationReport(storeId: string, days: number): Promise<RecommendReport> {
  const since = sql`now() - make_interval(days => ${days})`;
  const [events, adds, revenue, byPlacement, top] = await Promise.all([
    db().execute<Row>(sql`
      select arm, count(distinct session) filter (where event = 'impression') as visitors,
        count(*) filter (where event = 'impression') as impressions, count(*) filter (where event = 'click') as clicks
      from commerce.recommendation_events where store_id = ${storeId}::uuid and created_at > ${since} group by arm
    `),
    db().execute<Row>(sql`
      select arm, count(*) as adds from commerce.recommendation_adds where store_id = ${storeId}::uuid and created_at > ${since} group by arm
    `),
    db().execute<Row>(sql`
      select a.arm, o.currency, count(distinct o.id) as orders, coalesce(sum(l.total_minor), 0)::bigint as revenue
      from commerce.recommendation_adds a
      join commerce.orders o on o.store_id = a.store_id and o.cart_id = a.cart_id and o.status in ${PAID} and o.copied_from is null
        and o.placed_at >= a.created_at and o.placed_at < a.created_at + make_interval(days => ${ATTRIBUTION_DAYS})
      join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id
      join commerce.product_variants v on v.id = l.variant_id and v.product_id = a.product_id
      where a.store_id = ${storeId}::uuid and a.created_at > ${since}
      group by a.arm, o.currency order by a.arm, o.currency
    `),
    db().execute<Row>(sql`
      select placement, count(*) filter (where event = 'impression') as impressions, count(*) filter (where event = 'click') as clicks
      from commerce.recommendation_events where store_id = ${storeId}::uuid and created_at > ${since} group by placement
    `),
    db().execute<Row>(sql`
      select e.product_id, count(*) filter (where e.event = 'impression') as impressions, count(*) filter (where e.event = 'click') as clicks,
        (select title from commerce.product_translations t where t.product_id = e.product_id order by t.locale limit 1) as title,
        (select count(*) from commerce.recommendation_adds a where a.store_id = e.store_id and a.product_id = e.product_id and a.created_at > ${since}) as adds
      from commerce.recommendation_events e where e.store_id = ${storeId}::uuid and e.created_at > ${since}
      group by e.store_id, e.product_id order by clicks desc, impressions desc limit 10
    `),
  ]);
  const arms = (["ai", "baseline"] as const).map((arm): ArmFigures => {
    const e = events.find((r) => r.arm === arm);
    const rev = revenue.filter((r) => r.arm === arm);
    return {
      arm,
      visitors: Number(e?.visitors ?? 0),
      impressions: Number(e?.impressions ?? 0),
      clicks: Number(e?.clicks ?? 0),
      adds: Number(adds.find((r) => r.arm === arm)?.adds ?? 0),
      orders: rev.reduce((sum, r) => sum + Number(r.orders), 0),
      revenue: rev.map((r) => ({ currency: String(r.currency).trim(), minor: Number(r.revenue), orders: Number(r.orders) })),
    };
  });
  const placementAdds = await db().execute<Row>(sql`
    select placement, count(*) as adds from commerce.recommendation_adds where store_id = ${storeId}::uuid and created_at > ${since} group by placement
  `);
  return {
    days,
    arms,
    placements: byPlacement.map((r) => ({
      placement: String(r.placement) as Placement,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      adds: Number(placementAdds.find((a) => a.placement === r.placement)?.adds ?? 0),
    })),
    topProducts: top.map((r) => ({ productId: String(r.product_id), title: String(r.title ?? ""), impressions: Number(r.impressions), clicks: Number(r.clicks), adds: Number(r.adds) })),
  };
}
