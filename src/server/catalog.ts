import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";

import { db, readDb } from "@/db/client";
import { parseProductAudience, type ProductAudience } from "@/lib/b2b";
import { parseRentalPeriod, type RentalPeriod } from "@/lib/booking-ranges";
import { isNative, shown, type Market } from "@/lib/markets";
import { priceVat, priceView, type PriceView } from "@/lib/pricing";
import { parseDelivery, type Delivery } from "@/lib/product-input";
import type { ShownGroup } from "@/lib/custom-fields";
import { planPrice, type PlanInterval } from "@/lib/subscriptions";

import { fieldsTag, shownFieldsFor } from "./custom-fields";

/**
 * Cache tags. Revalidate a store's catalogue tag after any product or price
 * change in it; `catalog` covers every store.
 */
export const CATALOG_TAG = "catalog";
export const catalogTag = (storeId: string) => `catalog:${storeId}`;

export type ProductSummary = {
  id: string;
  handle: string;
  title: string;
  image: { url: string; alt: string } | null;
  price: PriceView;
  /** True when variants differ in price, so the price shown is a minimum. */
  priceVaries: boolean;
  /** Who it is for (B2B); always `all` unless the store sells to both. */
  audience: ProductAudience;
};

export type EconomicOperator = {
  name: string;
  postalAddress: string;
  electronicAddress: string;
};

export type ProductVariant = {
  id: string;
  sku: string;
  gtin: string | null;
  options: Record<string, string>;
  price: PriceView;
  /** Shipped, or downloaded after payment (D24). */
  delivery: Delivery;
  /** How a rental's variant is booked (D69); "day" for everything else. */
  rentalPeriod: RentalPeriod;
  /**
   * Its own picture, shown where shoppers choose a variant; `thumbnailUrl` is the small copy, or the
   * picture itself; `alt` the media library's alt text for it (D89).
   */
  image: { url: string; thumbnailUrl: string; alt: string } | null;
};

/** A purchase option for subscribing (D25). */
export type SellingPlan = {
  id: string;
  interval: PlanInterval;
  intervalCount: number;
  discountPercent: number;
  /** Days free before the first charge (D29). */
  trialDays: number;
  /** One-time fee in the market's currency, in minor units; 0 for none (D29). */
  signupFeeMinor: number;
  /** Payments committed to, the first included; 0 for none (D29). */
  minCycles: number;
};

export type ProductDetail = {
  id: string;
  handle: string;
  title: string;
  description: string;
  /** The owner's title and description for search results; empty uses title and description. */
  seoTitle: string;
  seoDescription: string;
  safetyInformation: string;
  withdrawalExclusion: string;
  /** In the owner's order; `thumbnailUrl` is the 480 px copy, or the picture itself. */
  images: { url: string; thumbnailUrl: string; alt: string }[];
  manufacturer: EconomicOperator | null;
  responsiblePerson: EconomicOperator | null;
  variants: ProductVariant[];
  /** Purchase options for subscribing, in the owner's order. */
  plans: SellingPlan[];
  /** Sold only through its purchase options. */
  subscriptionOnly: boolean;
  /** Only sold as a subscription, and the currency shown is not the country's own, the only one subscriptions are in (D109). */
  needsNativeCurrency: boolean;
  /** Who it is for (B2B); always `all` unless the store sells to both. */
  audience: ProductAudience;
  /** Goods, or an appointment booked for a time (D65). */
  kind: "goods" | "appointment" | "stay" | "rental";
  /** The outside host who lists it, when the store is a marketplace (D71). */
  hostName: string | null;
  /** The store's public custom fields with a value for it, by group, in the shopper's language (D118). */
  fields: ShownGroup[];
};

type Row = Record<string, unknown>;

// Postgres bigint arrives as a string; amounts in minor units fit a JS number.
const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const str = (value: unknown): string => (value === null ? "" : String(value));
const orNull = (value: number | null, map: (n: number) => number): number | null => (value === null ? null : map(value));

/** Who a product is for (B2B): only in stores selling to both does it matter. */
const productAudience = (row: Row): ProductAudience =>
  row.store_audience === "both" ? parseProductAudience(row.audience) : "all";

