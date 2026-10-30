import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { EmailBlock } from "@/lib/email-layout";
import type { EmailText } from "@/lib/email-text";
import { t } from "@/lib/i18n";
import { marketUrl } from "@/lib/paths";
import { withdrawalInformation } from "@/lib/withdrawal-email";

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
  const base = `${marketUrl(store.slug, market.slug, "/withdraw")}`;
  const [payment] = await db().execute<Row>(sql`
    select provider_reference from commerce.payments
    where store_id = ${storeId}::uuid and order_id = ${order.id}::uuid and provider in ('stripe', 'mollie', 'venue', 'manual', 'terms', 'gift_card')
    order by (provider = 'gift_card'), created_at limit 1
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

/**
 * The order confirmation's withdrawal information in the email itself (D407 step 4, `withdrawalInformation()`): the right, how to use it,
 * what follows, the model form, and the words of a consent the customer gave at checkout, then the way to the withdrawal function. A
 * company's order carries none (no statutory right); an order with nothing that keeps the right carries only the consents it confirms.
 */
export async function withdrawalInfoBlocks(
  storeId: string,
  store: { slug: string; name: string; details: { legalName: string | null; postalAddress: string | null; contactEmail: string | null } },
  market: { slug: string },
  order: { id: string; number: string; company: unknown },
  text: EmailText,
): Promise<EmailBlock[]> {
  if (order.company) return [];
  const [facts] = await db().execute<Row>(sql`
    select o.locale, o.return_cost_payer, o.digital_consent_at is not null as digital, o.service_request_at is not null as service,
      exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical'
              and l.withdrawal_exclusion in ('none', 'sealed_hygiene', 'sealed_media')) as goods,
      exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'service'
              and l.withdrawal_exclusion = 'none') as services
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${order.id}::uuid
  `);
  if (!facts) return [];
  const locale = String(facts.locale);
  const words = t(locale.split("-")[0]);
  const blocks = withdrawalInformation({
    locale,
    seller: { name: store.details.legalName?.trim() || store.name, address: store.details.postalAddress?.trim() || null, email: store.details.contactEmail?.trim() || null },
    goods: Boolean(facts.goods),
    whoPays: facts.return_cost_payer === "shopper" || facts.return_cost_payer === "store" ? facts.return_cost_payer : null,
    services: Boolean(facts.services),
    consents: [...(facts.digital ? [words.digitalConsent] : []), ...(facts.service ? [words.serviceRequest] : [])],
  });
  if (blocks.length === 0) return [];
  const withRight = Boolean(facts.goods) || Boolean(facts.services);
  return withRight ? [...blocks, { type: "button", text: text.returns.withdrawButton, url: await withdrawUrl(storeId, store, market, order) }] : blocks;
}
