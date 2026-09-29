import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { summarizeUsage } from "@/lib/ai-usage";
import { formatMoney } from "@/lib/money";
import { OWNER_TOOLS_BY_NAME, readToolInput, type OwnerToolInput, type OwnerToolName } from "@/lib/owner-tools";
import { marketPath, storeHref } from "@/lib/paths";
import { parsePrice } from "@/lib/product-input";

import { audit, type Account } from "./auth";
import { cancelBooking, listBookings } from "./bookings";
import { cartReminderStats } from "./cart-reminders";
import { findCustomer, getCustomerDetail, listCustomers } from "./customer-admin";
import { listEmails } from "./email";
import { findClaims } from "@/lib/claims";

import { listIntegrations, postToSlack } from "./integrations";
import { ownedStores, usageRows } from "./ai-usage";
import { customerInsights, productPerformance, restockSuggestions, salesFunnel, salesTrend } from "./owner-insights";
import { getSetupProgress } from "./setup";
import { deliveryRounds } from "./standing-orders";
import { listSubscriptions } from "./subscriptions";
import { mostWishedProducts, wishlistFigures } from "./wishlist-admin";
import { catalogTag } from "./catalog";
import { listDiscounts, saveDiscount } from "./discounts";
import { addOrderNote, CARRIERS, getOrderAdmin, markSent, refundOrder } from "./order-admin";
import { listOrders } from "./orders";
import { listPages, pagesTag, unpublishPage } from "./pages";
import { listAdminProducts, setArchived } from "./products";
import { sendBookingCancelled, sendOrderConfirmation, sendRefunded, sendShipped, sendStoreMessage } from "./shopper-emails";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * What the owner assistant's tools do (D94): the store's own reads and
 * writes, for one store and its owner. Answers are small JSON the model
 * repeats: amounts are written out here in the store's own format, and
 * totals and averages worked out here, never by the model.
 */

export type OwnerToolContext = {
  account: Account;
  store: Store;
  /** Refreshes a cache tag: `updateTag` in a server action, `revalidateTag` in a route. */
  invalidate: (tag: string) => void;
};

export class OwnerToolError extends Error {}

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const money = (store: Store, minor: number, currency: string) => formatMoney(minor, currency, mainLocale(store));

