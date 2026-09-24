import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText, type EmailText } from "@/lib/email-text";
import { t } from "@/lib/i18n";
import { toMarket, type Market, type MarketRow } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";

import { sendEmail, type SendOutcome } from "./email";
import { getOrder, type OrderView } from "./orders";
import type { Store } from "./stores";
import { getSubscriptionForOrder } from "./subscriptions";

type Row = Record<string, unknown>;

/**
 * The emails shoppers get from a store (D26): what they bought, when it
 * is sent, refunds and their subscription. Each is built in the order's
 * language and kept in `email_messages`, sent or not.
 */

/** What an email needs of its store, read fresh (webhooks and jobs run outside the page cache). */
export type EmailStore = Pick<Store, "id" | "slug" | "name" | "details" | "markets">;

async function storeById(storeId: string): Promise<EmailStore | null> {
  const [row] = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.legal_name, s.organisation_number, s.contact_email, s.postal_address, s.country,
      coalesce(json_agg(json_build_object('code', m.code, 'currency', m.currency, 'defaultLocale', m.default_locale)
        order by (m.code = s.country) desc nulls last, m.created_at) filter (where m.code is not null), '[]') as markets
    from commerce.stores s
    left join commerce.markets m on m.store_id = s.id
    where s.id = ${storeId}::uuid
    group by s.id
  `);
  if (!row) return null;
  const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    details: {
      legalName: text(row.legal_name),
      organisationNumber: text(row.organisation_number),
      contactEmail: text(row.contact_email),
      postalAddress: text(row.postal_address),
      country: text(row.country),
    },
    markets: (row.markets as MarketRow[]).map(toMarket),
  };
}

/** The store, the order's market and its language, for one order's emails. */
async function context(storeId: string, marketCode: string, locale: string) {
  const store = await storeById(storeId);
  if (!store) return null;
  const market: Market | undefined = store.markets.find((m) => m.code === marketCode) ?? store.markets[0];
  if (!market) return null;
  const lang = locale.split("-")[0] || market.lang;
  return { store, market, lang, text: emailText(lang), m: t(lang) };
}

/** The store's name and legal details, at the foot of every email. */
function footer(store: EmailStore, text: EmailText): string[] {
  const d = store.details;
  return [
    [d.legalName ?? store.name, d.organisationNumber && `Org.nr. ${d.organisationNumber}`].filter(Boolean).join(" · "),
    d.postalAddress?.replace(/\n/g, ", ") ?? "",
    d.contactEmail ? text.questions(d.contactEmail) : "",
  ].filter(Boolean);
}

/** The shopper's own link to the order page (it needs the payment's reference). */
async function orderUrl(storeId: string, store: EmailStore, market: Market, orderId: string): Promise<string | null> {
  const [payment] = await db().execute<Row>(sql`
    select provider_reference from commerce.payments
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'stripe'
    order by created_at limit 1
  `);
  if (!payment) return null;
  return `${siteUrl()}${marketPath(store.slug, market.slug, `/order/${orderId}`)}?session_id=${encodeURIComponent(String(payment.provider_reference))}`;
}

function orderLines(order: OrderView, text: EmailText, money: (minor: number) => string): EmailBlock {
  return {
    type: "lines",
    rows: [
      ...order.lines.map((line) => ({ label: `${line.quantity} × ${line.title}`, value: money(line.totalMinor) })),
      { label: text.subtotal, value: money(order.subtotalMinor), muted: true },
      ...(order.ships ? [{ label: text.shipping, value: money(order.shippingMinor), muted: true }] : []),
      { label: text.total, value: money(order.totalMinor), strong: true },
      { label: text.vat, value: money(order.taxMinor), muted: true },
    ],
  };
}

function addressText(order: OrderView): string | null {
  const a = order.shippingAddress;
  if (!order.ships || !a.line1) return null;
  return [a.name, a.line1, a.line2, `${a.postalCode ?? ""} ${a.city ?? ""}`.trim()].filter(Boolean).join("\n");
}

/** The confirmation for a paid order: a new one, or a subscription's renewal. Once per order. */
export async function sendOrderConfirmation(
  storeId: string,
  orderId: string,
  { resend = false }: { resend?: boolean } = {},
): Promise<SendOutcome | null> {
  const order = await getOrder(storeId, orderId);
  if (!order || !order.email || order.status === "pending_payment" || order.status === "cancelled") return null;
  const ctx = await context(storeId, order.marketCode, order.locale);
  if (!ctx) return null;
  const { store, market, text, m } = ctx;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const subscription = order.subscriptionId ? await getSubscriptionForOrder(storeId, orderId) : null;
  const renewal = subscription !== null && subscription.number !== order.number;
  const url = await orderUrl(storeId, store, market, orderId);
  const address = addressText(order);
  const digital = order.lines.some((line) => line.delivery === "digital");

  const blocks: EmailBlock[] = [
    { type: "heading", text: text.orderHeading },
    { type: "paragraph", text: renewal ? text.renewalIntro(order.number) : text.orderIntro(order.number) },
    orderLines(order, text, money),
    ...(address ? [{ type: "paragraph" as const, text: `${text.deliverTo}:\n${address}` }] : []),
    ...(digital ? [{ type: "paragraph" as const, text: text.downloadsReady }] : []),
    ...(url ? [{ type: "button" as const, text: text.seeOrder, url }] : []),
    ...(subscription
      ? [
          { type: "divider" as const },
          {
            type: "paragraph" as const,
            text: text.subscription(m.planEvery(subscription.interval, subscription.intervalCount), money(subscription.totalMinor)),
          },
          {
            type: "button" as const,
            text: text.manageSubscription,
            url: `${siteUrl()}${marketPath(store.slug, market.slug, `/subscription/${subscription.manageToken}`)}`,
          },
        ]
      : []),
  ];
  const email = renderEmail({
    subject: renewal ? text.renewalSubject(store.name, order.number) : text.orderSubject(store.name, order.number),
    preview: renewal ? text.renewalIntro(order.number) : text.orderIntro(order.number),
    blocks,
    footer: footer(store, text),
    lang: ctx.lang,
  });
  return sendEmail({
    storeId,
    kind: renewal ? "subscription.renewed" : "order.confirmation",
    to: order.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    // Staff can send it again; the automatic one goes once.
    idempotencyKey: resend ? undefined : `order-confirmation:${orderId}`,
    orderId,
    subscriptionId: subscription?.id ?? null,
  });
}

/** A short email about an order: sent, refunded or cancelled (D27). */
async function orderNotice(
  storeId: string,
  orderId: string,
  kind: string,
  key: string,
  build: (args: {
    order: OrderView;
    text: EmailText;
    money: (minor: number) => string;
    store: EmailStore;
  }) => { subject: string; heading: string; intro: string; extra?: EmailBlock[] },
): Promise<SendOutcome | null> {
  const order = await getOrder(storeId, orderId);
  if (!order?.email) return null;
  const ctx = await context(storeId, order.marketCode, order.locale);
  if (!ctx) return null;
  const { store, market, text } = ctx;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const built = build({ order, text, money, store });
  const url = await orderUrl(storeId, store, market, orderId);
  const email = renderEmail({
    subject: built.subject,
    preview: built.intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: built.heading },
      { type: "paragraph", text: built.intro },
      ...(built.extra ?? []),
      ...(url ? [{ type: "button" as const, text: text.seeOrder, url }] : []),
    ],
  });
  return sendEmail({
    storeId,
    kind,
    to: order.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: key,
    orderId,
  });
}

export function sendShipped(
  storeId: string,
  orderId: string,
  shipment: { id: string; carrier: string; trackingNumber: string; trackingUrl: string | null },
) {
  return orderNotice(storeId, orderId, "order.sent", `order-sent:${shipment.id}`, ({ order, text, store }) => {
    const address = addressText(order);
    return {
      subject: text.shippedSubject(store.name, order.number),
      heading: text.shippedHeading,
      intro: text.shippedIntro(order.number),
      extra: [
        ...(shipment.trackingNumber ? [{ type: "paragraph" as const, text: text.tracking(shipment.carrier, shipment.trackingNumber) }] : []),
        ...(shipment.trackingUrl ? [{ type: "button" as const, text: text.trackParcel, url: shipment.trackingUrl }] : []),
        ...(address ? [{ type: "paragraph" as const, text: `${text.deliverTo}:\n${address}` }] : []),
      ],
    };
  });
}

export function sendRefunded(storeId: string, orderId: string, refundId: string, amountMinor: number) {
  return orderNotice(storeId, orderId, "order.refunded", `order-refunded:${refundId}`, ({ order, text, money, store }) => ({
    subject: text.refundSubject(store.name, order.number),
    heading: text.refundHeading,
    intro: text.refundIntro(money(amountMinor), order.number),
  }));
}

export function sendCancelled(storeId: string, orderId: string, amountMinor: number) {
  return orderNotice(storeId, orderId, "order.cancelled", `order-cancelled:${orderId}`, ({ order, text, money, store }) => ({
    subject: text.cancelledSubject(store.name, order.number),
    heading: text.cancelledHeading,
    intro: text.cancelledIntro(order.number, money(amountMinor)),
  }));
}

/** A six-digit sign-in code for My account (D28). */
export async function sendSignInCode(
  storeId: string,
  marketCode: string,
  locale: string,
  to: string,
  code: string,
): Promise<SendOutcome | null> {
  const ctx = await context(storeId, marketCode, locale);
  if (!ctx) return null;
  const { store, text } = ctx;
  const email = renderEmail({
    subject: text.codeSubject(store.name),
    preview: `${code} · ${text.codeIntro}`,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: text.codeHeading },
      { type: "paragraph", text: text.codeIntro },
      { type: "code", text: code },
      { type: "paragraph", text: text.codeIgnore },
    ],
  });
  return sendEmail({ storeId, kind: "account.code", to, email, fromName: store.name, replyTo: store.details.contactEmail });
}

export { context as emailContext, footer as emailFooter, orderUrl, orderLines as orderLinesBlock, storeById };
