import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The AI manager's analyses of a store (D104): customers, products, the
 * trend, the way from cart to order, and what to reorder. Everything is
 * counted and worked out here, in code, from paid orders; the model only
 * repeats it. Amounts are written in the store's own format.
 */

type Ctx = { store: Store };

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const money = (store: Store, minor: number, currency: string) => formatMoney(minor, currency, mainLocale(store));
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10} %` : "–");
const day = (value: number | string | null) => (value === null ? null : new Date(value).toISOString().slice(0, 10));
/** The store's currencies, its first market's first. */
const byMainCurrency = (store: Store) => (a: string, b: string) =>
  (a === store.markets[0]?.currency ? -1 : 0) - (b === store.markets[0]?.currency ? -1 : 0) || a.localeCompare(b);

/** An order paid for: a captured payment, online or at the venue. */
const paid = sql`(o.copied_from is null and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured'))`;
/** Midnight in the store's time zone, `days` days back counting today. */
const since = (store: Store, days: number) =>
  sql`(date_trunc('day', now() at time zone ${store.timeZone}) - make_interval(days => ${days - 1})) at time zone ${store.timeZone}`;

function sums(store: Store, totals: Map<string, number>): string[] {
  return [...totals.keys()].sort(byMainCurrency(store)).map((currency) => money(store, totals.get(currency) ?? 0, currency));
}

// Customers ----------------------------------------------------------------------------------

type Buyer = {
  email: string;
  name: string | null;
  orders: number;
  first: number;
  last: number;
  dates: number[];
  spent: Map<string, number>;
};

export async function customerInsights({ store }: Ctx, { days }: OwnerToolInput<"customer_insights">) {
  const rows = await db().execute<Row>(sql`
    select lower(o.email) as email, nullif(o.billing_address ->> 'name', '') as name, o.currency, o.total_minor, o.placed_at
    from commerce.orders o
    where o.store_id = ${store.id}::uuid and o.email <> '' and o.status <> 'cancelled' and ${paid}
    order by o.placed_at
    limit 50000
  `);
  const now = Date.now();
  const start = now - days * 86_400_000;
  const buyers = new Map<string, Buyer>();
  const periodTotals = new Map<string, { sum: number; orders: number }>();
  for (const row of rows) {
    const email = String(row.email);
    const at = new Date(String(row.placed_at)).getTime();
    const currency = String(row.currency);
    const total = Number(row.total_minor);
    const buyer: Buyer = buyers.get(email) ?? { email, name: null, orders: 0, first: at, last: at, dates: [], spent: new Map() };
    buyer.orders += 1;
    buyer.last = Math.max(buyer.last, at);
    buyer.first = Math.min(buyer.first, at);
    buyer.dates.push(at);
    buyer.name = row.name ? String(row.name) : buyer.name;
    buyer.spent.set(currency, (buyer.spent.get(currency) ?? 0) + total);
    buyers.set(email, buyer);
    if (at >= start) {
      const t = periodTotals.get(currency) ?? { sum: 0, orders: 0 };
      periodTotals.set(currency, { sum: t.sum + total, orders: t.orders + 1 });
    }
  }
  const all = [...buyers.values()];
  const repeat = all.filter((b) => b.orders >= 2);
  const inPeriod = all.filter((b) => b.dates.some((d) => d >= start));
  const newOnes = inPeriod.filter((b) => b.first >= start);
  const gaps = repeat.flatMap((b) => b.dates.slice(1).map((d, i) => (d - b.dates[i]) / 86_400_000)).sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const DAY = 86_400_000;
  const loyal = all.filter((b) => b.orders >= 3 && now - b.last <= 90 * DAY);
  const atRisk = all.filter((b) => b.orders >= 2 && now - b.last > 90 * DAY && now - b.last <= 365 * DAY);
  const lapsed = all.filter((b) => now - b.last > 365 * DAY);
  const oneTimeRecent = all.filter((b) => b.orders === 1 && now - b.last <= 90 * DAY);
  const person = (b: Buyer) => ({
    name: b.name ?? "(no name)",
    email: b.email,
    orders: b.orders,
    spent: sums(store, b.spent),
    last_order: day(b.last),
  });
  const mainCurrency = store.markets[0]?.currency ?? "";
  const spentMain = (b: Buyer) => b.spent.get(mainCurrency) ?? 0;
  return {
    period: `the last ${days} days`,
    customers_ever: all.length,
    came_back: { customers: repeat.length, share: pct(repeat.length, all.length), note: "Customers with two or more paid orders." },
    in_period: { customers: inPeriod.length, new: newOnes.length, returning: inPeriod.length - newOnes.length },
    average_order_in_period: [...periodTotals.entries()]
      .sort(([a], [b]) => byMainCurrency(store)(a, b))
      .map(([currency, t]) => ({ currency, orders: t.orders, average: money(store, Math.round(t.sum / t.orders), currency) })),
    usual_days_between_orders: medianGap === null ? null : Math.round(medianGap),
    groups: {
      loyal: { customers: loyal.length, rule: "3+ orders, the last within 90 days" },
      at_risk: { customers: atRisk.length, rule: "2+ orders, none for 90 to 365 days" },
      lapsed: { customers: lapsed.length, rule: "no order for over a year" },
      new_one_order: { customers: oneTimeRecent.length, rule: "one order, within 90 days" },
    },
    best_customers: [...all].sort((a, b) => b.orders - a.orders || spentMain(b) - spentMain(a)).slice(0, 10).map(person),
    at_risk_customers: [...atRisk].sort((a, b) => spentMain(b) - spentMain(a)).slice(0, 15).map(person),
    note: all.length === 0 ? "No paid orders yet." : "Customers are counted by email, guests and accounts alike. Amounts include VAT and shipping.",
  };
}

// Products -----------------------------------------------------------------------------------

export async function productPerformance({ store }: Ctx, { days }: OwnerToolInput<"product_performance">) {
  const locale = mainLocale(store);
  const from = since(store, days);
  const rows = await db().execute<Row>(sql`
    with sold as (
      select v.product_id, o.currency, sum(l.quantity)::int as units, count(distinct o.id)::int as orders, sum(l.total_minor)::bigint as taken
      from commerce.order_lines l
      join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
      join commerce.product_variants v on v.id = l.variant_id
      where l.store_id = ${store.id}::uuid and o.placed_at >= ${from} and o.status <> 'cancelled' and ${paid}
      group by v.product_id, o.currency
    ),
    stock as (
      select v.product_id, sum(il.on_hand)::int as on_hand, bool_or(v.delivery = 'physical') as shipped
      from commerce.product_variants v left join commerce.inventory_levels il on il.variant_id = v.id
      where v.store_id = ${store.id}::uuid and v.active
      group by v.product_id
    ),
    wished as (
      select w.product_id, count(*)::int as n from commerce.wishlist_items w
      where w.store_id = ${store.id}::uuid and w.created_at >= ${from}
      group by w.product_id
    ),
    clicked as (
      select c.product_id, count(*)::int as n from commerce.search_clicks c
      where c.store_id = ${store.id}::uuid and c.created_at >= ${from}
      group by c.product_id
    )
    select p.id, p.status, coalesce(tl.title, p.handle) as title, sold.currency, sold.units, sold.orders, sold.taken,
      stock.on_hand, coalesce(stock.shipped, false) as shipped, coalesce(wished.n, 0) as wished, coalesce(clicked.n, 0) as clicked
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join sold on sold.product_id = p.id
    left join stock on stock.product_id = p.id
    left join wished on wished.product_id = p.id
    left join clicked on clicked.product_id = p.id
    where p.store_id = ${store.id}::uuid and (p.status = 'active' or sold.units is not null)
  `);
  type Item = { id: string; title: string; active: boolean; units: number; orders: number; taken: Map<string, number>; stock: number | null; wished: number; clicked: number };
  const items = new Map<string, Item>();
  for (const row of rows) {
    const id = String(row.id);
    const item = items.get(id) ?? {
      id,
      title: String(row.title),
      active: row.status === "active",
      units: 0,
      orders: 0,
      taken: new Map<string, number>(),
      stock: row.shipped ? Number(row.on_hand ?? 0) : null,
      wished: Number(row.wished),
      clicked: Number(row.clicked),
    };
    if (row.units !== null && row.units !== undefined) {
      item.units += Number(row.units);
      item.orders += Number(row.orders);
      const currency = String(row.currency);
      item.taken.set(currency, (item.taken.get(currency) ?? 0) + Number(row.taken));
    }
    items.set(id, item);
  }
  const list = [...items.values()];
  const show = (i: Item) => ({
    product: i.title,
    units: i.units,
    orders: i.orders,
    taken: sums(store, i.taken),
    wished_for: i.wished,
    opened_from_search: i.clicked,
    stock: i.stock ?? "not stocked (service or download)",
    admin: `/admin/${store.slug}/products/${i.id}`,
  });
  const selling = list.filter((i) => i.units > 0).sort((a, b) => b.units - a.units);
  const idle = list.filter((i) => i.active && i.units === 0 && (i.stock === null || i.stock > 0)).sort((a, b) => b.wished + b.clicked - (a.wished + a.clicked));
  return {
    period: `the last ${days} days, today included`,
    products_on_sale: list.filter((i) => i.active).length,
    products_sold: selling.length,
    best_sellers: selling.slice(0, 15).map(show),
    not_selling: { count: idle.length, products: idle.slice(0, 15).map(show) },
    note: store.visitCounting
      ? "Takings are the lines' totals with VAT, before shipping and refunds. Product views are counted (visit counting is on) but are not in this list; wishes and search opens show interest here."
      : "Takings are the lines' totals with VAT, before shipping and refunds. Product views are not tracked (visit counting is off); wishes and search opens show interest.",
  };
}

// The trend -------------------------------------------------------------------------------------

export async function salesTrend({ store }: Ctx, { period, count }: OwnerToolInput<"sales_trend">) {
  const unit = period;
  const rows = await db().execute<Row>(sql`
    select to_char(date_trunc(${unit}, o.placed_at at time zone ${store.timeZone}), 'YYYY-MM-DD') as bucket, o.currency,
      count(*)::int as orders, sum(o.total_minor)::bigint as taken
    from commerce.orders o
    where o.store_id = ${store.id}::uuid and o.status <> 'cancelled' and ${paid}
      and o.placed_at >= (date_trunc(${unit}, now() at time zone ${store.timeZone}) - ${sql.raw(`interval '${count - 1} ${unit}'`)}) at time zone ${store.timeZone}
    group by 1, 2
  `);
  const [starts] = await db().execute<Row>(sql`
    select array(
      select to_char(g, 'YYYY-MM-DD')
      from generate_series(
        date_trunc(${unit}, now() at time zone ${store.timeZone}) - ${sql.raw(`interval '${count - 1} ${unit}'`)},
        date_trunc(${unit}, now() at time zone ${store.timeZone}),
        ${sql.raw(`interval '1 ${unit}'`)}
      ) g
    ) as buckets
  `);
  const buckets = (starts.buckets as string[]) ?? [];
  const currencies = [...new Set(rows.map((r) => String(r.currency)))].sort(byMainCurrency(store));
  const main = currencies[0] ?? store.markets[0]?.currency ?? "";
  const of = (bucket: string, currency: string) => rows.find((r) => r.bucket === bucket && r.currency === currency);
  let before: number | null = null;
  const series = buckets.map((bucket, i) => {
    const takenMain = Number(of(bucket, main)?.taken ?? 0);
    const change = before === null ? null : before === 0 ? (takenMain === 0 ? "0 %" : "new") : `${Math.round(((takenMain - before) / before) * 1000) / 10} %`;
    before = takenMain;
    return {
      [period]: bucket,
      ...(i === buckets.length - 1 && { so_far: true }),
      orders: currencies.reduce((n, c) => n + Number(of(bucket, c)?.orders ?? 0), 0),
      taken: currencies.length ? currencies.map((c) => money(store, Number(of(bucket, c)?.taken ?? 0), c)) : [money(store, 0, main)],
      change_in_takings: change,
    };
  });
  return {
    per: period,
    series,
    note: `Paid orders by the ${period} they were placed, in ${store.timeZone}; the last ${period} is not over. The change compares takings in ${main} with the ${period} before.`,
  };
}

// From cart to order ------------------------------------------------------------------------------

export async function salesFunnel({ store }: Ctx, { days }: OwnerToolInput<"sales_funnel">) {
  const from = since(store, days);
  const [row] = await db().execute<Row>(sql`
    select
      (select count(*)::int from commerce.carts c where c.store_id = ${store.id}::uuid and c.created_at >= ${from}) as carts,
      (select count(*)::int from commerce.carts c where c.store_id = ${store.id}::uuid and c.created_at >= ${from}
        and (c.status = 'converted' or exists (select 1 from commerce.cart_lines l where l.cart_id = c.id))) as carts_filled,
      (select count(*)::int from commerce.abandoned_checkouts a where a.store_id = ${store.id}::uuid and a.captured_at >= ${from}) as left_at_checkout,
      (select count(*)::int from commerce.abandoned_checkouts a where a.store_id = ${store.id}::uuid and a.captured_at >= ${from} and a.recovered_at is not null) as won_back,
      (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.created_at >= ${from} and o.copied_from is null) as placed,
      (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.created_at >= ${from} and ${paid}) as paid,
      (select count(*)::int from commerce.search_queries q where q.store_id = ${store.id}::uuid and q.created_at >= ${from}) as searches,
      (select count(*)::int from commerce.search_queries q where q.store_id = ${store.id}::uuid and q.created_at >= ${from}
        and q.results = 0 and coalesce(q.meaning_results, 0) = 0) as found_nothing,
      (select count(*)::int from commerce.search_queries q where q.store_id = ${store.id}::uuid and q.created_at >= ${from}
        and exists (select 1 from commerce.search_clicks k where k.search_id = q.id)) as searches_opened
  `);
  const n = (key: string) => Number(row[key] ?? 0);
  return {
    period: `the last ${days} days, today included`,
    carts_started: n("carts"),
    carts_with_products: n("carts_filled"),
    orders_placed: n("placed"),
    orders_paid: n("paid"),
    from_filled_cart_to_paid: pct(n("paid"), n("carts_filled")),
    placed_but_not_paid: n("placed") - n("paid"),
    checkouts_left_with_an_email: n("left_at_checkout"),
    won_back_by_cart_reminders: n("won_back"),
    searches: n("searches"),
    searches_that_found_nothing: n("found_nothing"),
    searches_where_a_product_was_opened: pct(n("searches_opened"), n("searches")),
    note: store.visitCounting
      ? "This funnel starts at the cart. The store counts visits (visit counting is on), but not in this tool: use analytics_overview and the traffic figures for visits, conversion and the funnel from a visit. Shares are worked out in code."
      : "Visits and product views are not tracked (visit counting is off), so the funnel starts at the cart. Shares are worked out in code.",
  };
}

// Reordering ----------------------------------------------------------------------------------------

export async function restockSuggestions({ store }: Ctx, { days, cover_days, lead_days }: OwnerToolInput<"restock_suggestions">) {
  const locale = mainLocale(store);
  const from = since(store, days);
  const rows = await db().execute<Row>(sql`
    select v.id, v.sku, v.options, coalesce(tl.title, p.handle) as title, p.id as product_id,
      coalesce((select sum(il.on_hand) from commerce.inventory_levels il where il.variant_id = v.id), 0)::int as on_hand,
      coalesce((
        select sum(l.quantity) from commerce.order_lines l
        join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
        where l.variant_id = v.id and o.placed_at >= ${from} and o.status <> 'cancelled' and ${paid}
      ), 0)::int as sold
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active'
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    where v.store_id = ${store.id}::uuid and v.active and v.delivery = 'physical'
  `);
  const round1 = (x: number) => Math.round(x * 10) / 10;
  const variants = rows.map((row) => {
    const sold = Number(row.sold);
    const onHand = Number(row.on_hand);
    const perDay = sold / days;
    const need = Math.ceil(perDay * (cover_days + lead_days));
    return {
      product: String(row.title),
      sku: String(row.sku),
      options: row.options,
      in_stock: onHand,
      sold_in_period: sold,
      per_day: round1(perDay),
      lasts_days: perDay > 0 ? round1(onHand / perDay) : null,
      order_now: perDay > 0 && onHand / perDay <= lead_days,
      suggested_order: Math.max(0, need - onHand),
      admin: `/admin/${store.slug}/products/${String(row.product_id)}`,
    };
  });
  const toOrder = variants.filter((v) => v.suggested_order > 0).sort((a, b) => (a.lasts_days ?? 0) - (b.lasts_days ?? 0));
  return {
    rule: `The pace is the last ${days} days' paid sales. Suggested = sales per day × (${cover_days} days to cover + ${lead_days} days' delivery), less what is in stock, rounded up.`,
    to_reorder: toOrder.slice(0, 40),
    urgent: toOrder.filter((v) => v.order_now).length,
    out_of_stock_without_sales: variants.filter((v) => v.in_stock === 0 && v.sold_in_period === 0).length,
    well_stocked: variants.length - toOrder.length,
    note: toOrder.length === 0 ? "Nothing needs reordering at this pace." : "A suggestion from past sales only; seasons and campaigns change the pace.",
  };
}
