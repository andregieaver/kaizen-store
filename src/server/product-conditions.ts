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
 * products asks it. A product an exclusive price list reaches (D321 C.3, `commerce.product_exclusive()`) is offered to no one here: the reads
 * made per request for a known buyer ask `offeredTo()` instead, which offers it to that list's buyers.
 */
export const OFFERED = sql`(commerce.feature_on(p.store_id, 'shop')
  and (p.audience = 'all' or commerce.product_offered(p.store_id, p.audience))
  and ((p.kind = 'goods' and not p.subscription_only) or commerce.kind_offered(p.store_id, p.kind, p.subscription_only))
  and not commerce.product_exclusive(p.store_id, p.id))`;

/**
 * `OFFERED` for a known buyer (D321 C.3): the same conditions, with a product an exclusive list reaches offered when one of the buyer's own lists
 * is that list (`commerce.buyer_sees()`); a guest (null) sees what `OFFERED` offers. Only for reads made per request (the cart, checkout, the
 * buyer's catalogue), never in a cached one.
 */
export const offeredTo = (customerId: string | null): SQL => sql`(commerce.feature_on(p.store_id, 'shop')
  and (p.audience = 'all' or commerce.product_offered(p.store_id, p.audience))
  and ((p.kind = 'goods' and not p.subscription_only) or commerce.kind_offered(p.store_id, p.kind, p.subscription_only))
  and commerce.buyer_sees(p.store_id, ${customerId}::uuid, p.id))`;

/**
 * The product `p`'s place in the owner's order of the category or tag `termId` (wave 6 unit A, D319), as an ORDER BY term: placed products by
 * their place, then those not placed by hand (added since, or in a subcategory only). A collection filled by rules has no order of the owner's:
 * its products come newest first. Follow it with the reader's own tie-break.
 */
export const manualPlace = (termId: string): SQL => sql`(
  select pt.position from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = ${termId}::uuid
) asc nulls last, (
  case when exists (select 1 from commerce.terms rt where rt.id = ${termId}::uuid and rt.rules is not null) then p.created_at end
) desc nulls last`;

/**
 * Purchase options (selling plans, D25) are offered while the store feature Subscriptions is on (D178), for the store whose id is given
 * (`sp.store_id`, `cl.store_id`, `p.store_id`). A product sold only as a subscription is not offered at all while it is off (`OFFERED`);
 * one sold both ways is sold once only, and a cart line on a plan is unavailable.
 */
export const plansOffered = (storeId: SQL) => sql`commerce.feature_on(${storeId}, 'subscriptions')`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The product `p` is in one of the store's categories or tags `ids` (wave 6 unit A2, D319): placed in one by hand (`product_terms`), or meeting the
 * rules of one filled by rules (`commerce.product_matches_rules()`, the one evaluator). Every reader of a category's or tag's products asks this, so
 * a collection filled by rules lists where a manual one does. No ids is every product.
 */
export function inTerms(ids: readonly string[]): SQL {
  const list = `{${ids.filter((id) => UUID.test(id)).join(",")}}`;
  if (list === "{}") return ids.length === 0 ? sql`true` : sql`false`;
  return sql`(exists (
    select 1 from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = any(${list}::uuid[])
  ) or exists (
    select 1 from commerce.terms rt
    where rt.store_id = p.store_id and rt.id = any(${list}::uuid[]) and rt.rules is not null and commerce.product_matches_rules(p.store_id, p.id, rt.rules)
  ))`;
}

export const textList = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;

/** In one of the store's product categories (by address), or one below it; a category filled by rules by its rules (D319). */
export function inCategories(slugs: string[]): SQL {
  return sql`exists (
    with recursive picked as (
      select id, rules from commerce.terms
      where store_id = p.store_id and content_type = 'product' and kind = 'category' and slug = any(${textList(slugs)})
      union
      select t.id, t.rules from commerce.terms t join picked on t.parent_id = picked.id
    )
    select 1 from picked
    where exists (select 1 from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = picked.id)
      or (picked.rules is not null and commerce.product_matches_rules(p.store_id, p.id, picked.rules))
  )`;
}

/** With one of the store's product tags (by address); a tag filled by rules by its rules (D319). */
export function withTags(slugs: string[]): SQL {
  return sql`exists (
    select 1 from commerce.terms te
    where te.store_id = p.store_id and te.content_type = 'product' and te.kind = 'tag' and te.slug = any(${textList(slugs)})
      and (exists (select 1 from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = te.id)
        or (te.rules is not null and commerce.product_matches_rules(p.store_id, p.id, te.rules)))
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

/**
 * Which lines a price list may price (wave 6 unit C1, D321, `docs/wave-6-catalogue.md` C.1), for a cart line `cl` of a product `p`: goods and
 * appointments bought once, never a purchase option, a stay's or rental's season pricing or a gift card. The join condition of
 * `commerce.buyer_price()` in the cart and checkout alike.
 */
export const LIST_PRICED = sql`(cl.selling_plan_id is null and p.kind in ('goods', 'appointment'))`;
