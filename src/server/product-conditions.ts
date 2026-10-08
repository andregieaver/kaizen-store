import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * Conditions on a product `p` in SQL, shared by search's filters (D75) and
 * listings' (D78), so both mean the same thing by a category, a tag or
 * "in stock". Every value is passed as a parameter.
 */

/**
 * Who the store `s` sells to as its shoppers see it (D178): its chosen audience while Sell to businesses is on, else consumers. The one
 * way SQL reads `stores.audience` for a shopper (`audience-readers.test.ts` lists the readers).
 */
export const STORE_AUDIENCE = sql`commerce.store_audience(s.audience, s.features)`;

/**
 * The product `p` is offered in its store at all (D178, B2B): one for everyone always; one for a single kind of buyer only where the store
 * sells to that kind (or to both, where each shopper sees their own kind's). A business-only product is not offered where the store sells
 * to consumers, Sell to businesses switched off included. And it is offered only while what its kind needs is on (D178 step 3,
 * `commerce.kind_offered()`): an appointment needs Appointments, a stay or a rental Stays and rentals, a product sold only as a subscription
 * Subscriptions. And nothing is offered while the online shop is off (D178 step 5: the store is a website). Every shopper-facing read of
 * products asks it.
 */
export const OFFERED = sql`(commerce.feature_on(p.store_id, 'shop')
  and (p.audience = 'all' or commerce.product_offered(p.store_id, p.audience))
  and ((p.kind = 'goods' and not p.subscription_only) or commerce.kind_offered(p.store_id, p.kind, p.subscription_only)))`;

/**
 * Purchase options (selling plans, D25) are offered while the store feature Subscriptions is on (D178), for the store whose id is given
 * (`sp.store_id`, `cl.store_id`, `p.store_id`). A product sold only as a subscription is not offered at all while it is off (`OFFERED`);
 * one sold both ways is sold once only, and a cart line on a plan is unavailable.
 */
export const plansOffered = (storeId: SQL) => sql`commerce.feature_on(${storeId}, 'subscriptions')`;

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
