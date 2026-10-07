import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { dateWindow, decodeCursor, excludesCopied, expandShow, SORTS, type OrderListParams, type SortKey } from "@/lib/order-list";
import { escapeLike, searchWords, type SearchWord } from "@/lib/order-search";

import { textList } from "./sql-arrays";

/**
 * The ONE builder of the Orders list's conditions (wave 3, run 2, D173, `docs/wave-3-orders.md` 3.4 and 4.4): the list, its count, the "select all matching" of a bulk action, the
 * saved views and the AI manager's tool all take their `where` from `orderListWhere()` and nothing else builds one (a scan test holds it). Everything a person typed arrives as a
 * BOUND parameter: a search word is escaped for `LIKE` (`%`, `_` and `\` are literals; the default escape character is the backslash) and passed whole, a tag is a key, a market a code
 * checked against the store's own, a date a string the parser has checked to be a calendar date, `sort` a closed set mapped to fixed SQL; nothing typed is ever a column, an operator or a
 * keyword. The alias of the orders table is `o`. Every sub-query names the store.
 */

/** What the store tells the builder: its own days (`today` in its time zone) and the markets it has, so a date range is a store's local days and a market must be the store's. */
export type OrderListContext = {
  timeZone: string;
  /** The store's today, `YYYY-MM-DD`, in its time zone. */
  today: string;
  marketCodes: readonly string[];
  /**
   * What makes a total comparable across currencies for the "Highest total" and "Lowest total" sorts: each currency the store has rates for, with the factor that turns its minor units into hundredths of the rates'
   * reference currency (a decimal string; `valueFactors()`). Empty for a store with one currency or none: the sort is then by the stored total itself, which uses the index.
   */
  totalFactors: readonly { currency: string; factor: string }[];
};

/**
 * The factors of `OrderListContext.totalFactors` from the store's currency rows (`commerce.store_currencies`: `rate` is units of the currency per one unit of the reference, so a currency worth less per unit has a
 * bigger rate). A total of 500.00 NOK at 11.5 and one of 400.00 DKK at 7.46 are 43.48 and 53.62 of the reference, so the Danish one is the higher. Pure.
 */
export function valueFactors(rows: readonly { currency: string; rate: number | null; digits: number }[]): { currency: string; factor: string }[] {
  const rated = rows.filter((r) => r.rate !== null && r.rate > 0);
  if (rated.length < 2) return [];
  // hundredths of the reference = minor / 10^digits / rate * 100
  return rated.map((r) => ({ currency: r.currency, factor: (10 ** (2 - r.digits) / (r.rate as number)).toPrecision(15) }));
}

/** The value an order's total is sorted by: the total in hundredths of the reference currency when the store has rates for several currencies, else the stored total. Always a bigint. */
export function totalKey(context: Pick<OrderListContext, "totalFactors">): SQL {
  if (context.totalFactors.length === 0) return sql`o.total_minor`;
  const arms = context.totalFactors.map((f) => sql`when ${f.currency} then ${f.factor}::numeric`);
  // A currency with no rate (not in the store's list) counts as the reference: it is not hidden, and the page's own total column shows what it is.
  return sql`round(o.total_minor::numeric * (case o.currency::text ${sql.join(arms, sql` `)} else 1::numeric end))::bigint`;
}

/** What the order's own payments took (a captured payment) and gave back (a succeeded refund): the two figures of the payment state. */
export const CAPTURED_SQL = sql`(select coalesce(sum(p.amount_minor), 0)::bigint from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')`;
export const REFUNDED_SQL = sql`(select coalesce(sum(r.amount_minor), 0)::bigint from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id where p.store_id = o.store_id and p.order_id = o.id and r.status = 'succeeded')`;
const WAS_PAID = sql`exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')`;
export const PHYSICAL_SQL = sql`exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical')`;
/** Units sold on backorder that are still to send (D172, D174 4.7: a backordered unit already in a parcel is not waited for). */
const BACKORDERED = sql`exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.backorder_quantity > 0 and commerce.line_to_send(l.id) > 0)`;
/** An unfinished checkout: waiting for payment, or cancelled and never paid. Never copied history. */
const UNFINISHED = sql`(o.copied_from is null and (o.status = 'pending_payment' or (o.status = 'cancelled' and not ${WAS_PAID})))`;