/** Active products with a price in the market, cheapest variant first. */
export async function listProducts(storeId: string, market: Market): Promise<ProductSummary[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  const { code: marketCode, locale } = market;

  const rows = await readDb().execute<Row>(sql`
    select
      p.id,
      p.handle,
      coalesce(tl.title, tf.title) as title,
      coalesce(m.thumbnail_url, m.url) as image_url,
      coalesce(nullif(m.alt ->> ${locale}, ''), commerce.media_alt(m.url, ${locale}), '') as image_alt,
      pr.min_amount,
      pr.max_amount,
      pr.currency,
      pr.prior_30d,
      case when p.subscription_only then (
        select max(sp.discount_percent) from commerce.selling_plans sp where sp.product_id = p.id and sp.active
      ) end as subscriber_discount,
      p.audience,
      s.audience as store_audience,
      commerce.vat_rate(${marketCode}, p.vat_category) as vat_rate
    from commerce.products p
    join commerce.stores s on s.id = p.store_id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select url, thumbnail_url, alt from commerce.product_media
      where product_id = p.id order by position limit 1
    ) m on true
    join lateral (
      select
        min(cp.amount_minor) as min_amount,
        max(cp.amount_minor) as max_amount,
        min(cp.currency) as currency,
        (array_agg(cp.prior_30d_minor order by cp.amount_minor))[1] as prior_30d
      from commerce.current_prices cp
      join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${marketCode}
    ) pr on pr.min_amount is not null
    where p.store_id = ${storeId}::uuid and p.status = 'active'
    order by p.created_at, p.handle
  `);

  return rows.map((row) => {
    // Sold only by subscription: the best subscriber's price, as "from".
    const discount = numOrNull(row.subscriber_discount);
    const vat = priceVat(row.store_audience, row.vat_rate);
    return {
      id: str(row.id),
      handle: str(row.handle),
      title: str(row.title),
      image: row.image_url ? { url: str(row.image_url), alt: str(row.image_alt) } : null,
      // Kept in the country's own currency; shown in the one chosen (D109).
      price:
        discount === null
          ? priceView(shown(market, num(row.min_amount)), market.currency, orNull(numOrNull(row.prior_30d), (n) => shown(market, n)), vat)
          : priceView(planPrice(shown(market, num(row.min_amount)), discount), market.currency, null, vat),
      priceVaries: discount !== null || num(row.min_amount) !== num(row.max_amount),
      audience: productAudience(row),
    };
  });
}

