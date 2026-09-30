import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { NO_NOTICES, type CampaignNotice, type CampaignNotices } from "@/lib/campaign-notices";
import { shown, type Market } from "@/lib/markets";

import { storeAndMarket } from "./content-grid";

/**
 * What a store's campaigns announce on its product pages and cards (D115),
 * kept with the catalogue: read once, then served from the cache like the
 * products themselves, so a notice costs a page nothing. The cache lasts to
 * the next start or end of a campaign, at least a minute and at most an hour,
 * and the admin refreshes it (`campaignsTag`) when a campaign is saved; the
 * page itself stops announcing a campaign the moment it ends
 * (`CampaignEnds`). Only what is the same for every shopper is announced.
 */

export const campaignsTag = (storeId: string) => `campaigns:${storeId}`;

type Row = Record<string, unknown>;

export async function campaignNotices(storeId: string, market: Market): Promise<CampaignNotices> {
  "use cache";
  cacheTag(campaignsTag(storeId));
  const now = Date.now();

  const rows = await readDb().execute<Row>(sql`
    select c.id, c.name, c.kind, c.percent, c.buy_quantity, c.pay_quantity, c.thresholds, c.product_ids, c.term_ids,
      c.gift_variant_id, c.usage_limit, c.per_customer_limit, c.markets, c.starts_at, c.ends_at,
      (select coalesce(tl.title, tf.title, p.handle)
         from commerce.product_variants v
         join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
         left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
         left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
         where v.store_id = c.store_id and v.id = c.gift_variant_id) as gift_title,
      case when c.usage_limit is null then 0 else (
        select count(distinct ol.order_id)::int from commerce.order_lines ol
        join commerce.orders o on o.store_id = ol.store_id and o.id = ol.order_id
        where ol.store_id = c.store_id and ol.campaign_parts @> jsonb_build_array(jsonb_build_object('id', c.id::text)) and o.status <> 'cancelled' and o.copied_from is null
      ) end as used
    from commerce.campaigns c
    where c.store_id = ${storeId}::uuid and c.active and c.tier_ids = '[]'::jsonb
      and (c.ends_at is null or c.ends_at > now())
  `);

  const items: CampaignNotice[] = [];
  const boundaries: number[] = [];
  let limited = false;
  const scoped = rows.filter((row) => (row.term_ids as unknown[]).length > 0);
  // Products in a chosen category (its subcategories too) or tag, worked out once for all of them.
  const termsOf = scoped.length > 0 ? await productTerms(storeId) : new Map<string, Set<string>>();

  for (const row of rows) {
    const starts = row.starts_at ? new Date(String(row.starts_at)).getTime() : null;
    const ends = row.ends_at ? new Date(String(row.ends_at)).getTime() : null;
    if (starts !== null && starts > now) {
      boundaries.push(starts);
      continue;
    }
    if (ends !== null) boundaries.push(ends);
    const usageLimit = row.usage_limit === null ? null : Number(row.usage_limit);
    if (usageLimit !== null) {
      limited = true;
      if (Number(row.used) >= usageLimit) continue;
    }
    // Only in the countries it names.
    const countries = (row.markets as unknown[]).map(String);
    if (countries.length > 0 && !countries.includes(market.code)) continue;
    const kind = row.kind as CampaignNotice["kind"];
    const threshold = (row.thresholds as Record<string, number>)[market.code];
    // A free product is announced only where the campaign has an amount, and has its product.
    if (kind === "gift" && (!(threshold > 0) || !row.gift_title)) continue;
    const productIds = (row.product_ids as string[]).map(String);
    const termIds = (row.term_ids as string[]).map(String);
    let reach: string[] | null = null;
    if (productIds.length > 0 || termIds.length > 0) {
      reach = [...new Set([...productIds, ...[...termsOf].filter(([, terms]) => termIds.some((id) => terms.has(id))).map(([product]) => product)])];
    }
    items.push({
      id: String(row.id),
      name: String(row.name),
      kind,
      percent: Number(row.percent),
      buyQuantity: Number(row.buy_quantity),
      payQuantity: Number(row.pay_quantity),
      giftTitle: row.gift_title ? String(row.gift_title) : null,
      thresholdMinor: kind === "gift" ? shown(market, threshold) : null,
      endsAt: ends === null ? null : new Date(ends).toISOString(),
      productIds: reach,
      signIn: row.per_customer_limit !== null,
    });
  }

  // Cached to the next start or end (a minute to an hour), and a minute where uses can run out. The
  // expiry stays past five minutes, or the page could not be prerendered with it.
  const next = boundaries.filter((at) => at > now).sort((a, b) => a - b)[0];
  const seconds = limited ? 60 : next ? Math.min(3600, Math.max(60, Math.ceil((next - now) / 1000))) : 3600;
  cacheLife({ stale: 300, revalidate: seconds, expire: 86400 });
  return items.length > 0 ? { items } : NO_NOTICES;
}

/** Every active product's categories (with their parents) and tags, by product. */
async function productTerms(storeId: string): Promise<Map<string, Set<string>>> {
  const rows = await readDb().execute<Row>(sql`
    with recursive t (product_id, term_id) as (
      select pt.product_id, pt.term_id from commerce.product_terms pt
      join commerce.products p on p.store_id = pt.store_id and p.id = pt.product_id and p.status = 'active'
      where pt.store_id = ${storeId}::uuid
      union
      select t.product_id, tm.parent_id from t join commerce.terms tm on tm.id = t.term_id where tm.parent_id is not null
    )
    select product_id, term_id from t
  `);
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = String(row.product_id);
    (out.get(key) ?? out.set(key, new Set()).get(key)!).add(String(row.term_id));
  }
  return out;
}

/** The notices for a page's owner and market (a content grid, D51): looked up and cached like the grid itself. */
export async function campaignNoticesAt(owner: string, marketCode: string | null): Promise<CampaignNotices> {
  "use cache";
  cacheTag(campaignsTag(owner));
  const shop = await storeAndMarket(owner, marketCode);
  // The lifetime is the notices' own: a cache that reads another lasts no longer than it.
  return shop ? campaignNotices(shop.store.id, shop.market) : NO_NOTICES;
}