/** One word of the search: it matches an order when any of the six holds; the person's own data (email, name) only on an order whose person was not erased (D162). */
function wordMatches(word: SearchWord): SQL {
  const contains = `%${word.like}%`;
  const arms: SQL[] = [];
  if (word.numberLike !== null) {
    arms.push(sql`upper(regexp_replace(o.number, '\\s', '', 'g')) like ${`${word.numberLike}%`}`);
  }
  arms.push(sql`(o.restricted_at is null and o.anonymised_at is null
      and (lower(o.email) like lower(${contains})
        or lower(o.shipping_address ->> 'name') like lower(${contains})
        or lower(o.billing_address ->> 'name') like lower(${contains})))`);
  arms.push(sql`exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id
      and (lower(l.title) like lower(${contains}) or lower(l.sku) like lower(${contains})))`);
  arms.push(sql`exists (select 1 from commerce.order_tags t where t.store_id = o.store_id and t.order_id = o.id
      and (t.key = ${word.key} or t.key like ${`${escapeLike(word.key)}%`}))`);
  arms.push(sql`exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null and lower(sh.tracking_number) = ${word.key})`);
  return sql`(${sql.join(arms, sql` or `)})`;
}

const any = (conditions: readonly SQL[]): SQL => (conditions.length === 1 ? conditions[0] : sql`(${sql.join([...conditions], sql` or `)})`);

/** The payment filters (2.2, 4.4): one fragment each; several chosen are alternatives. */
function payCondition(filter: OrderListParams["pay"][number]): SQL {
  switch (filter) {
    case "paid":
      return sql`(${CAPTURED_SQL} > 0 and ${REFUNDED_SQL} = 0)`;
    case "partially_refunded":
      return sql`(${REFUNDED_SQL} > 0 and ${REFUNDED_SQL} < ${CAPTURED_SQL})`;
    case "refunded":
      return sql`(${CAPTURED_SQL} > 0 and ${REFUNDED_SQL} >= ${CAPTURED_SQL})`;
    case "balance_due":
      return sql`(o.balance_minor > 0 and o.status in ('paid', 'fulfilled'))`;
    case "unpaid":
      return UNFINISHED;
  }
}

/** The fulfilment filters: copied history is never in one (`excludesCopied()` adds the guard). */
function shipCondition(filter: OrderListParams["ship"][number]): SQL {
  switch (filter) {
    case "to_send":
      return sql`(o.status = 'paid' and ${PHYSICAL_SQL})`;
    case "waiting":
      return sql`(o.status = 'paid' and ${PHYSICAL_SQL} and ${BACKORDERED})`;
    case "sent":
      return sql`(o.status = 'fulfilled')`;
    case "no_shipping":
      return sql`(not ${PHYSICAL_SQL})`;
    // D174: a parcel is recorded and units are still to send (the order stays paid until none is left).
    case "partly_sent":
      return sql`(o.status = 'paid' and exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null))`;
    case "edit_pending":
      return sql`exists (select 1 from commerce.order_edits e where e.store_id = o.store_id and e.order_id = o.id and e.status = 'awaiting_payment')`;
  }
}

/**
 * The condition of a list state over `commerce.orders o`. `show` is written out as the filters it stands for (`expandShow()`). With no payment filter the list is the default one: everything
 * but unfinished checkouts (copied history included), the archive aside. Choosing a payment, fulfilment or status filter, or a source other than copied, is a statement about real sales:
 * copied history never matches it (`excludesCopied()`).
 */