/** One active product with its variants priced in the market, or null. */
export async function getProduct(storeId: string, market: Market, handle: string): Promise<ProductDetail | null> {
  "use cache";
  cacheLife("hours");
  // Custom fields are read inside it (D118), so a change to a store's fields refreshes it too.
  cacheTag(CATALOG_TAG, catalogTag(storeId), fieldsTag(storeId));
  const { code: marketCode, locale } = market;

  const [product] = await readDb().execute<Row>(sql`
    select
      p.id, p.handle, p.withdrawal_exclusion, p.subscription_only, p.kind,
      p.audience, s.audience as store_audience, commerce.vat_rate(${marketCode}, p.vat_category) as vat_rate,
      coalesce(tl.title, tf.title) as title,
      coalesce(tl.description, tf.description, '') as description,
      coalesce(tl.safety_information, tf.safety_information, '') as safety_information,
      -- Search text in the page's own language, or with the fallback text.
      coalesce(case when tl.product_id is null then tf.seo_title else tl.seo_title end, '') as seo_title,
      coalesce(case when tl.product_id is null then tf.seo_description else tl.seo_description end, '') as seo_description,
      mf.name as mf_name, mf.postal_address as mf_postal, mf.electronic_address as mf_electronic,
      rp.name as rp_name, rp.postal_address as rp_postal, rp.electronic_address as rp_electronic,
      (select h.name from commerce.hosts h where h.store_id = p.store_id and h.id = p.host_id) as host_name
    from commerce.products p
    join commerce.stores s on s.id = p.store_id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title, description, safety_information, seo_title, seo_description
      from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join commerce.economic_operators mf
      on mf.store_id = p.store_id and mf.id = p.manufacturer_id
    left join commerce.economic_operators rp
      on rp.store_id = p.store_id and rp.id = p.responsible_person_id
    where p.store_id = ${storeId}::uuid and p.handle = ${handle} and p.status = 'active'
  `);
  if (!product) return null;

  const [media, variants, plans, fields] = await Promise.all([
    readDb().execute<Row>(sql`
      select url, thumbnail_url, coalesce(nullif(alt ->> ${locale}, ''), commerce.media_alt(url, ${locale}), '') as alt
      from commerce.product_media
      where product_id = ${product.id}
      order by position
    `),
    readDb().execute<Row>(sql`
      select v.id, v.sku, v.gtin, v.options, v.delivery, v.rental_period, v.image_url, v.image_thumbnail_url,
        coalesce(commerce.media_alt(v.image_url, ${locale}), '') as image_alt,
        cp.amount_minor, cp.currency, cp.prior_30d_minor
      from commerce.product_variants v
      join commerce.current_prices cp
        on cp.variant_id = v.id and cp.market_code = ${marketCode}
      where v.product_id = ${product.id} and v.active
      order by cp.amount_minor, v.sku
    `),
    readDb().execute<Row>(sql`
      select id, interval, interval_count, discount_percent, trial_days, min_cycles,
        coalesce((signup_fee ->> ${marketCode})::bigint, 0) as signup_fee
      from commerce.selling_plans
      where product_id = ${product.id} and active
      order by position, created_at
    `),
    shownFieldsFor(storeId, "product", str(product.id), locale, market.lang),
  ]);
  if (variants.length === 0) return null;
  const vat = priceVat(product.store_audience, product.vat_rate);

  const operator = (prefix: "mf" | "rp"): EconomicOperator | null =>
    product[`${prefix}_name`]
      ? {
          name: str(product[`${prefix}_name`]),
          postalAddress: str(product[`${prefix}_postal`]),
          electronicAddress: str(product[`${prefix}_electronic`]),
        }
      : null;

  return {
    id: str(product.id),
    handle: str(product.handle),
    title: str(product.title),
    description: str(product.description),
    seoTitle: str(product.seo_title),
    seoDescription: str(product.seo_description),
    safetyInformation: str(product.safety_information),
    withdrawalExclusion: str(product.withdrawal_exclusion),
    images: media.map((m) => ({ url: str(m.url), thumbnailUrl: str(m.thumbnail_url ?? m.url), alt: str(m.alt) })),
    manufacturer: operator("mf"),
    responsiblePerson: operator("rp"),
    variants: variants.map((v) => ({
      id: str(v.id),
      sku: str(v.sku),
      gtin: v.gtin ? str(v.gtin) : null,
      options: (v.options ?? {}) as Record<string, string>,
      price: priceView(shown(market, num(v.amount_minor)), market.currency, orNull(numOrNull(v.prior_30d_minor), (n) => shown(market, n)), vat),
      delivery: parseDelivery(v.delivery),
      rentalPeriod: parseRentalPeriod(v.rental_period),
      image: v.image_url ? { url: str(v.image_url), thumbnailUrl: str(v.image_thumbnail_url ?? v.image_url), alt: str(v.image_alt) } : null,
    })),
    // Subscriptions are in the country's own currency only (D109): they renew at a price kept in it.
    plans: (isNative(market) ? plans : []).map((plan) => ({
      id: str(plan.id),
      interval: plan.interval as PlanInterval,
      intervalCount: num(plan.interval_count),
      discountPercent: num(plan.discount_percent),
      trialDays: num(plan.trial_days),
      signupFeeMinor: shown(market, num(plan.signup_fee)),
      minCycles: num(plan.min_cycles),
    })),
    // Without an option to subscribe to, it can only be bought once.
    subscriptionOnly: Boolean(product.subscription_only) && plans.length > 0,
    needsNativeCurrency: !isNative(market) && Boolean(product.subscription_only) && plans.length > 0,
    hostName: product.host_name ? String(product.host_name) : null,
    fields,
    audience: productAudience(product),
    kind: product.kind === "appointment" || product.kind === "stay" || product.kind === "rental" ? product.kind : "goods",
  };
}

/**
 * Units available to sell per variant, across active locations, net of live
 * reservations. Never cached: stock is read on every request.
 */