/** An order by its number or id, the store's only. */
async function findOrderId(store: Store, ref: string): Promise<string> {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const [row] = await db().execute<Row>(sql`
    select id from commerce.orders
    where store_id = ${store.id}::uuid and ${byId ? sql`id = ${ref}::uuid` : sql`number = ${ref.replace(/^#/, "")}`}
  `);
  return row ? String(row.id) : fail(`No order ${ref} in this store.`);
}

/** A product by id, handle or title, the store's only; a title that fits several says so. */
async function findProductId(store: Store, ref: string): Promise<string> {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const rows = await db().execute<Row>(sql`
    select distinct p.id, p.handle from commerce.products p
    left join commerce.product_translations t on t.product_id = p.id
    where p.store_id = ${store.id}::uuid
      and ${byId ? sql`p.id = ${ref}::uuid` : sql`(p.handle = ${ref} or lower(t.title) = lower(${ref}))`}
    limit 3
  `);
  if (rows.length === 0) return fail(`No product "${ref}" in this store. Use list_products to find it.`);
  if (rows.length > 1) return fail(`Several products match "${ref}": ${rows.map((r) => r.handle).join(", ")}. Name one by its handle.`);
  return String(rows[0].id);
}

// Reading ----------------------------------------------------------------------

async function storeOverview({ store }: OwnerToolContext) {
  const [counts] = await db().execute<Row>(sql`
    select
      (select count(*)::int from commerce.products where store_id = ${store.id}::uuid and status = 'active') as active_products,
      (select count(*)::int from commerce.products where store_id = ${store.id}::uuid and status = 'draft') as draft_products,
      (select count(*)::int from commerce.orders where store_id = ${store.id}::uuid and status in ('paid', 'fulfilled', 'closed')) as orders,
      (select count(*)::int from commerce.orders where store_id = ${store.id}::uuid and status = 'paid') as orders_to_handle
  `);
  return {
    name: store.name,
    status: store.status,
    address: storeHref(store.slug, marketPath(store.slug, store.markets[0]?.slug ?? "")),
    payments: store.paymentsOn ? (store.paymentsTest ? "on, in test mode" : "on") : "off",
    sells_to: store.audience,
    bookings_module: store.bookingsOn,
    time_zone: store.timeZone,
    countries: store.markets.map((m) => ({ code: m.code, name: m.name, currency: m.currency, language: m.lang })),
    products: { active: Number(counts.active_products), drafts: Number(counts.draft_products) },
    orders: { taken: Number(counts.orders), paid_not_yet_sent: Number(counts.orders_to_handle) },
  };
}

async function salesSummary({ store }: OwnerToolContext, { days }: OwnerToolInput<"sales_summary">) {
  // The period starts at midnight in the store's time zone, `days` days back counting today.
  const since = sql`(date_trunc('day', now() at time zone ${store.timeZone}) - make_interval(days => ${days - 1})) at time zone ${store.timeZone}`;
  const paid = sql`exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured')`;
  const [totals, refunds, top] = await Promise.all([
    db().execute<Row>(sql`
      select o.currency, count(*)::int as orders, sum(o.total_minor)::bigint as total
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and o.placed_at >= ${since} and ${paid}
      group by o.currency order by total desc
    `),
    db().execute<Row>(sql`
      select o.currency, sum(r.amount_minor)::bigint as refunded
      from commerce.refunds r
      join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
      where r.store_id = ${store.id}::uuid and r.status = 'succeeded' and r.created_at >= ${since}
      group by o.currency
    `),
    db().execute<Row>(sql`
      select l.title, sum(l.quantity)::int as quantity
      from commerce.order_lines l join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
      where o.store_id = ${store.id}::uuid and o.placed_at >= ${since} and ${paid} and l.variant_id is not null
      group by l.title order by quantity desc, l.title limit 5
    `),
  ]);
  const refunded = new Map(refunds.map((r) => [String(r.currency), Number(r.refunded)]));
  return {
    period: days === 1 ? "today" : `the last ${days} days, today included`,
    per_currency: totals.map((t) => {
      const currency = String(t.currency);
      const orders = Number(t.orders);
      const total = Number(t.total);
      const back = refunded.get(currency) ?? 0;
      return {
        currency,
        paid_orders: orders,
        taken: money(store, total, currency),
        refunded: money(store, back, currency),
        after_refunds: money(store, total - back, currency),
        average_order: money(store, Math.round(total / orders), currency),
      };
    }),
    best_sellers: top.map((t) => ({ product: String(t.title), sold: Number(t.quantity) })),
    note: totals.length === 0 ? "No paid orders in this period." : "Totals include VAT and shipping, as charged.",
  };
}

async function listOrdersTool({ store }: OwnerToolContext, input: OwnerToolInput<"list_orders">) {
  const rows = await listOrders(store.id, { unpaid: input.which === "unpaid", toSend: input.which === "to_send" });
  const search = input.search?.toLowerCase();
  const found = search
    ? rows.filter((o) => [o.number, o.email, o.name ?? ""].some((v) => v.toLowerCase().includes(search.replace(/^#/, ""))))
    : rows;
  return {
    count: found.length,
    orders: found.slice(0, input.limit).map((o) => ({
      number: o.number,
      status: o.status,
      customer: o.name ?? o.email,
      email: o.email,
      placed: o.placedAt,
      total: money(store, o.totalMinor, o.currency),
      items: o.items,
    })),
  };
}

async function getOrderTool({ store }: OwnerToolContext, { order }: OwnerToolInput<"get_order">) {
  const view = await getOrderAdmin(store.id, await findOrderId(store, order));
  if (!view) return fail(`No order ${order} in this store.`);
  const m = (minor: number) => money(store, minor, view.currency);
  return {
    number: view.number,
    status: view.status,
    placed: view.placedAt,
    customer: { email: view.email, name: view.shippingAddress?.name ?? view.billingAddress?.name ?? null },
    country: view.marketCode,
    lines: view.lines.map((l) => ({
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      total: m(l.totalMinor),
      delivery: l.delivery,
      booking: l.booking ? { kind: l.booking.kind, starts: l.booking.startsAt, ends: l.booking.endsAt, status: l.booking.status, with: l.booking.staff } : null,
    })),
    subtotal: m(view.subtotalMinor),
    shipping: m(view.shippingMinor),
    discount: view.discountMinor ? { code: view.discountCode, off: m(view.discountMinor) } : null,
    vat: m(view.taxMinor),
    total: m(view.totalMinor),
    paid: m(view.paidMinor),
    refunded: m(view.refundedMinor),
    left_to_refund: m(view.refundableMinor),
    due_at_venue: view.balanceMinor ? m(view.balanceMinor) : null,
    shipments: view.shipments.map((s) => ({ carrier: s.carrier, tracking: s.trackingNumber, sent: s.createdAt })),
    admin: `/admin/${store.slug}/orders/${view.id}`,
  };
}

async function listProductsTool({ store }: OwnerToolContext, input: OwnerToolInput<"list_products">) {
  const rows = await listAdminProducts(store, { archived: input.status === "archived" });
  const search = input.search?.toLowerCase();
  const found = rows.filter(
    (p) => (!input.status || p.status === input.status) && (!search || p.title.toLowerCase().includes(search) || p.handle.includes(search)),
  );
  return {
    count: found.length,
    products: found.slice(0, input.limit).map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      price: p.price
        ? p.price.min === p.price.max
          ? money(store, p.price.min, p.price.currency)
          : `${money(store, p.price.min, p.price.currency)} – ${money(store, p.price.max, p.price.currency)}`
        : null,
      stock: p.variants > p.digitalVariants ? p.stock : null,
      variants: p.variants,
    })),
    prices: store.audience === "businesses" ? "Without VAT, as the store shows them." : "With VAT, in the main country.",
  };
}

async function getProductTool({ store }: OwnerToolContext, { product }: OwnerToolInput<"get_product">) {
  const id = await findProductId(store, product);
  const locale = mainLocale(store);
  const [[head], variants] = await Promise.all([
    db().execute<Row>(sql`
      select p.handle, p.status, p.kind, coalesce(tl.title, tf.title, p.handle) as title, coalesce(tl.description, tf.description, '') as description
      from commerce.products p
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
      left join lateral (select title, description from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
      where p.store_id = ${store.id}::uuid and p.id = ${id}::uuid
    `),
    db().execute<Row>(sql`
      select v.id, v.sku, v.options, v.delivery,
        (select coalesce(sum(l.on_hand), 0)::int from commerce.inventory_levels l where l.variant_id = v.id) as stock,
        coalesce((select jsonb_agg(jsonb_build_object('market', c.market_code, 'amount', c.amount_minor, 'currency', c.currency) order by c.market_code)
          from commerce.current_prices c where c.variant_id = v.id), '[]') as prices
      from commerce.product_variants v
      where v.store_id = ${store.id}::uuid and v.product_id = ${id}::uuid and v.active
      order by v.sku
    `),
  ]);
  return {
    id,
    title: String(head.title),
    handle: String(head.handle),
    status: String(head.status),
    kind: String(head.kind),
    description: String(head.description).slice(0, 1500),
    variants: variants.map((v) => ({
      sku: String(v.sku),
      options: v.options,
      delivery: String(v.delivery),
      stock: v.delivery === "physical" ? Number(v.stock) : null,
      prices: (v.prices as { market: string; amount: number; currency: string }[]).map((p) => ({
        country: p.market,
        price: money(store, Number(p.amount), p.currency),
      })),
    })),
    prices: "With VAT, as charged.",
    admin: `/admin/${store.slug}/products/${id}`,
  };
}

async function lowStock({ store }: OwnerToolContext, { at_most }: OwnerToolInput<"low_stock">) {
  const locale = mainLocale(store);
  const rows = await db().execute<Row>(sql`
    select v.sku, v.options, coalesce(tl.title, p.handle) as title, coalesce(sum(l.on_hand), 0)::int as stock
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active'
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join commerce.inventory_levels l on l.variant_id = v.id
    where v.store_id = ${store.id}::uuid and v.active and v.delivery = 'physical'
    group by v.id, v.sku, v.options, tl.title, p.handle
    having coalesce(sum(l.on_hand), 0) <= ${at_most}
    order by stock, title
    limit 50
  `);
  return { count: rows.length, variants: rows.map((r) => ({ product: String(r.title), sku: String(r.sku), options: r.options, stock: Number(r.stock) })) };
}

/** Midnight of a day in the store's time zone, as an instant. */
async function dayStart(store: Store, day: string | undefined): Promise<Date> {
  const [row] = await db().execute<Row>(sql`
    select (${day ? sql`${day}::date` : sql`(now() at time zone ${store.timeZone})::date`}::timestamp at time zone ${store.timeZone}) as at
  `);
  return new Date(String(row.at));
}

async function listBookingsTool({ store }: OwnerToolContext, input: OwnerToolInput<"list_bookings">) {
  if (!store.bookingsOn) return { note: "The bookings module is off in this store." };
  const from = await dayStart(store, input.from);
  const to = new Date(from.getTime() + input.days * 86_400_000);
  const [staff, ranges] = await Promise.all([listBookings(store.id, from, to, ["staff"]), listBookings(store.id, from, to, ["unit", "item"])]);
  const time = new Intl.DateTimeFormat(mainLocale(store), { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  return {
    time_zone: store.timeZone,
    bookings: [...staff, ...ranges]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 100)
      .map((b) => ({
        id: b.id,
        what: b.service,
        with: b.staff,
        starts: time.format(new Date(b.startsAt)),
        ends: time.format(new Date(b.endsAt)),
        status: b.status,
        customer: b.customer,
        order: b.orderNumber,
      })),
  };
}

async function listDiscountsTool({ store }: OwnerToolContext) {
  const rows = await listDiscounts(store.id);
  return {
    discounts: rows.map((d) => ({
      code: d.code,
      active: d.active,
      gives:
        d.kind === "percent"
          ? `${d.percent} % off`
          : Object.entries(d.amounts)
              .map(([market, minor]) => {
                const m = store.markets.find((x) => x.code === market);
                return m ? `${money(store, minor, m.currency)} off in ${m.name}` : null;
              })
              .filter(Boolean)
              .join(", "),
      runs: { from: d.startsAt, until: d.endsAt },
      used: d.used,
      limit: d.usageLimit,
    })),
  };
}

async function listPagesTool({ store }: OwnerToolContext, { type }: OwnerToolInput<"list_pages">) {
  const pages = await listPages(store.id, type);
  return {
    pages: pages.map((p) => ({ id: p.id, title: p.title, address: p.slug, state: p.state, published: p.publishedAt })),
  };
}

async function searchInsights({ store }: OwnerToolContext, input: OwnerToolInput<"search_insights">) {
  const since = sql`now() - make_interval(days => ${input.days})`;
  const [top, none] = await Promise.all([
    db().execute<Row>(sql`
      select lower(query) as query, count(*)::int as times from commerce.search_queries
      where store_id = ${store.id}::uuid and created_at >= ${since}
      group by lower(query) order by times desc, query limit ${input.limit}
    `),
    db().execute<Row>(sql`
      select lower(query) as query, count(*)::int as times from commerce.search_queries
      where store_id = ${store.id}::uuid and created_at >= ${since} and results = 0
      group by lower(query) order by times desc, query limit ${input.limit}
    `),
  ]);
  return {
    most_searched: top.map((r) => ({ search: String(r.query), times: Number(r.times) })),
    found_nothing: none.map((r) => ({ search: String(r.query), times: Number(r.times) })),
  };
}

// Changing ---------------------------------------------------------------------

async function addOrderNoteTool({ store, account }: OwnerToolContext, input: OwnerToolInput<"add_order_note">) {
  const id = await findOrderId(store, input.order);
  await addOrderNote(store.id, id, input.note, `${account.email} (assistant)`);
  return { done: `Note added to order ${input.order}.` };
}

async function markOrderSentTool({ store, account }: OwnerToolContext, input: OwnerToolInput<"mark_order_sent">) {
  const id = await findOrderId(store, input.order);
  const carrier = CARRIERS.find((c) => c.id === input.carrier.toLowerCase() || c.name.toLowerCase() === input.carrier.toLowerCase())?.id ?? "other";
  const shipment = await markSent(store.id, id, { carrier, trackingNumber: input.tracking_number, trackingUrl: null }, account.id);
  if (!shipment) return fail(`Order ${input.order} is not paid, so it cannot be sent.`);
  if (input.notify) await sendShipped(store.id, id, shipment);
  return { done: input.notify ? `Order ${input.order} is marked as sent and the customer has been told.` : `Order ${input.order} is marked as sent.` };
}

async function cancelBookingTool({ store, account }: OwnerToolContext, input: OwnerToolInput<"cancel_booking">) {
  if (!(await cancelBooking({ account, store, role: "owner" }, input.booking))) return fail("That booking is not a confirmed booking of this store.");
  if (input.notify) await sendBookingCancelled(store.id, input.booking);
  return { done: input.notify ? "The booking is cancelled and the customer has been told." : "The booking is cancelled." };
}

async function archiveProductTool(ctx: OwnerToolContext, input: OwnerToolInput<"archive_product">) {
  const id = await findProductId(ctx.store, input.product);
  if (!(await setArchived(ctx.store, id, input.archived))) return fail("That product is not this store's.");
  ctx.invalidate(catalogTag(ctx.store.id));
  return { done: input.archived ? `${input.product} is taken off the site.` : `${input.product} is back, as a draft to publish from the product page.` };
}

async function unpublishPageTool(ctx: OwnerToolContext, input: OwnerToolInput<"unpublish_page">) {
  if (!(await unpublishPage(ctx.account, ctx.store.id, input.page, input.type))) return fail("That page is not one of this store's published pages.");
  ctx.invalidate(pagesTag(ctx.store.id));
  return { done: "The page is taken off the site; its draft is kept." };
}

type Handler = (ctx: OwnerToolContext, input: never) => Promise<unknown>;

// The AI manager's store tools (D103) -----------------------------------------------

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;

async function setupProgressTool({ store }: OwnerToolContext) {
  const p = await getSetupProgress(store);
  const step = (done: boolean, what: string, page: string) => ({ what, done, page: adminLink(store, page) });
  return {
    ready_to_open: p.readyToOpen,
    status: store.status,
    steps: [
      step(p.details, "Business details", "/settings/company"),
      step(p.countries, "Countries to sell to", "/setup/countries"),
      step(p.shipping, "Shipping price for every country", "/settings/shipping"),
      step(p.payments, "Stripe account set up", "/settings/payments"),
      step(p.paymentsOn, "Payments switched on", "/settings/payments"),
      step(p.products, "Own products (not only the demo ones)", "/products"),
      step(p.plan, "A Kaizen plan", "/billing"),
    ],
    products: { own: p.counts.ownProducts, demo: p.counts.demoProducts },
  };
}

async function storeCheckup(ctx: OwnerToolContext) {
  const { store } = ctx;
  const [[counts], [low], progress, integrations, restock] = await Promise.all([
    db().execute<Row>(sql`
      select
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.status = 'paid'
           and o.placed_at < now() - interval '2 days'
           and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')) as late_orders,
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.status = 'paid'
           and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')) as to_send,
        (select count(distinct lower(q.query))::int from commerce.search_queries q
           where q.store_id = ${store.id}::uuid and q.results = 0 and q.created_at > now() - interval '7 days') as searches_missed,
        (select count(*)::int from commerce.assistant_approvals a
           where a.store_id = ${store.id}::uuid and a.account_id = ${ctx.account.id}::uuid and a.status = 'pending') as approvals,
        (select count(*)::int from commerce.products p where p.store_id = ${store.id}::uuid and p.status = 'draft') as drafts
    `),
    db().execute<Row>(sql`
      select count(*)::int as n from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id}::uuid and p.status = 'active' and v.active and v.delivery = 'physical' and p.kind = 'goods'
        and coalesce((select sum(l.on_hand) from commerce.inventory_levels l where l.variant_id = v.id), 0) <= 3
    `),
    getSetupProgress(store),
    listIntegrations(store.id),
    restockSuggestions({ store }, { days: 30, cover_days: 30, lead_days: 7 }),
  ]);
  const findings: { what: string; page: string }[] = [];
  const add = (when: boolean, what: string, page: string) => when && findings.push({ what, page: adminLink(store, page) });
  add(!progress.readyToOpen, "The store is not ready to open yet: setup_progress says what is left.", "");
  add(Number(counts.late_orders) > 0, `${counts.late_orders} paid order(s) have waited more than two days to be sent.`, "/orders?show=to-send");
  add(Number(counts.to_send) > 0 && Number(counts.late_orders) === 0, `${counts.to_send} paid order(s) are waiting to be sent.`, "/orders?show=to-send");
  add(Number(low.n) > 0, `${low.n} variant(s) have 3 or fewer left in stock.`, "/products");
  add(restock.urgent > 0, `${restock.urgent} variant(s) will run out within a week at the current pace: restock_suggestions says how many to order.`, "/products");
  add(Number(counts.searches_missed) > 0, `${counts.searches_missed} different search(es) found nothing this week.`, "/search");
  add(Number(counts.approvals) > 0, `${counts.approvals} change(s) you asked me for are waiting for your approval.`, "/assistant");
  add(Number(counts.drafts) > 0, `${counts.drafts} product(s) are drafts, not on the site.`, "/products");
  add(store.paymentsTest && store.paymentsOn, "Payments are in test mode: shoppers cannot really pay yet.", "/settings/payments");
  for (const i of integrations) add(i.enabled && i.recentFailures > 0, `${i.provider} failed ${i.recentFailures} send(s) this week.`, `/integrations/${i.provider}`);
  return { findings, all_good: findings.length === 0 };
}

async function listCustomersTool({ store }: OwnerToolContext, { search, limit }: OwnerToolInput<"list_customers">) {
  const rows = await listCustomers(store.id, { q: search ?? "", limit });
  return rows.map((c) => ({
    key: c.key,
    name: c.name,
    email: c.email,
    account: c.account ?? "none",
    orders: c.orders,
    live_subscriptions: c.liveSubscriptions,
    spent: Object.entries(c.spentMinor).map(([currency, minor]) => money(store, minor, currency)),
    last_order: c.lastOrderAt,
    admin: adminLink(store, `/customers/${encodeURIComponent(c.key)}`),
  }));
}

async function getCustomerTool({ store }: OwnerToolContext, { customer }: OwnerToolInput<"get_customer">) {
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customer);
  let ref = isId ? await findCustomer(store.id, customer) : null;
  if (!ref && !isId) {
    const [match] = await listCustomers(store.id, { q: customer, limit: 1 });
    ref = match ? await findCustomer(store.id, match.key) : null;
  }
  const detail = ref ? await getCustomerDetail(store.id, ref) : null;
  if (!ref || !detail) return fail(`No customer "${customer}" in this store. Use list_customers to find them.`);
  return {
    name: detail.name,
    email: ref.email,
    phone: detail.phone,
    account_since: detail.accountCreatedAt,
    first_order: detail.firstOrderAt,
    orders: detail.orderList.slice(0, 20).map((o) => ({ number: o.number, status: o.status, placed: o.placedAt, total: money(store, o.totalMinor, o.currency) })),
    subscriptions: detail.subscriptionList.map((s) => ({ number: s.number, status: s.status, each_renewal: money(store, s.totalMinor, s.currency) })),
    wishlist_items: detail.wishlistItems,
    cart_reminders_off: detail.cartRemindersOptedOut,
    admin: adminLink(store, `/customers/${encodeURIComponent(ref.key)}`),
  };
}

async function listSubscriptionsTool({ store }: OwnerToolContext, { limit }: OwnerToolInput<"list_subscriptions">) {
  const rows = await listSubscriptions(store.id);
  return rows.slice(0, limit).map((s) => ({
    number: s.number,
    status: s.status,
    customer: s.name || s.email,
    each_renewal: money(store, s.totalMinor, s.currency),
    every: `${s.intervalCount} ${s.interval}`,
    renews: s.currentPeriodEnd,
    ending: s.cancelAtPeriodEnd || Boolean(s.cancelAt),
    admin: adminLink(store, `/subscriptions/${s.id}`),
  }));
}

async function cartReminderStatsTool({ store }: OwnerToolContext) {
  const stats = await cartReminderStats(store.id);
  return {
    period: "the last 30 days",
    checkouts_left_with_email: stats.captured,
    reminded: stats.reminded,
    bought_after_reminder: stats.recovered,
    won_back: Object.entries(stats.recoveredMinor).map(([currency, minor]) => money(store, minor, currency)),
    page: adminLink(store, "/cart-reminders"),
  };
}

async function wishlistInsights({ store }: OwnerToolContext) {
  const [figures, wished] = await Promise.all([wishlistFigures(store.id), mostWishedProducts(store.id, mainLocale(store), 5)]);
  return {
    lists: figures.lists,
    items_saved: figures.savedItems,
    shoppers: figures.shoppers,
    put_in_cart: figures.toCart,
    bought: figures.bought,
    bought_for: Object.entries(figures.boughtMinor).map(([currency, minor]) => money(store, minor, currency)),
    most_wished: wished.map((w) => ({ product: w.title, lists: w.lists })),
    page: adminLink(store, "/wishlists"),
  };
}

async function listEmailsTool({ store }: OwnerToolContext, { limit }: OwnerToolInput<"list_emails">) {
  const rows = await listEmails({ storeId: store.id, limit });
  return rows.map((e) => ({ what: e.kind, to: e.to, subject: e.subject, status: e.status, error: e.error, sent: e.createdAt, admin: adminLink(store, `/emails/${e.id}`) }));
}

async function subscriptionBoxes({ store }: OwnerToolContext) {
  if (!store.deliveriesOn) return { on: false, note: "Subscription boxes are off: they are switched on under Features.", page: adminLink(store, "/settings/features") };
  const rounds = await deliveryRounds(store.id);
  return {
    on: true,
    delivery_days: rounds.map((r) => ({
      name: r.schedule.name,
      country: r.schedule.marketCode,
      active: r.schedule.active,
      lists: r.schedule.lists,
      next_delivery: r.next.date,
      next_cutoff: new Date(r.next.cutoffAt).toISOString(),
      being_packed: r.current
        ? {
            delivery: r.current.date,
            orders: r.current.orders.map((o) => ({ number: o.number, customer: o.name, total: money(store, o.totalMinor, r.schedule.currency), status: o.status })),
            without_delivery: r.current.skipped,
          }
        : null,
    })),
    page: adminLink(store, "/deliveries"),
  };
}

async function refundOrderTool(ctx: OwnerToolContext, { order, amount, reason, restock, notify }: OwnerToolInput<"refund_order">) {
  const { store } = ctx;
  const orderId = await findOrderId(store, order);
  const admin = await getOrderAdmin(store.id, orderId);
  if (!admin) return fail(`No order ${order} in this store.`);
  if (!admin.canRefund || admin.refundableMinor <= 0) return fail(`Order ${admin.number} has nothing left to refund through Stripe.`);
  const amountMinor = amount ? parsePrice(amount, admin.currency) : admin.refundableMinor;
  if (amountMinor === null || amountMinor <= 0) return fail(`"${amount}" is not an amount.`);
  if (amountMinor > admin.refundableMinor) return fail(`At most ${money(store, admin.refundableMinor, admin.currency)} can be refunded on order ${admin.number}.`);
  const back = restock
    ? admin.lines.filter((l) => l.variantId && l.delivery === "physical" && l.quantity > l.restocked).map((l) => ({ lineId: l.id, quantity: l.quantity - l.restocked }))
    : [];
  const outcome = await refundOrder(store.id, orderId, { amountMinor, reason, restock: back }, ctx.account.id);
  if (!outcome.ok) return fail(outcome.problem);
  if (notify && outcome.amountMinor > 0) await sendRefunded(store.id, orderId, outcome.refundId, outcome.amountMinor);
  ctx.invalidate(catalogTag(store.id));
  return { done: `Refunded ${money(store, outcome.amountMinor, admin.currency)} on order ${admin.number}${back.length ? ", and put its items back in stock" : ""}.` };
}

async function createDiscountTool(ctx: OwnerToolContext, input: OwnerToolInput<"create_discount">) {
  const result = await saveDiscount({ account: ctx.account, store: ctx.store, role: "owner" }, null, {
    code: input.code,
    kind: input.kind,
    percent: input.percent,
    endsAt: input.ends_at ? `${input.ends_at}T23:59` : null,
    usageLimit: input.usage_limit ?? null,
    oncePerCustomer: input.once_per_customer,
    active: true,
  });
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `The code ${input.code.toUpperCase()} works now.`, admin: result.id ? adminLink(ctx.store, `/discounts/${result.id}`) : adminLink(ctx.store, "/discounts") };
}

async function setDiscountActiveTool(ctx: OwnerToolContext, { code, active }: OwnerToolInput<"set_discount_active">) {
  const rows = await db().execute<Row>(sql`
    update commerce.discount_codes set active = ${active}, updated_at = now()
    where store_id = ${ctx.store.id}::uuid and upper(code) = upper(${code}) returning code
  `);
  if (rows.length === 0) return fail(`No code ${code} in this store. Use list_discounts to find it.`);
  return { done: `The code ${String(rows[0].code)} is ${active ? "on" : "off"}.` };
}

// Reaching customers, the team and the stock (D104) -------------------------------------------

async function listIntegrationsTool({ store }: OwnerToolContext) {
  const connected = await listIntegrations(store.id);
  return {
    connected: connected.map((i) => ({
      service: i.provider,
      on: i.enabled,
      events: i.events,
      last_sent: i.lastDelivery ? { status: i.lastDelivery.status, at: i.lastDelivery.at } : null,
      failed_this_week: i.recentFailures,
      admin: adminLink(store, `/integrations/${i.provider}`),
    })),
    available: ["zapier", "make", "slack"].filter((p) => !connected.some((i) => i.provider === p)),
    note: "Zapier and Make pass the store's events on to other tools, such as newsletters or spreadsheets; Slack posts them to a channel. Connect them under Integrations.",
    admin: adminLink(store, "/integrations"),
  };
}

/** Words the claims filter (D76) finds in AI-written text for customers, which must be rewritten first. */
function claimsIn(...texts: string[]): string[] {
  return [...new Set(texts.flatMap((text) => findClaims(text).map((c) => c.phrase)))];
}

async function emailCustomerTool({ store }: OwnerToolContext, { to, subject, message }: OwnerToolInput<"email_customer">) {
  const claims = claimsIn(subject, message);
  if (claims.length) return fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  // Only the store's own customers: someone who ordered, or has an account here.
  const [found] = isEmail
    ? await db().execute<Row>(sql`
        select email, id as order_id, market_code, locale from (
          select o.email, o.id, o.market_code, o.locale, o.created_at from commerce.orders o
          where o.store_id = ${store.id}::uuid and lower(o.email) = lower(${to})
          union all
          select c.email, null::uuid, null, c.locale, c.created_at from commerce.customers c
          where c.store_id = ${store.id}::uuid and lower(c.email) = lower(${to})
        ) found order by (id is null), created_at desc limit 1
      `)
    : await db().execute<Row>(sql`
        select o.email, o.id as order_id, o.market_code, o.locale from commerce.orders o
        where o.store_id = ${store.id}::uuid and o.id = ${await findOrderId(store, to)}::uuid and o.email <> ''
      `);
  if (!found) return fail(`${to} is not a customer of this store. Use list_customers or get_order.`);
  const outcome = await sendStoreMessage(store.id, {
    to: String(found.email),
    subject,
    text: message,
    // Linked to the order when written about one; a message to an email alone links none.
    orderId: isEmail ? null : String(found.order_id),
    marketCode: found.market_code ? String(found.market_code) : null,
    locale: found.locale ? String(found.locale) : null,
  });
  if (outcome === "failed" || outcome === null) return fail("The email could not be sent. Try again later.");
  return { done: outcome === "logged" ? `Written to ${String(found.email)} (email is not set up here, so it was only logged).` : `Emailed ${String(found.email)}.` };
}

async function resendOrderEmailTool({ store }: OwnerToolContext, { order, which }: OwnerToolInput<"resend_order_email">) {
  const orderId = await findOrderId(store, order);
  if (which === "confirmation") {
    const outcome = await sendOrderConfirmation(store.id, orderId, { resend: true });
    if (!outcome || outcome === "failed") return fail("The confirmation could not be sent: the order has no email, or is not paid.");
    return { done: `The order confirmation for ${order} went to the customer again.` };
  }
  const [shipment] = await db().execute<Row>(sql`
    select id, carrier, tracking_number, tracking_url from commerce.shipments
    where store_id = ${store.id}::uuid and order_id = ${orderId}::uuid order by created_at desc limit 1
  `);
  if (!shipment) return fail(`Order ${order} has not been sent yet.`);
  const outcome = await sendShipped(
    store.id,
    orderId,
    {
      id: String(shipment.id),
      carrier: String(shipment.carrier),
      trackingNumber: String(shipment.tracking_number),
      trackingUrl: shipment.tracking_url ? String(shipment.tracking_url) : null,
    },
    { resend: true },
  );
  if (!outcome || outcome === "failed") return fail("The shipping notice could not be sent.");
  return { done: `The shipping notice for ${order} went to the customer again.` };
}

async function setStockTool(ctx: OwnerToolContext, { sku, quantity }: OwnerToolInput<"set_stock">) {
  const { store } = ctx;
  const variants = await db().execute<Row>(sql`
    select v.id, v.product_id, (select count(*)::int from commerce.inventory_levels l where l.variant_id = v.id) as places
    from commerce.product_variants v
    where v.store_id = ${store.id}::uuid and v.active and v.delivery = 'physical' and lower(v.sku) = lower(${sku})
  `);
  if (variants.length === 0) return fail(`No shipped variant with the SKU ${sku}. Use get_product for SKUs.`);
  if (variants.length > 1) return fail(`More than one variant has the SKU ${sku}: set it on the product page.`);
  const variant = variants[0];
  if (Number(variant.places) > 1) return fail(`${sku} is kept in more than one place: set it on the product page.`);
  await db().transaction(async (tx) => {
    const [place] = await tx.execute<Row>(sql`
      select coalesce(
        (select location_id from commerce.inventory_levels where variant_id = ${String(variant.id)}::uuid limit 1),
        (select id from commerce.inventory_locations where store_id = ${store.id}::uuid and active order by created_at limit 1)
      ) as location_id
    `);
    if (!place?.location_id) return fail("The store has no stock location yet: save the product once on its page.");
    await tx.execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      values (${store.id}::uuid, ${String(variant.id)}::uuid, ${String(place.location_id)}::uuid, ${quantity})
      on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
    `);
  });
  ctx.invalidate(catalogTag(store.id));
  return { done: `${sku} now has ${quantity} in stock.`, admin: adminLink(store, `/products/${String(variant.product_id)}`) };
}

async function postToSlackTool({ store }: OwnerToolContext, { message }: OwnerToolInput<"post_to_slack">) {
  const outcome = await postToSlack(store.id, message);
  if (!outcome.ok) return fail(`Slack did not take it: ${outcome.error ?? "no answer"}.`);
  return { done: "Posted to the store's Slack channel." };
}

async function aiUsageTool({ account, store }: OwnerToolContext, { days, scope }: OwnerToolInput<"ai_usage">) {
  const all = scope === "all_my_stores";
  if (all && (await ownedStores(account.id)).length === 0) return fail("The account owns no store.");
  const rows = await usageRows({ days, ...(all ? { ownedBy: account.id } : { storeId: store.id, ownedBy: account.id }) });
  return { period: `the last ${days} days, today included`, covers: all ? "every store the owner owns" : store.name, ...summarizeUsage(rows), admin: "/admin/account/usage" };
}

const HANDLERS: Record<OwnerToolName, Handler> = {
  store_overview: storeOverview,
  sales_summary: salesSummary,
  list_orders: listOrdersTool,
  get_order: getOrderTool,
  list_products: listProductsTool,
  get_product: getProductTool,
  low_stock: lowStock,
  list_bookings: listBookingsTool,
  list_discounts: listDiscountsTool,
  list_pages: listPagesTool,
  search_insights: searchInsights,
  add_order_note: addOrderNoteTool,
  mark_order_sent: markOrderSentTool,
  cancel_booking: cancelBookingTool,
  archive_product: archiveProductTool,
  unpublish_page: unpublishPageTool,
  setup_progress: setupProgressTool,
  store_checkup: storeCheckup,
  list_customers: listCustomersTool,
  get_customer: getCustomerTool,
  list_subscriptions: listSubscriptionsTool,
  cart_reminder_stats: cartReminderStatsTool,
  wishlist_insights: wishlistInsights,
  list_emails: listEmailsTool,
  subscription_boxes: subscriptionBoxes,
  refund_order: refundOrderTool,
  create_discount: createDiscountTool,
  set_discount_active: setDiscountActiveTool,
  customer_insights: customerInsights,
  product_performance: productPerformance,
  sales_trend: salesTrend,
  sales_funnel: salesFunnel,
  restock_suggestions: restockSuggestions,
  list_integrations: listIntegrationsTool,
  email_customer: emailCustomerTool,
  resend_order_email: resendOrderEmailTool,
  set_stock: setStockTool,
  ai_usage: aiUsageTool,
  post_to_slack: postToSlackTool,
};

/**
 * Runs a tool for the store's owner, its arguments checked first. Gated
 * tools run here only once approved (`runApproved` in the assistant);
 * changes are written to the store's audit log.
 */
export async function runOwnerTool(ctx: OwnerToolContext, name: string, raw: unknown): Promise<unknown> {
  const tool = OWNER_TOOLS_BY_NAME[name];
  if (!tool) return fail(`There is no tool called ${name}.`);
  const input = readToolInput(tool, raw);
  if (!input.ok) return fail(`The arguments could not be read: ${input.problem}`);
  const result = await HANDLERS[name as OwnerToolName](ctx, input.input as never);
  if (tool.gate || name === "add_order_note") {
    await audit(ctx.account.id, ctx.store.id, `store.assistant.${name}`, { args: input.input as Record<string, unknown> });
  }
  return result;
}