export function orderListWhere(storeId: string, input: OrderListParams, context: OrderListContext): SQL {
  const params = expandShow(input);
  const conditions: SQL[] = [sql`o.store_id = ${storeId}::uuid`];

  // A search finds archived orders too (an order is looked up by its number whatever its state): the archive is left out of the default list only while nothing is searched for.
  const searching = searchWords(params.q).words.length > 0;
  if (params.archived === "no" && !searching) conditions.push(sql`o.archived_at is null`);
  else if (params.archived === "yes") conditions.push(sql`o.archived_at is not null`);

  if (excludesCopied(params)) conditions.push(sql`o.copied_from is null`);

  if (params.pay.length > 0) {
    conditions.push(any(params.pay.map(payCondition)));
  } else {
    // The default list: unfinished checkouts are their own view.
    conditions.push(sql`(o.copied_from is not null or o.status not in ('pending_payment', 'cancelled') or (o.status = 'cancelled' and ${WAS_PAID}))`);
  }
  if (params.ship.length > 0) conditions.push(any(params.ship.map(shipCondition)));
  if (params.status.length > 0) conditions.push(sql`o.status::text = any(${textList(params.status)})`);

  for (const key of params.tag) {
    conditions.push(sql`exists (select 1 from commerce.order_tags t where t.store_id = o.store_id and t.order_id = o.id and t.key = ${key})`);
  }

  const window = dateWindow(params, context.today);
  if (window.from) conditions.push(sql`o.placed_at >= (${window.from}::date::timestamp at time zone ${context.timeZone})`);
  if (window.toExclusive) conditions.push(sql`o.placed_at < (${window.toExclusive}::date::timestamp at time zone ${context.timeZone})`);

  if (params.market && context.marketCodes.includes(params.market)) conditions.push(sql`o.market_code = ${params.market}`);

  if (params.source === "checkout") conditions.push(sql`o.source = 'checkout'`);
  else if (params.source === "draft") conditions.push(sql`o.source = 'draft'`);
  else if (params.source === "copied") conditions.push(sql`o.copied_from is not null`);

  if (params.gift) conditions.push(sql`o.is_gift`);

  for (const word of searchWords(params.q).words) conditions.push(wordMatches(word));

  return sql.join(conditions, sql` and `);
}

/** The fixed `order by` of each sort: the sort key and then the id, so equal keys have one order. */
export function orderListOrderBy(sort: SortKey, context: Pick<OrderListContext, "totalFactors">): SQL {
  const { field, direction } = SORTS[sort];
  const column = field === "placed" ? sql`o.placed_at` : totalKey(context);
  return direction === "desc" ? sql`${column} desc, o.id desc` : sql`${column} asc, o.id asc`;
}

/** The order BACKWARDS (the page before a cursor reads its rows this way). */
export function orderListOrderByReversed(sort: SortKey, context: Pick<OrderListContext, "totalFactors">): SQL {
  const { field, direction } = SORTS[sort];
  const column = field === "placed" ? sql`o.placed_at` : totalKey(context);
  return direction === "desc" ? sql`${column} asc, o.id asc` : sql`${column} desc, o.id desc`;
}

/**
 * The rows strictly after a cursor in the list's own order (the next page). An invalid cursor is no condition: the first page. `atOrBefore` is the other side: the rows at the
 * cursor or before it (the page before reads them, backwards).
 */
export function keysetAfter(sort: SortKey, after: string | null | undefined, context: Pick<OrderListContext, "totalFactors">, { atOrBefore = false }: { atOrBefore?: boolean } = {}): SQL | null {
  const cursor = decodeCursor(after, sort);
  if (!cursor) return null;
  const { field, direction } = SORTS[sort];
  const column = field === "placed" ? sql`o.placed_at` : totalKey(context);
  const key = field === "placed" ? sql`${cursor.key}::timestamptz` : sql`${cursor.key}::bigint`;
  const descending = direction === "desc";
  // Descending: what comes after is smaller and what came before is larger or equal; ascending, the other way round.
  if (atOrBefore) return descending ? sql`(${column}, o.id) >= (${key}, ${cursor.id}::uuid)` : sql`(${column}, o.id) <= (${key}, ${cursor.id}::uuid)`;
  return descending ? sql`(${column}, o.id) < (${key}, ${cursor.id}::uuid)` : sql`(${column}, o.id) > (${key}, ${cursor.id}::uuid)`;
}
