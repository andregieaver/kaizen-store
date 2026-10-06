import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * Conditions on a product `p` in SQL, shared by search's filters (D75) and
 * listings' (D78), so both mean the same thing by a category, a tag or
 * "in stock". Every value is passed as a parameter.
 */

export const textList = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;

/** In one of the store's product categories (by address), or one below it. */
export function inCategories(slugs: string[]): SQL {
  return sql`exists (
    with recursive picked as (
      select id from commerce.terms
      where store_id = p.store_id and content_type = 'product' and kind = 'category' and slug = any(${textList(slugs)})
      union
      select t.id from commerce.terms t join picked on t.parent_id = picked.id
    )
    select 1 from commerce.product_terms pt
    where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id in (select id from picked)
  )`;
}

/** With one of the store's product tags (by address). */
export function withTags(slugs: string[]): SQL {
  return sql`exists (
    select 1 from commerce.product_terms pt join commerce.terms te on te.id = pt.term_id
    where pt.store_id = p.store_id and pt.product_id = p.id and te.content_type = 'product' and te.kind = 'tag'
      and te.slug = any(${textList(slugs)})
  )`;
}

/**
 * In stock NOW: goods physically in stock at an active place, or digital; bookings count as available. A product that is only on
 * backorder (a variant that keeps selling at zero) is NOT in stock now (wave 3, D172): it can be bought, which is not what the
 * filter promises. Read through `commerce.variant_availability`, the one reader of stock.
 */
export function inStockNow(): SQL {
  return sql`(p.kind <> 'goods' or exists (
    select 1 from commerce.product_variants v
    where v.product_id = p.id and v.active and (v.delivery = 'digital' or exists (
      select 1 from commerce.variant_availability va
      where va.store_id = p.store_id and va.variant_id = v.id and va.in_stock > 0
    ))
  ))`;
}

/**
 * A variant `v`'s price `cp` as the shopper is shown it: with VAT, or
 * without it for a business (D63), by the product's VAT rate in the market.
 */
export function shownPrice(marketCode: string, business: boolean): SQL {
  if (!business) return sql`cp.amount_minor`;
  return sql`(cp.amount_minor - round(cp.amount_minor * commerce.vat_rate(${marketCode}, p.vat_category)
    / (1 + commerce.vat_rate(${marketCode}, p.vat_category))))`;
}

/**
 * An amount in a market's own currency, as a SQL expression, in the currency
 * shown (D109): the same factor and rounding step as `shown()`, so a price
 * range asked for in the currency shown finds the products priced in it.
 */
export function convertedSql(amount: SQL, market: { conversion: { factor: number; step: number } }): SQL {
  const { factor, step } = market.conversion;
  if (factor === 1 && step === 1) return amount;
  return sql`(round((${amount})::numeric * ${factor}::numeric / ${step}::numeric) * ${step})::bigint`;
}
