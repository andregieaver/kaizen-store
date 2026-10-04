// Test support for the integration tests of invoices and credit notes (D159): a store with the seller's details, a tax profile and a live Stripe
// account (a test-mode account never gets an invoice), orders placed by `placeOrder()` as a shopper's cart makes them and paid the way a payment
// leaves them, in the country's own currency or in euro. Not imported by the app.
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket, type Market } from "@/lib/markets";

import type { Account, Membership } from "./auth";
import { completeOrderPayment, placeOrder } from "./checkout";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

export const run = Date.now().toString(36);
let counter = 0;
export const unique = (prefix: string) => `${prefix}-${run}-${++counter}`;

export const no: Market = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
/** Norway shown in euro (D109): 1 EUR = 11.5 NOK, as the store's currencies say. */
export const noInEuro: Market = showMarket(
  { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  { currency: "EUR", conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")! },
);

export type Fixture = { storeId: string; slug: string; account: string; ownerId: string; ownerEmail: string };

export type FixtureOptions = {
  /** The Stripe account's mode: `live` (default) gets invoices, `test` never does. */
  mode?: "live" | "test";
  /** false: the seller's details are not given (the invoice waits). */
  sellerDetails?: boolean;
  /** `null`: no tax profile row. */
  registered?: boolean | null;
  vatNumber?: string;
  /** The store keeps rates for NOK and EUR (11.5), as the euro scenarios need. */
  rates?: boolean;
  /** Switch invoicing off (a row with `enabled = false`). */
  invoicing?: boolean;
};

/** A store made the way a real one is (an approved access request), ready to invoice. */
export async function makeStore(label: string, o: FixtureOptions = {}): Promise<Fixture> {
  const slug = unique(label);
  const ownerEmail = `${slug}@example.com`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${ownerEmail}, 'Kari', ${label}) returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${label}, null) as id`);
  const storeId = String(store.id);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${ownerEmail}`);
  const account = `acct_${slug.replace(/[^a-z0-9]/gi, "")}`;
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, ${o.mode ?? "live"}, ${account}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = ${o.mode ?? "live"} where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.stores set contact_email = ${`butikk-${slug}@example.com`} where id = ${storeId}::uuid`);
  if (o.sellerDetails !== false) {
    await db().execute(sql`
      update commerce.stores set legal_name = 'Fixture AS', organisation_number = '923456789', postal_address = 'Storgata 1\n0155 Oslo', country = 'NO' where id = ${storeId}::uuid
    `);
  }
  if (o.registered !== null) {
    const registered = o.registered ?? true;
    await db().execute(sql`
      insert into commerce.store_tax_profile (store_id, vat_registered, vat_number)
      values (${storeId}::uuid, ${registered}, ${registered ? (o.vatNumber ?? "NO923456789MVA") : null})
    `);
  }
  if (o.rates !== false) {
    await db().execute(sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
      values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
      on conflict do nothing
    `);
  }
  if (o.invoicing === false) await db().execute(sql`insert into commerce.invoice_settings (store_id, enabled) values (${storeId}::uuid, false)`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  return { storeId, slug, account, ownerId: String(owner.id), ownerEmail };
}

/** The store's owner as the server functions take a membership. */
export async function ownerOf(fx: Fixture, role: "owner" | "admin" = "owner"): Promise<Membership> {
  const acc: Account = { id: fx.ownerId, email: fx.ownerEmail, name: "Kari", platformAdmin: false };
  return { account: acc, store: (await getStore(fx.slug))!, role };
}

export type Placed = {
  orderId: string;
  number: string;
  email: string;
  currency: string;
  total: number;
  tax: number;
  shipping: number;
  lines: { id: string; sku: string; quantity: number; total: number }[];
  sessionId: string;
};

export type PayOptions = {
  market?: Market;
  email?: string;
  /** `false`: placed and a payment row made, but not paid. */
  pay?: boolean;
  provider?: "stripe" | "venue";
  code?: string;
  company?: { name: string; number: string };
  billing?: Record<string, unknown>;
  shipTo?: Record<string, unknown>;
  customerId?: string | null;
  /** The shopper's consents at checkout: a download needs `digital` (the waiver of the right to withdraw). */
  consent?: { digital?: boolean };
};

