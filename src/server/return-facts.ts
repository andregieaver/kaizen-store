import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  orderEligibility,
  withdrawalWindow,
  type LineEligibility,
  type ReturnSettings,
  type WithdrawalLine,
  type WithdrawalOrder,
  type WithdrawalWindow,
} from "@/lib/withdrawal";

import { getReturnSettings } from "./return-settings";

type Row = Record<string, unknown>;

/**
 * What the withdrawal and returns rules need to know about one order (D153): the order as `withdrawalWindow()` and
 * `lineEligibility()` read it, its lines with what is already taken from them, the store's settings and time zone. One
 * place reads it, so the shopper's function, the queue and the refund all judge the same facts.
 */

export type FactLine = WithdrawalLine & {
  title: string;
  sku: string;
  variantId: string | null;
  unitPriceMinor: number;
  totalMinor: number;
  gift: boolean;
};

export type OrderFacts = {
  orderId: string;
  number: string;
  email: string;
  /** The email of the order's customer account, when it has one. */
  customerEmail: string | null;
  customerId: string | null;
  marketCode: string;
  locale: string;
  currency: string;
  status: string;
  totalMinor: number;
  shippingMinor: number;
  /** The carrier's service the shopper chose (D135), as kept on the order; null for the market's flat rate. */
  chosenDelivery: boolean;
  /**
   * Who pays for sending a withdrawn item back, as the store's setting stood when the order was placed
   * (`orders.return_cost_payer`): the consumer was told of it before buying, so a later change of the setting changes
   * nothing here. An order with no record counts as the store paying (the consumer cannot be charged for a cost they
   * were not told of, CRD Art. 14(1)).
   */
  whoPaysReturn: "shopper" | "store";
  /** The cheapest standard delivery at the time of the order, in its currency (`orders.standard_shipping_minor`); null when not worked out. */
  standardShippingMinor: number | null;
  order: WithdrawalOrder;
  lines: FactLine[];
  settings: ReturnSettings;
  timeZone: string;
  storeName: string;
  contactEmail: string | null;
};

/** The order with its lines, settings and zone; null when it is not the store's. */
export async function loadFacts(storeId: string, orderId: string): Promise<OrderFacts | null> {
  const [order] = await db().execute<Row>(sql`
    select o.id, o.number, o.email, o.customer_id, o.market_code, o.locale, o.currency, o.status, o.total_minor, o.shipping_minor,
      o.delivery is not null as chosen_delivery, o.delivered_at, o.company_name, o.subscription_id, o.digital_consent_at,
      o.return_cost_payer, o.standard_shipping_minor,
      (select c.email from commerce.customers c where c.store_id = o.store_id and c.id = o.customer_id) as customer_email,
      o.copied_from is not null as copied, s.time_zone, s.name as store_name, s.contact_email,
      (select max(sh.created_at) from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id) as last_shipped_at
    from commerce.orders o join commerce.stores s on s.id = o.store_id
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
  `);
  if (!order) return null;
  const [lines, settings] = await Promise.all([
    db().execute<Row>(sql`
      select ol.id, ol.title, ol.sku, ol.variant_id, ol.quantity, ol.unit_price_minor, ol.total_minor, ol.delivery,
        ol.withdrawal_exclusion, ol.gift, commerce.returned_quantity(ol.id) as taken
      from commerce.order_lines ol
      where ol.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid
      order by ol.title, ol.id
    `),
    getReturnSettings(storeId),
  ]);
  return {
    orderId: String(order.id),
    number: String(order.number),
    email: String(order.email ?? ""),
    customerEmail: order.customer_email ? String(order.customer_email) : null,
    customerId: order.customer_id ? String(order.customer_id) : null,
    marketCode: String(order.market_code),
    locale: String(order.locale),
    currency: String(order.currency).trim(),
    status: String(order.status),
    totalMinor: Number(order.total_minor),
    shippingMinor: Number(order.shipping_minor ?? 0),
    chosenDelivery: Boolean(order.chosen_delivery),
    whoPaysReturn: order.return_cost_payer === "shopper" ? "shopper" : "store",
    standardShippingMinor: order.standard_shipping_minor === null || order.standard_shipping_minor === undefined ? null : Number(order.standard_shipping_minor),
    order: {
      status: String(order.status),
      copied: Boolean(order.copied),
      business: Boolean(order.company_name && String(order.company_name).trim()),
      deliveredAt: order.delivered_at ? new Date(String(order.delivered_at)) : null,
      lastShippedAt: order.last_shipped_at ? new Date(String(order.last_shipped_at)) : null,
      subscription: Boolean(order.subscription_id),
      digitalConsent: Boolean(order.digital_consent_at),
    },
    lines: lines.map((line) => ({
      id: String(line.id),
      title: String(line.title),
      sku: String(line.sku),
      variantId: line.variant_id ? String(line.variant_id) : null,
      quantity: Number(line.quantity),
      unitPriceMinor: Number(line.unit_price_minor),
      totalMinor: Number(line.total_minor),
      delivery: String(line.delivery),
      withdrawalExclusion: String(line.withdrawal_exclusion),
      takenQuantity: Number(line.taken),
      gift: Boolean(line.gift),
    })),
    settings,
    timeZone: String(order.time_zone ?? "Europe/Oslo"),
    storeName: String(order.store_name),
    contactEmail: order.contact_email ? String(order.contact_email) : null,
  };
}

/** What can be done with each line of the order at `now`, and where the order stands in time. */
export function judge(facts: OrderFacts, now: Date): { lines: LineEligibility[]; window: WithdrawalWindow } {
  return {
    lines: orderEligibility(facts.lines, facts.order, facts.settings, facts.timeZone, now),
    window: withdrawalWindow(facts.order, facts.settings, facts.timeZone, now),
  };
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** Writes to the order's history (`order_events`) from inside a transaction. */
export async function writeEvent(tx: Tx | ReturnType<typeof db>, storeId: string, orderId: string, type: string, data: Record<string, unknown>, actor: string) {
  await tx.execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb, ${actor})
  `);
}

/**
 * Where a withdrawal's emails go: the order's own address and its customer's, never an address the shopper typed into the
 * form (CRD Art. 11a(4) asks for the acknowledgement on a durable medium for the consumer who made the contract; anyone
 * holding an order page's key could otherwise make the store write to a stranger). The first is the main recipient.
 */
export function recipientsOf(facts: Pick<OrderFacts, "email" | "customerEmail">): string[] {
  return [...new Set([facts.email, facts.customerEmail ?? ""].map((address) => address.trim().toLowerCase()).filter(Boolean))];
}
