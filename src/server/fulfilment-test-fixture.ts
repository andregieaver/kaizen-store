import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket, type Market } from "@/lib/markets";

import { completeOrderPayment, placeOrder } from "./checkout";

type Row = Record<string, unknown>;

/**
 * What the integration tests of sending in parts and changing orders share (wave 3, run 3, D174): a store made the way sign-up makes one (the demo catalogue,
 * its test Stripe account, NOK and EUR offered, plenty of stock), and `paidOrder()`, an order placed by the checkout's own `placeOrder()` and paid through
 * `complete_order_payment()` (so it has its `order.paid` event, its stock drawn and, when invoicing is on, its invoice). A test file that uses this mocks
 * `server-only`, `next/cache`, `next/headers` and `./stripe` itself. Never imported by the app.
 */

export const NO: Market = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
/** Norway seen in euros (D109): the store's NOK prices converted at 11.5 NOK to the euro. */
export const NO_EUR: Market = showMarket(
  { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  {
    currency: "EUR",
    conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [NO]), "NOK", "EUR")!,
  },
);

export type FxStore = { storeId: string; slug: string; accountId: string; stripeAccount: string };

/** A store as sign-up makes it, with a test Stripe account that can take payments, NOK and EUR, a contact address and 500 more of everything. */
export async function fxStore(label: string, options: { invoicing?: boolean; /** Stripe live mode: only live payments get invoices (D159). */ live?: boolean } = {}): Promise<FxStore> {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const slug = `${label}-${run}`.slice(0, 40);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'Fx') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Fx', null) as id`);
  const storeId = String(store.id);
  const stripeAccount = `acct_${run}`;
  const mode = options.live ? "live" : "test";
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, ${mode}, ${stripeAccount}, 'active', false)`);
  await db().execute(sql`
    insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values (${storeId}::uuid, 'stripe', true, ${mode}::commerce.payment_mode)
    on conflict (store_id, provider) do update set enabled = true, active_mode = ${mode}::commerce.payment_mode
  `);
  await db().execute(sql`update commerce.stores set contact_email = ${`butikk-${slug}@example.com`} where id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
    on conflict do nothing
  `);
  if (options.invoicing === true) {
    // The seller's details and VAT registration: the order's invoice (D159) is issued when it is paid.
    await db().execute(sql`
      update commerce.stores set legal_name = 'Fixture AS', organisation_number = '923456789', postal_address = 'Storgata 1\n0155 Oslo', country = 'NO' where id = ${storeId}::uuid
    `);
    await db().execute(sql`
      insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${storeId}::uuid, true, 'NO923456789MVA')
      on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456789MVA'
    `);
  }
  if (options.invoicing === false) {
    await db().execute(sql`insert into commerce.invoice_settings (store_id, enabled) values (${storeId}::uuid, false) on conflict (store_id) do update set enabled = false`);
  }
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' order by created_at limit 1`);
  return { storeId, slug, accountId: String(owner.account_id), stripeAccount };
}

export type FxOrder = {
  orderId: string;
  number: string;
  email: string;
  totalMinor: number;
  currency: string;
  lines: { id: string; sku: string; quantity: number; totalMinor: number; taxMinor: number; delivery: string }[];
};

let seq = 0;

/**
 * An order as the checkout leaves it: placed from a cart of the given SKUs in the market's view (`market` NO or NO_EUR), paid through Stripe (a captured
 * payment with the session's reference) or outside Kaizen (`manual`), and completed by `complete_order_payment()`.
 */
export async function paidOrder(
  store: FxStore,
  items: [string, number][],
  options: { market?: Market; manual?: boolean; email?: string; /** Runs on the placed order before it is paid (what is frozen after payment, such as a gift). */ beforePaid?: (orderId: string) => Promise<void> } = {},
): Promise<FxOrder> {
  const market = options.market ?? NO;
  const email = options.email ?? `buyer-${++seq}-${store.slug}@example.com`;
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${store.storeId}::uuid, 'NO', ${market.currency}, 'nb-NO', now() + interval '1 day') returning id
  `);
  for (const [sku, quantity] of items) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${store.storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${sku}
    `);
  }
  const placed = await placeOrder({ storeId: store.storeId, market }, String(cart.id), {}, { customerId: null });
  if (!placed.ok) throw new Error(placed.problem);
  const { orderId } = placed.order;
  if (options.beforePaid) await options.beforePaid(orderId);
  const [o] = await db().execute<Row>(sql`select total_minor, currency from commerce.orders where id = ${orderId}::uuid`);
  const reference = options.manual ? `manual_${orderId}` : `cs_${orderId}`;
  if (options.manual) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor, method, recorded_by)
      values (${store.storeId}::uuid, ${orderId}::uuid, 'manual', ${reference}, ${Number(o.total_minor)}, ${String(o.currency).trim()}, 'captured', 0, 'bank_transfer', ${store.accountId}::uuid)
    `);
  } else {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${store.storeId}::uuid, ${orderId}::uuid, 'stripe', ${reference}, ${store.stripeAccount}, ${Number(o.total_minor)}, ${String(o.currency).trim()}, 'captured')
    `);
  }
  await completeOrderPayment(orderId, reference);
  await db().execute(sql`update commerce.orders set email = ${email} where id = ${orderId}::uuid`);
  return readOrder(store, orderId, email);
}

export async function readOrder(store: FxStore, orderId: string, email = ""): Promise<FxOrder> {
  const [order] = await db().execute<Row>(sql`select number, total_minor, trim(currency) as currency, email from commerce.orders where store_id = ${store.storeId}::uuid and id = ${orderId}::uuid`);
  const lines = await db().execute<Row>(sql`select id, sku, quantity, total_minor, tax_minor, delivery from commerce.order_lines where store_id = ${store.storeId}::uuid and order_id = ${orderId}::uuid order by sku, id`);
  return {
    orderId,
    number: String(order.number),
    email: email || String(order.email ?? ""),
    totalMinor: Number(order.total_minor),
    currency: String(order.currency),
    lines: lines.map((l) => ({ id: String(l.id), sku: String(l.sku), quantity: Number(l.quantity), totalMinor: Number(l.total_minor), taxMinor: Number(l.tax_minor), delivery: String(l.delivery) })),
  };
}

export const lineOf = (order: FxOrder, sku: string) => {
  const line = order.lines.find((l) => l.sku === sku);
  if (!line) throw new Error(`no line ${sku}`);
  return line;
};

/** The variant id of a SKU in the store. */
export async function variantOf(store: FxStore, sku: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${sku}`);
  return String(row.id);
}

/** Units on hand of a SKU over the store's locations. */
export async function onHand(store: FxStore, sku: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(l.on_hand), 0)::int as n from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id
    where l.store_id = ${store.storeId}::uuid and v.sku = ${sku}
  `);
  return Number(row.n);
}

/** The emails kept for an order, oldest first. */
export async function mailsOf(orderId: string, kind?: string): Promise<Row[]> {
  const rows = await db().execute<Row>(sql`select kind, to_address, subject, text, idempotency_key from commerce.email_messages where order_id = ${orderId}::uuid order by created_at, id`);
  return rows.filter((m) => !kind || m.kind === kind);
}

export async function eventsOf(orderId: string, type?: string): Promise<Row[]> {
  const rows = await db().execute<Row>(sql`select type, data, actor from commerce.order_events where order_id = ${orderId}::uuid order by id`);
  return rows.filter((e) => !type || e.type === type);
}
