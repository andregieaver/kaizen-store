import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";

import { db } from "@/db/client";
import { priceView, type PriceView } from "@/lib/pricing";
import type { Delivery } from "@/lib/product-input";

/**
 * Cache tags. Revalidate a store's catalogue tag after any product or price
 * change in it; `catalog` covers every store.
 */
export const CATALOG_TAG = "catalog";
export const catalogTag = (storeId: string) => `catalog:${storeId}`;

export type ProductSummary = {
  handle: string;
  title: string;
  image: { url: string; alt: string } | null;
  price: PriceView;
  /** True when variants differ in price, so the price shown is a minimum. */
  priceVaries: boolean;
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
  images: { url: string; alt: string }[];
  manufacturer: EconomicOperator | null;
  responsiblePerson: EconomicOperator | null;
  variants: ProductVariant[];
};

type Row = Record<string, unknown>;

// Postgres bigint arrives as a string; amounts in minor units fit a JS number.
const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const str = (value: unknown): string => (value === null ? "" : String(value));

/** Active products with a price in the market, cheapest variant first. */
export async function listProducts(
  storeId: string,
  marketCode: string,
  locale: string,
): Promise<ProductSummary[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));

  const rows = await db().execute<Row>(sql`
    select
      p.handle,
      coalesce(tl.title, tf.title) as title,
      coalesce(m.thumbnail_url, m.url) as image_url,
      coalesce(m.alt ->> ${locale}, '') as image_alt,
      pr.min_amount,
      pr.max_amount,
      pr.currency,
      pr.prior_30d
    from commerce.products p
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

  return rows.map((row) => ({
    handle: str(row.handle),
    title: str(row.title),
    image: row.image_url
      ? { url: str(row.image_url), alt: str(row.image_alt) }
      : null,
    price: priceView(num(row.min_amount), str(row.currency), numOrNull(row.prior_30d)),
    priceVaries: num(row.min_amount) !== num(row.max_amount),
  }));
}

/** One active product with its variants priced in the market, or null. */
export async function getProduct(
  storeId: string,
  marketCode: string,
  locale: string,
  handle: string,
): Promise<ProductDetail | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));

  const [product] = await db().execute<Row>(sql`
    select
      p.id, p.handle, p.withdrawal_exclusion,
      coalesce(tl.title, tf.title) as title,
      coalesce(tl.description, tf.description, '') as description,
      coalesce(tl.safety_information, tf.safety_information, '') as safety_information,
      -- Search text in the page's own language, or with the fallback text.
      coalesce(case when tl.product_id is null then tf.seo_title else tl.seo_title end, '') as seo_title,
      coalesce(case when tl.product_id is null then tf.seo_description else tl.seo_description end, '') as seo_description,
      mf.name as mf_name, mf.postal_address as mf_postal, mf.electronic_address as mf_electronic,
      rp.name as rp_name, rp.postal_address as rp_postal, rp.electronic_address as rp_electronic
    from commerce.products p
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

  const [media, variants] = await Promise.all([
    db().execute<Row>(sql`
      select url, coalesce(alt ->> ${locale}, '') as alt
      from commerce.product_media
      where product_id = ${product.id}
      order by position
    `),
    db().execute<Row>(sql`
      select v.id, v.sku, v.gtin, v.options, v.delivery, cp.amount_minor, cp.currency, cp.prior_30d_minor
      from commerce.product_variants v
      join commerce.current_prices cp
        on cp.variant_id = v.id and cp.market_code = ${marketCode}
      where v.product_id = ${product.id} and v.active
      order by cp.amount_minor, v.sku
    `),
  ]);
  if (variants.length === 0) return null;

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
    images: media.map((m) => ({ url: str(m.url), alt: str(m.alt) })),
    manufacturer: operator("mf"),
    responsiblePerson: operator("rp"),
    variants: variants.map((v) => ({
      id: str(v.id),
      sku: str(v.sku),
      gtin: v.gtin ? str(v.gtin) : null,
      options: (v.options ?? {}) as Record<string, string>,
      price: priceView(num(v.amount_minor), str(v.currency), numOrNull(v.prior_30d_minor)),
      delivery: v.delivery === "digital" ? "digital" : "physical",
    })),
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
