import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { EmailBlock } from "@/lib/email-layout";
import type { EmailText } from "@/lib/email-text";
import { marketPath, storeSiteUrl } from "@/lib/paths";

type Row = Record<string, unknown>;

/**
 * The way to the withdrawal function from an order's emails and pages (D153). Kept apart from `return-emails.ts` so the
 * order emails (`shopper-emails.ts`) can use it without the two importing each other.
 */

/**
 * The address of the withdrawal function for an order: `…/withdraw?order={number}&key={the order page's key}`. The key (the
 * payment's reference, as the order page uses it) is what proves the order is the visitor's, the number alone never is.
 * Without a payment there is no key and the link carries the number only, to prefill the form.
 */
export async function withdrawUrl(
  storeId: string,
  store: { slug: string },
  market: { slug: string },
  order: { id: string; number: string },
): Promise<string> {
  const base = `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, "/withdraw")}`;
  const [payment] = await db().execute<Row>(sql`
    select provider_reference from commerce.payments
    where store_id = ${storeId}::uuid and order_id = ${order.id}::uuid and provider in ('stripe', 'venue', 'manual')
    order by created_at limit 1
  `);
  const query = new URLSearchParams({ order: order.number });
  if (payment) query.set("key", String(payment.provider_reference));
  return `${base}?${query.toString()}`;
}

/** The lines a consumer order email carries: the right to withdraw, and where to use it. Empty for what has no right. */
export async function withdrawBlocks(
  storeId: string,
  store: { slug: string },
  market: { slug: string },
  order: { id: string; number: string; ships: boolean; company: unknown },
  text: EmailText,
): Promise<EmailBlock[]> {
  // Goods for a consumer: a company has no statutory right, and downloads and bookings have their own rules.
  if (!order.ships || order.company) return [];
  const url = await withdrawUrl(storeId, store, market, order);
  // Who pays for sending the goods back, as the store's setting stood when the order was placed (CRD Art. 6(1)(i), 14(1)): the
  // shopper is told in writing, and the store can charge the cost only to a shopper who was told.
  const [rule] = await db().execute<Row>(sql`select return_cost_payer from commerce.orders where store_id = ${storeId}::uuid and id = ${order.id}::uuid`);
  const cost = rule?.return_cost_payer === "shopper" ? text.returns.costShopper : rule?.return_cost_payer === "store" ? text.returns.costStore : null;
  return [
    { type: "paragraph", text: cost ? `${text.returns.withdrawLine} ${cost}` : text.returns.withdrawLine },
    { type: "button", text: text.returns.withdrawButton, url },
  ];
}