/** An order placed from a cart of these SKUs and paid, as Checkout's session leaves it (the payment is still pending when `complete_order_payment()` runs). */
export async function paidOrder(fx: Fixture, items: [sku: string, quantity: number][], o: PayOptions = {}): Promise<Placed> {
  const market = o.market ?? no;
  const email = o.email ?? `shopper-${unique("s")}@example.com`;
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, discount_code, company_name, organisation_number)
    values (${fx.storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day', ${o.code ?? null}, ${o.company?.name ?? null}, ${o.company?.number ?? null})
    returning id
  `);
  for (const [sku, quantity] of items) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${fx.storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = ${sku}
    `);
  }
  const result = await placeOrder({ storeId: fx.storeId, market }, String(cart.id), o.consent ?? {}, { customerId: o.customerId ?? null });
  if (!result.ok) throw new Error(`placeOrder: ${result.problem}`);
  const { orderId, totalMinor } = result.order;
  const provider = o.provider ?? "stripe";
  const sessionId = provider === "venue" ? `venue_${randomUUID()}` : `cs_${randomUUID().replace(/-/g, "")}`;
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${fx.storeId}::uuid, ${orderId}::uuid, ${provider}, ${sessionId}, ${provider === "stripe" ? fx.account : null}, ${totalMinor}, ${market.currency}, 'pending')
  `);
  await db().execute(sql`
    update commerce.orders set email = ${email},
      billing_address = ${JSON.stringify(o.billing ?? { name: "Kari Nordmann", line1: "Kirkeveien 5", postalCode: "0368", city: "Oslo", country: "NO" })}::jsonb,
      shipping_address = ${JSON.stringify(o.shipTo ?? { name: "Kari Nordmann", line1: "Kirkeveien 5", postalCode: "0368", city: "Oslo", country: "NO" })}::jsonb
    where id = ${orderId}::uuid
  `);
  if (o.pay !== false) {
    await completeOrderPayment(orderId, sessionId);
    await db().execute(sql`update commerce.payments set status = 'captured' where store_id = ${fx.storeId}::uuid and provider_reference = ${sessionId}`);
  }
  const [order] = await db().execute<Row>(sql`select number, currency, total_minor, tax_minor, shipping_minor from commerce.orders where id = ${orderId}::uuid`);
  const lines = await db().execute<Row>(sql`select id, sku, quantity, total_minor from commerce.order_lines where order_id = ${orderId}::uuid order by sku`);
  return {
    orderId,
    number: String(order.number),
    email,
    currency: String(order.currency).trim(),
    total: Number(order.total_minor),
    tax: Number(order.tax_minor),
    shipping: Number(order.shipping_minor),
    lines: lines.map((l) => ({ id: String(l.id), sku: String(l.sku), quantity: Number(l.quantity), total: Number(l.total_minor) })),
    sessionId,
  };
}

/** Pays an order that was placed with `pay: false`, as Checkout's session leaves it. */
export async function payPlaced(fx: Fixture, placed: Placed): Promise<void> {
  await completeOrderPayment(placed.orderId, placed.sessionId);
  await db().execute(sql`update commerce.payments set status = 'captured' where store_id = ${fx.storeId}::uuid and provider_reference = ${placed.sessionId}`);
}

export type InvoiceRow = {
  id: string;
  documentNumber: string;
  number: number;
  issuedOn: string;
  supplyDate: string;
  totalMinor: number;
  netMinor: number;
  taxMinor: number;
  currency: string;
  vatKind: string;
  vatHomeMinor: number | null;
  vatHomeCurrency: string | null;
  fxRate: number | null;
  token: string | null;
  pdfPath: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a snapshot is JSON and the tests read it as such
  snapshot: any;
};

const toInvoice = (r: Row): InvoiceRow => ({
  id: String(r.id),
  documentNumber: String(r.document_number),
  number: Number(r.number),
  issuedOn: String(r.issued_on).slice(0, 10),
  supplyDate: String(r.supply_date).slice(0, 10),
  totalMinor: Number(r.total_minor),
  netMinor: Number(r.net_minor),
  taxMinor: Number(r.tax_minor),
  currency: String(r.currency).trim(),
  vatKind: String(r.vat_kind),
  vatHomeMinor: r.vat_home_minor === null ? null : Number(r.vat_home_minor),
  vatHomeCurrency: r.vat_home_currency ? String(r.vat_home_currency).trim() : null,
  fxRate: r.fx_rate === null ? null : Number(r.fx_rate),
  token: r.public_token ? String(r.public_token) : null,
  pdfPath: r.pdf_path ? String(r.pdf_path) : null,
  snapshot: r.snapshot,
});

export async function invoiceOf(storeId: string, orderId: string): Promise<InvoiceRow | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.invoices where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid`);
  return row ? toInvoice(row) : null;
}

export type NoteRow = InvoiceRow & { invoiceId: string; refundId: string | null; returnId: string | null; source: string };

export async function notesOf(storeId: string, orderId: string): Promise<NoteRow[]> {
  const rows = await db().execute<Row>(sql`
    select c.*, i.vat_kind from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
    where c.store_id = ${storeId}::uuid and i.order_id = ${orderId}::uuid order by c.number
  `);
  return rows.map((r) => ({ ...toInvoice({ ...r, supply_date: r.issued_on }), invoiceId: String(r.invoice_id), refundId: r.refund_id ? String(r.refund_id) : null, returnId: r.return_id ? String(r.return_id) : null, source: String(r.source) }));
}

/** The VAT of an order's lines and shipping per rate, as the order was charged (what the invoice's buckets must add up to). */
export async function orderVatByRate(orderId: string): Promise<Map<string, number>> {
  const lines = await db().execute<Row>(sql`select tax_rate, sum(tax_minor)::bigint as vat from commerce.order_lines where order_id = ${orderId}::uuid group by tax_rate`);
  const [order] = await db().execute<Row>(sql`select tax_minor, shipping_tax_rate, vat_kind from commerce.orders where id = ${orderId}::uuid`);
  const map = new Map<string, number>();
  let linesVat = 0;
  for (const l of lines) {
    map.set(Number(l.tax_rate).toFixed(4), Number(l.vat));
    linesVat += Number(l.vat);
  }
  const shippingVat = Number(order.tax_minor) - linesVat;
  if (shippingVat !== 0) {
    const key = Number(order.shipping_tax_rate ?? 0.25).toFixed(4);
    map.set(key, (map.get(key) ?? 0) + shippingVat);
  }
  return map;
}

export async function refundRowsOf(storeId: string, orderId: string): Promise<{ id: string; amount: number; status: string; reference: string | null }[]> {
  const rows = await db().execute<Row>(sql`
    select r.id, r.amount_minor, r.status, r.provider_reference from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
    where r.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid order by r.created_at, r.id
  `);
  return rows.map((r) => ({ id: String(r.id), amount: Number(r.amount_minor), status: String(r.status), reference: r.provider_reference ? String(r.provider_reference) : null }));
}
