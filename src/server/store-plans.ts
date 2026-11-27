import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { readDb } from "@/db/client";
import { CATALOG_TAG, catalogTag, pagesTag } from "@/lib/cache-tags";
import { parseStoreAudience, vatShown, withoutVat } from "@/lib/b2b";
import type { Market } from "@/lib/markets";
import { includedLines, lowestPerInterval, type StorePlan, type StorePlanPrice } from "@/lib/store-plans";
import { planPrice } from "@/lib/subscriptions";

import { PLAN_OFFERED, STORE_AUDIENCE } from "./product-conditions";
import { col, typedRows } from "./typed-rows";

const PLAN_ROW = z.object({
  id: col.uuid,
  handle: col.text,
  title: col.text,
  excerpt: col.text,
  description: col.text,
  variant_id: col.uuid,
  amount_minor: col.minor,
  currency: col.currency,
  selling_plan_id: col.uuid,
  interval: z.enum(["month", "year"]),
  discount_percent: col.int,
  trial_days: col.int,
  zero_free: col.bool,
  store_audience: col.text,
  vat_rate: col.decimal,
  category_ids: z.array(col.uuid),
});

/** A store's plans in a market, and whether their prices are shown with VAT (consumers, and a store selling to both) or without (businesses only). */
export type StorePlans = { plans: StorePlan[]; withVat: boolean };

/**
 * A store's plans in a market (D912), for its pricing table: each active plan product offered there (`PLAN_OFFERED`, the one reader of it),
 * in the market's language (else its first translation), with what a subscriber pays at each billing period. A price is a variant's in
 * the market, in the market's own currency (a subscription renews in it, D109), less its purchase option's discount; only options
 * renewing every month or every year, each for its own variant or for every variant (D911). A plan with no such price is left out. A store
 * selling only to businesses shows them without VAT, as its other prices are (D178); one selling to both, with it.
 * Cached with the catalogue, so any change to a product, a price or an option shows.
 */
export async function getStorePlans(storeId: string, market: Market): Promise<StorePlans> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  const rows = await typedRows(
    PLAN_ROW,
    sql`
    select p.id, p.handle,
      coalesce(tl.title, tf.title, p.handle) as title,
      coalesce(tl.excerpt, tf.excerpt, '') as excerpt,
      coalesce(tl.description, tf.description, '') as description,
      v.id as variant_id, cp.amount_minor, cp.currency,
      sp.id as selling_plan_id, sp.interval::text as interval, sp.discount_percent, sp.trial_days,
      commerce.zero_shows_free(p.store_id, p.id) as zero_free,
      ${STORE_AUDIENCE} as store_audience, commerce.vat_rate(${market.code}, p.vat_category) as vat_rate,
      -- Its product categories and every one above them (D914), for a pricing table that shows one category's plans.
      coalesce((
        with recursive up(id, parent_id) as (
          select t.id, t.parent_id from commerce.product_terms pt
          join commerce.terms t on t.store_id = pt.store_id and t.id = pt.term_id and t.kind = 'category'
          where pt.store_id = p.store_id and pt.product_id = p.id
          union
          select t.id, t.parent_id from commerce.terms t join up on t.id = up.parent_id
          where t.store_id = p.store_id
        )
        select array_agg(id::text) from up
      ), '{}'::text[]) as category_ids
    from commerce.products p
    join commerce.stores s on s.id = p.store_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (
      select title, excerpt, description from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id and v.active
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    join commerce.selling_plans sp on sp.store_id = p.store_id and sp.product_id = p.id and sp.active
      and (sp.variant_id is null or sp.variant_id = v.id)
      and sp.interval in ('month', 'year') and sp.interval_count = 1
    where p.store_id = ${storeId}::uuid and p.status = 'active' and ${PLAN_OFFERED}
    order by p.created_at, p.handle, v.sku, sp.position
  `,
    readDb(),
  );
  const withVat = rows.length === 0 || vatShown(parseStoreAudience(rows[0].store_audience)) !== "excl";
  const plans = new Map<string, StorePlan & { all: StorePlanPrice[] }>();
  for (const row of rows) {
    const gross = planPrice(row.amount_minor, row.discount_percent);
    const plan =
      plans.get(row.id) ??
      plans
        .set(row.id, {
          id: row.id,
          handle: row.handle,
          name: row.title,
          line: row.excerpt.trim(),
          included: includedLines(row.description),
          zeroFree: row.zero_free,
          prices: [],
          categoryIds: row.category_ids,
          all: [],
        })
        .get(row.id)!;
    plan.all.push({
      currency: row.currency,
      interval: row.interval,
      amountMinor: withVat ? gross : withoutVat(gross, row.vat_rate),
      variantId: row.variant_id,
      sellingPlanId: row.selling_plan_id,
      trialDays: row.trial_days,
    });
  }
  return { plans: [...plans.values()].map(({ all, ...plan }) => ({ ...plan, prices: lowestPerInterval(all) })), withVat };
}

/**
 * Where a plan's own address leads (D912): a plan has no page, so `/p/{its handle}` goes to the store's published page holding the Plans
 * component (its oldest), while the plan is on sale; null for any other handle, or when no page shows the plans (the store's 404 then).
 */
export async function planPricingPath(storeId: string, handle: string): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId), pagesTag(storeId));
  const [row] = await typedRows(
    z.object({ slug: col.text }),
    sql`
    select pg.slug from commerce.pages pg
    where pg.store_id = ${storeId}::uuid and pg.type = 'page' and pg.published is not null
      and jsonb_path_exists(pg.published, '$.** ? (@.type == "plans")')
      and exists (
        select 1 from commerce.products p
        where p.store_id = ${storeId}::uuid and p.handle = ${handle} and p.kind = 'plan' and p.status = 'active'
      )
    order by pg.published_at nulls last, pg.slug
    limit 1
  `,
    readDb(),
  );
  return row ? `/${row.slug}` : null;
}
