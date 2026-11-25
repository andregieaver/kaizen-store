import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { addDays, customPeriod, todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import { SALES_DAYS, socialFacts, type ProductInput, type SocialFacts, type SocialFactsInput } from "@/lib/social-facts";

import { periodTotals } from "./analytics-totals";
import { marketingReport, postReport } from "./analytics-traffic-data";
import { productsReport } from "./analytics-products-data";
import { goalsWithProgress } from "./autopilot-goals";
import { listGridProducts } from "./catalog";
import { insightsView } from "./social-insights";
import type { Store } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * Gathers the social media adviser's facts for a store (D870 S1.3, the pure work in `src/lib/social-facts.ts`): the last 28 days' sales
 * against the 28 before (`periodTotals()`), its goals and their progress (`goalsWithProgress()`), its products with margin and stock
 * (`productsReport()` and the stock levels), social channels' visits and sales (`marketingReport()`), its tagged posts of 90 days
 * (`postReport()`), the creator's posts and the Instagram account's figures (`insightsView()`; Kaizena Flow's store reads the platform's
 * account while it has none). Read only, every figure the analytics' own.
 */

const STOCK_ROW = z.object({ product_id: col.uuid, stock: col.minor.nullable(), is_new: col.bool });
const CREATOR_ROW = z.object({ written: col.minor, copied: col.minor });

export async function gatherSocialFacts(store: Store, accountId: string, now = new Date()): Promise<SocialFacts> {
  const today = todayIn(now, store.timeZone);
  const last = customPeriod(addDays(today, -SALES_DAYS), addDays(today, -1));
  const before = customPeriod(addDays(today, -2 * SALES_DAYS), addDays(today, -SALES_DAYS - 1));
  const ninety = customPeriod(addDays(today, -90), today);

  const market = store.markets[0];
  const [totals, previous, goals, products, offered, marketing, posts, creator, ownInsights] = await Promise.all([
    periodTotals(store, last),
    periodTotals(store, before),
    goalsWithProgress({ account: { id: accountId }, store }, { now }),
    productsReport(store, last, null, { productCap: 100 }),
    market ? listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "newest", limit: 100 }) : Promise.resolve([]),
    marketingReport(store, last, now),
    postReport(store, ninety, now),
    typedRows(
      CREATOR_ROW,
      sql`
      select count(distinct ref) as written, count(distinct ref) filter (where copied_at is not null) as copied
      from commerce.social_posts where store_id = ${store.id}::uuid and created_at > now() - interval '90 days'
    `,
    ),
    insightsView(store.id),
  ]);
  const insights = ownInsights.state === "none" && store.house ? await insightsView(null) : ownInsights;

  // Every product on sale in the main market, with what sold of it, its stock and whether it is new: one that sold nothing is still a
  // candidate to show (new, in stock).
  const ids = offered.map((p) => p.id);
  const stock = ids.length
    ? await typedRows(
        STOCK_ROW,
        sql`
        select p.id as product_id,
          (select sum(l.on_hand) from commerce.product_variants v join commerce.inventory_levels l on l.store_id = v.store_id and l.variant_id = v.id
           where v.store_id = p.store_id and v.product_id = p.id) as stock,
          coalesce(p.first_active_at, p.created_at) > now() - interval '30 days' as is_new
        from commerce.products p
        where p.store_id = ${store.id}::uuid and p.id = any(${`{${ids.join(",")}}`}::uuid[])
      `,
      )
    : [];
  const stockOf = new Map(stock.map((r) => [r.product_id, r]));
  const sold = new Map(products.rows.map((r) => [r.productId, r]));
  const productInputs: ProductInput[] = offered.map((p) => {
    const row = sold.get(p.id);
    const level = stockOf.get(p.id);
    return { id: p.id, title: p.title, revenueMinor: row?.revenueMinor ?? 0, units: row?.units ?? 0, margin: row?.margin ?? null, stock: level?.stock ?? null, isNew: level?.is_new ?? false };
  });

  const table = marketing.table;
  const socialRows = table?.rows.filter((r) => r.channel === "organic_social" || r.channel === "paid_social") ?? [];
  const input: SocialFactsInput = {
    store: { name: store.name, currency: mainCurrency(store), timeZone: store.timeZone },
    now: now.toISOString(),
    sales: {
      revenueMinor: totals.totals.revenueMinor,
      orders: totals.totals.orders,
      sessions: table ? table.blended.sessions : null,
      previousRevenueMinor: previous.totals.revenueMinor,
      previousOrders: previous.totals.orders,
    },
    goals: goals
      .filter((g) => g.status === "active")
      .map((g) => ({ title: g.title, targets: g.progress.map((p) => ({ kind: p.kind, target: p.target, now: p.now, met: p.met })) })),
    products: productInputs,
    social: table
      ? {
          sessions: socialRows.reduce((s, r) => s + (r.sessions ?? 0), 0),
          orders: socialRows.reduce((s, r) => s + r.orders, 0),
          revenueMinor: socialRows.reduce((s, r) => s + r.revenueMinor, 0),
          allSessions: table.blended.sessions ?? 0,
          allRevenueMinor: table.blended.revenueMinor,
        }
      : null,
    taggedPosts: posts.rows.map((p) => ({ source: p.source, content: p.content, sessions: p.sessions, orders: p.orders, revenueMinor: p.revenueMinor })),
    creator: { written: creator[0]?.written ?? 0, copied: creator[0]?.copied ?? 0 },
    instagram:
      insights.state === "ready"
        ? {
            state: "ready",
            username: insights.username,
            posts: insights.posts.map((p) => ({
              kind: p.kind,
              postedAt: p.postedAt,
              caption: p.caption,
              reach: p.figures.reach,
              likes: p.figures.likes,
              saves: p.figures.saves,
              shares: p.figures.shares,
            })),
          }
        : { state: insights.state },
  };
  return socialFacts(input);
}
