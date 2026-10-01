import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { Market } from "@/lib/markets";
import { rankOf, summariseRanks, type RankSummary } from "@/lib/recommend-eval";

import { recommendableNow, replayFor } from "./recommend";
import { getRecommendSettingsFresh } from "./recommend-settings";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The check against past orders (D140): for each of the store's recent paid orders of two goods or more, one product is held
 * back and the engine (the plain ranking, with the order itself left out of what it learns from) is asked what it would put
 * first for a shopper who had looked at the others. It shows whether the engine finds what people actually bought together,
 * and how that compares with showing the best sellers to everyone. It says nothing about what shoppers would click, and it
 * does not use the AI: that is what the live comparison is for.
 */

export const REPLAY_ORDERS = 100;
export const REPLAY_ORDERS_MAX = 300;
const ANCHORS_AT_MOST = 5;

export type ReplayResult = {
  /** Orders looked at, and why some were left out. */
  considered: number;
  evaluated: number;
  skipped: { notOnSaleNow: number };
  engine: RankSummary;
  /** The best sellers alone, for everyone: what the engine has to beat. */
  bestSellers: RankSummary;
  /** How many times better the engine finds the product within the first four than the best sellers do; null when the best sellers never do. */
  liftAt4: number | null;
};

/** A stable pick among a list for an order: the same order always holds back the same product. */
const pick = (orderId: string, count: number) => parseInt(createHash("sha256").update(orderId).digest("hex").slice(0, 8), 16) % count;

export async function replayOnOrders(store: Store, market: Market, orders = REPLAY_ORDERS): Promise<ReplayResult> {
  const settings = await getRecommendSettingsFresh(store.id);
  const rows = await db().execute<Row>(sql`
    select o.id, array_agg(distinct v.product_id::text order by v.product_id::text) as products
    from commerce.orders o
    join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id and not l.gift
    join commerce.product_variants v on v.id = l.variant_id
    join commerce.products p on p.id = v.product_id and p.kind = 'goods'
    where o.store_id = ${store.id}::uuid and o.status in ('paid', 'fulfilled', 'closed') and o.copied_from is null
      and o.placed_at > now() - interval '365 days'
    group by o.id, o.placed_at
    having count(distinct v.product_id) >= 2
    order by o.placed_at desc
    limit ${Math.max(1, Math.min(REPLAY_ORDERS_MAX, orders))}
  `);
  const every = rows.flatMap((r) => (Array.isArray(r.products) ? (r.products as string[]) : []));
  const onSale = await recommendableNow(store, market, every);
  const engineRanks: (number | null)[] = [];
  const popularRanks: (number | null)[] = [];
  let notOnSaleNow = 0;
  for (const row of rows) {
    const products = (row.products as string[]).slice().sort();
    const target = products[pick(String(row.id), products.length)];
    if (!onSale.has(target)) {
      notOnSaleNow += 1;
      continue;
    }
    const viewed = products.filter((id) => id !== target).slice(0, ANCHORS_AT_MOST);
    const replay = await replayFor(store, market, { viewed, exceptOrder: String(row.id), ceilingPercent: settings.upsellCeilingPercent, limit: 12 });
    engineRanks.push(rankOf(replay.engine, target));
    popularRanks.push(rankOf(replay.popular, target));
  }
  const engine = summariseRanks(engineRanks);
  const bestSellers = summariseRanks(popularRanks);
  const e4 = engine.hit[4];
  const p4 = bestSellers.hit[4];
  return {
    considered: rows.length,
    evaluated: engine.evaluated,
    skipped: { notOnSaleNow },
    engine,
    bestSellers,
    liftAt4: e4 !== null && p4 !== null && p4 > 0 ? Math.round((e4 / p4) * 10) / 10 : null,
  };
}
