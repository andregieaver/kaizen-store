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

/** Can be bought now: goods in stock at an active place, or digital; bookings count as available. */
export function inStockNow(): SQL {
  return sql`(p.kind <> 'goods' or exists (
    select 1 from commerce.product_variants v
    where v.product_id = p.id and v.active and (v.delivery = 'digital' or (
      select coalesce(sum(s.available), 0) from commerce.available_stock s
      join commerce.inventory_locations l on l.store_id = s.store_id and l.id = s.location_id and l.active
      where s.store_id = p.store_id and s.variant_id = v.id
    ) > 0)
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
