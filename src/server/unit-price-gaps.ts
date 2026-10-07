import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { priceVat } from "@/lib/pricing";
import { unitPriceShown, type ShownMeasure, type UnitPriceShown } from "@/lib/unit-price";
import { shownMeasureFromColumns, type UnitPriceCategory } from "@/lib/unit-price-rules";
import { STORE_AUDIENCE } from "./product-conditions";

/**
 * Which products still need their content for the unit price (D160, `docs/wave-1d-unit-price.md` 2.2 and 3.3). "Needs"
 * is decided in one place, `commerce.unit_price_required()` (a product marked `sold_by_measure`, or in a product category
 * marked `requires_unit_price` or under one that is); the pure twin is `unitPriceNeed()`. Every query carries the store id.
 */

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The chosen categories and every ancestor of each, with their marks: what `unitPriceProblems()` needs of a product that
 * is about to be saved (the same chain the database function walks). Ids that are not the store's product categories
 * are left out. A cycle cannot occur (the database refuses one), and `union` stops a repeated row.
 */
export async function categoryMarks(storeId: string, categoryIds: readonly string[]): Promise<UnitPriceCategory[]> {
  const ids = [...new Set(categoryIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    with recursive up(id) as (
      select t.id from commerce.terms t
      where t.store_id = ${storeId}::uuid and t.content_type = 'product' and t.kind = 'category'
        and t.id = any(${`{${ids.join(",")}}`}::uuid[])
      union
      select t.parent_id from up join commerce.terms t on t.id = up.id and t.store_id = ${storeId}::uuid
      where t.parent_id is not null
    )
    select t.name, t.requires_unit_price
    from up join commerce.terms t on t.id = up.id and t.store_id = ${storeId}::uuid
    order by t.name
  `);
  return rows.map((row) => ({ name: String(row.name), requiresUnitPrice: Boolean(row.requires_unit_price) }));
}

export type ProductNeedingMeasure = {
  productId: string;
  handle: string;
  title: string;
  /** Why: the product says so, or the named category (or one above it) is marked. */
  reason: { kind: "flag" } | { kind: "category"; category: string };
  /** The SKUs of its active physical variants that have no content. */
  skus: string[];
};

/**
 * Active goods that need a measure and have an active physical variant without one: the products page's notice and
 * filter, and the AI manager's tool. These are products grandfathered by a category marked after they were assigned, or
 * a product that went live before the rule existed: they stay on sale (no unit line is shown) and are refused at their
 * next save. Nothing is hidden or deactivated here. `locale` is the store's main language, for the title.
 */
export async function productsNeedingMeasure(storeId: string, locale: string): Promise<ProductNeedingMeasure[]> {
  const rows = await db().execute<Row>(sql`
    select * from (
      select p.id, p.handle, p.sold_by_measure,
        coalesce(
          (select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id and t.locale = ${locale}),
          (select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id order by t.locale limit 1),
          p.handle
        ) as title,
        (
          with recursive up(id) as (
            select pt.term_id from commerce.product_terms pt
            join commerce.terms c on c.id = pt.term_id and c.store_id = p.store_id and c.kind = 'category'
            where pt.store_id = p.store_id and pt.product_id = p.id
            union
            select t.parent_id from up join commerce.terms t on t.id = up.id and t.store_id = p.store_id where t.parent_id is not null
          )
          select t.name from up join commerce.terms t on t.id = up.id and t.store_id = p.store_id and t.requires_unit_price
          order by t.name limit 1
        ) as category,
        (
          select array_agg(v.sku order by v.sku) from commerce.product_variants v
          where v.store_id = p.store_id and v.product_id = p.id and v.active and v.delivery = 'physical' and v.measure_amount is null
        ) as skus
      from commerce.products p
      where p.store_id = ${storeId}::uuid and p.status = 'active' and p.kind = 'goods'
        and commerce.unit_price_required(p.store_id, p.id)
    ) q
    where q.skus is not null
    order by lower(q.title), q.handle
  `);
  return rows.map((row) => ({
    productId: String(row.id),
    handle: String(row.handle),
    title: String(row.title),
    // The flag first, as `unitPriceNeed()` decides it.
    reason: row.sold_by_measure ? { kind: "flag" } : { kind: "category", category: String(row.category) },
    skus: (row.skus as string[]).map(String),
  }));
}

/**
 * For each category marked as needing a unit price, how many active goods products in it or in a subcategory still have
 * an active physical variant without content: the categories page's "N active products in this category have no content
 * yet". Every marked category is a key (0 when none).
 */
export async function categoryGaps(storeId: string): Promise<Map<string, number>> {
  const rows = await db().execute<Row>(sql`
    with recursive sub(root, id) as (
      select t.id, t.id from commerce.terms t
      where t.store_id = ${storeId}::uuid and t.content_type = 'product' and t.kind = 'category' and t.requires_unit_price
      union
      select sub.root, t.id from sub join commerce.terms t on t.parent_id = sub.id and t.store_id = ${storeId}::uuid
    )
    select sub.root,
      count(distinct p.id) filter (
        where p.id is not null and exists (
          select 1 from commerce.product_variants v
          where v.store_id = p.store_id and v.product_id = p.id and v.active and v.delivery = 'physical' and v.measure_amount is null
        )
      )::int as gaps
    from sub
    left join commerce.product_terms pt on pt.store_id = ${storeId}::uuid and pt.term_id = sub.id
    left join commerce.products p on p.store_id = ${storeId}::uuid and p.id = pt.product_id and p.status = 'active' and p.kind = 'goods'
    group by sub.root
  `);
  return new Map(rows.map((row) => [String(row.root), Number(row.gaps)]));
}

export type VariantUnitPrice = {
  sku: string;
  marketCode: string;
  /** The market's own currency: nothing here is converted. */
  currency: string;
  amountMinor: number;
  /** The measure with the base the market's country shows; null for a variant with no content. */
  measure: ShownMeasure | null;
  /** From `unitPriceShown()` on the price as the store shows it (with or without VAT); null without a measure. */
  unit: UnitPriceShown | null;
};

/**
 * A product's active variants with their content and the unit price in each market they are priced in, in the
 * country's own currency, worked out by the same function the shop uses (`unitPriceShown()`): for the AI manager's
 * `get_product` and the staff screens; the reader adds no arithmetic of its own.
 */
export async function variantUnitPrices(storeId: string, productId: string): Promise<VariantUnitPrice[]> {
  const rows = await db().execute<Row>(sql`
    select v.sku, v.measure_amount, v.measure_unit, v.measure_base, cp.market_code, cp.currency, cp.amount_minor,
      commerce.vat_rate(cp.market_code, p.vat_category) as vat_rate, ${STORE_AUDIENCE} as audience
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    join commerce.stores s on s.id = p.store_id
    join commerce.current_prices cp on cp.variant_id = v.id
    where v.store_id = ${storeId}::uuid and v.product_id = ${productId}::uuid and v.active
    order by v.sku, cp.market_code
  `);
  return rows.map((row) => {
    const marketCode = String(row.market_code);
    const amountMinor = Number(row.amount_minor);
    const measure = shownMeasureFromColumns(row.measure_amount, row.measure_unit, row.measure_base, marketCode);
    return {
      sku: String(row.sku),
      marketCode,
      currency: String(row.currency).trim(),
      amountMinor,
      measure,
      unit: measure ? unitPriceShown(amountMinor, priceVat(row.audience, row.vat_rate), measure, measure.base) : null,
    };
  });
}

/** How many of the store's active physical variants of active goods have their content set, and how many of those there are in all: the AI manager's headline. */
export async function contentCounts(storeId: string): Promise<{ withContent: number; total: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*) filter (where v.measure_amount is not null)::int as with_content, count(*)::int as total
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active' and p.kind = 'goods'
    where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical'
  `);
  return { withContent: Number(row?.with_content ?? 0), total: Number(row?.total ?? 0) };
}