export async function getAvailability(
  storeId: string,
  variantIds: string[],
): Promise<Map<string, number>> {
  await connection();
  if (variantIds.length === 0) return new Map();
  const rows = await db().execute<Row>(sql`
    select s.variant_id, sum(s.available)::int as available
    from commerce.available_stock s
    join commerce.inventory_locations l
      on l.store_id = s.store_id and l.id = s.location_id and l.active
    where s.store_id = ${storeId}::uuid and s.variant_id in (${sql.join(
      variantIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    group by s.variant_id
  `);
  return new Map(rows.map((r) => [str(r.variant_id), num(r.available)]));
}

export type GridProduct = ProductSummary & { description: string };

/**
 * Active products with a price in the market for a content grid (D51):
 * only those in one of `categoryIds` (when given) and one of `tagIds`
 * (when given), sorted and at most `limit`. With `ids` (search results),
 * only those products, in that order.
 */
export async function listGridProducts(
  storeId: string,
  market: Market,
  filter: { categoryIds: string[]; tagIds: string[]; sort: string; limit: number; ids?: string[] },
): Promise<GridProduct[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  const { code: marketCode, locale } = market;

  const ids = (list: string[]) => `{${list.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(",")}}`;
  const inTerms = (list: string[]) =>
    list.length === 0
      ? sql`true`
      : sql`exists (
          select 1 from commerce.product_terms pt
          where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = any(${ids(list)}::uuid[])
        )`;
  const given = filter.ids ? ids(filter.ids) : null;
  const order = given && filter.sort === "given"
    ? sql`array_position(${given}::uuid[], p.id)`
    : filter.sort === "oldest"
      ? sql`p.created_at, p.handle`
      : filter.sort === "title"
        ? sql`lower(coalesce(tl.title, tf.title)), p.handle`
        : filter.sort === "priceLow"
          ? sql`pr.min_amount, p.handle`
          : filter.sort === "priceHigh"
            ? sql`pr.min_amount desc, p.handle`
            : sql`p.created_at desc, p.handle`;

  const rows = await readDb().execute<Row>(sql`
    select
      p.id,
      p.handle,
      coalesce(tl.title, tf.title) as title,
      coalesce(nullif(tl.description, ''), tf.description, '') as description,
      coalesce(m.thumbnail_url, m.url) as image_url,
      coalesce(nullif(m.alt ->> ${locale}, ''), commerce.media_alt(m.url, ${locale}), '') as image_alt,
      pr.min_amount,
      pr.max_amount,
      pr.currency,
      pr.prior_30d,
      case when p.subscription_only then (
        select max(sp.discount_percent) from commerce.selling_plans sp where sp.product_id = p.id and sp.active
      ) end as subscriber_discount,
      p.audience,
      s.audience as store_audience,
      commerce.vat_rate(${marketCode}, p.vat_category) as vat_rate
    from commerce.products p
    join commerce.stores s on s.id = p.store_id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title, description from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select url, thumbnail_url, alt from commerce.product_media
      where product_id = p.id order by position limit 1
    ) m on true
    join lateral (
      select
        min(cp.amount_minor) as min_amount,
        max(cp.amount_minor) as max_amount,
        min(cp.currency) as currency,
        (array_agg(cp.prior_30d_minor order by cp.amount_minor))[1] as prior_30d
      from commerce.current_prices cp
      join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${marketCode}
    ) pr on pr.min_amount is not null
    where p.store_id = ${storeId}::uuid and p.status = 'active'
      and ${inTerms(filter.categoryIds)}
      and ${inTerms(filter.tagIds)}
      and ${given ? sql`p.id = any(${given}::uuid[])` : sql`true`}
    order by ${order}
    limit ${Math.max(1, Math.min(48, filter.limit))}
  `);

  return rows.map((row) => {
    const discount = numOrNull(row.subscriber_discount);
    const vat = priceVat(row.store_audience, row.vat_rate);
    return {
      id: str(row.id),
      handle: str(row.handle),
      title: str(row.title),
      description: str(row.description),
      image: row.image_url ? { url: str(row.image_url), alt: str(row.image_alt) } : null,
      // Kept in the country's own currency; shown in the one chosen (D109).
      price:
        discount === null
          ? priceView(shown(market, num(row.min_amount)), market.currency, orNull(numOrNull(row.prior_30d), (n) => shown(market, n)), vat)
          : priceView(planPrice(shown(market, num(row.min_amount)), discount), market.currency, null, vat),
      priceVaries: discount !== null || num(row.min_amount) !== num(row.max_amount),
      audience: productAudience(row),
    };
  });
}
