import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText, type EmailText } from "@/lib/email-text";
import { t, type Messages } from "@/lib/i18n";
import { toMarket, type Market, type MarketRow } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { absoluteUrl } from "@/lib/seo";

import { sendEmail, type SendOutcome } from "./email";
import { getOrder, type OrderView } from "./orders";
import type { Store } from "./stores";
import { getSubscriptionForOrder, type SubscriptionChange, type SubscriptionView } from "./subscriptions";

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
  return `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, `/order/${orderId}`)}?session_id=${encodeURIComponent(String(payment.provider_reference))}`;
}

function orderLines(
  order: OrderView,
  text: EmailText,
  m: Messages,
  money: (minor: number) => string,
  /** The store's own address, for its pictures' full addresses. */
  origin: string,
): EmailBlock {
  return {
    type: "lines",
    rows: [
      ...order.lines.map((line) => ({
        label: `${line.quantity} × ${line.title}`,
        value: money(line.unitPriceMinor * line.quantity),
        image: line.image ? absoluteUrl(line.image, origin) : null,
      })),
      { label: text.subtotal, value: money(order.subtotalMinor), muted: true },
      ...(order.ships ? [{ label: text.shipping, value: money(order.shippingMinor), muted: true }] : []),
      ...(order.discountMinor > 0
        ? [
            {
              label: order.discountCode ? `${text.discount} (${order.discountCode})` : text.discount,
              value: `−${money(order.discountMinor)}`,
              muted: true,
            },
          ]
        : []),
      { label: text.total, value: money(order.totalMinor), strong: true },
      { label: text.vat, value: money(order.taxMinor), muted: true },
      // Bought for a business (B2B): the total without VAT too.
      ...(order.company ? [{ label: m.totalExclVat, value: money(order.totalMinor - order.taxMinor), muted: true }] : []),
    ],
  };
}

/** The company an order was bought for (B2B), as on its invoice. */
function companyText(order: OrderView, m: Messages): string | null {
  return order.company ? `${order.company.name}\n${m.company.number}: ${order.company.number}` : null;
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
  const digital = order.lines.some((line) => line.delivery === "digital" && line.variantId !== null);

  const blocks: EmailBlock[] = [
    { type: "heading", text: text.orderHeading },
    { type: "paragraph", text: renewal ? text.renewalIntro(order.number) : text.orderIntro(order.number) },
    orderLines(order, text, m, money, storeSiteUrl(store.slug)),
    ...[companyText(order, m)].flatMap((company) => (company ? [{ type: "paragraph" as const, text: company }] : [])),
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
            url: `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, `/subscription/${subscription.manageToken}`)}`,
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

/** The code for a new password (D32); it proves the email, as a sign-in code does. */
export async function sendPasswordResetCode(
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
    subject: text.resetSubject(store.name),
    preview: `${code} · ${text.resetIntro}`,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: text.resetHeading },
      { type: "paragraph", text: text.resetIntro },
      { type: "code", text: code },
      { type: "paragraph", text: text.codeIgnore },
    ],
  });
  return sendEmail({ storeId, kind: "account.reset", to, email, fromName: store.name, replyTo: store.details.contactEmail });
}

/** Welcome to a new account opened with a password (D32), once per account. */
export async function sendWelcome(
  storeId: string,
  customerId: string,
  { marketCode, locale }: { marketCode: string; locale: string },
): Promise<SendOutcome | null> {
  const [customer] = await db().execute<Row>(sql`
    select email from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  const ctx = customer && (await context(storeId, marketCode, locale));
  if (!ctx) return null;
  const { store, market, text } = ctx;
  const to = String(customer.email);
  const email = renderEmail({
    subject: text.welcomeSubject(store.name),
    preview: text.welcomeHeading,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: text.welcomeHeading },
      { type: "paragraph", text: text.welcomeIntro(to) },
      { type: "button", text: text.welcomeButton, url: `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, "/account")}` },
      { type: "paragraph", text: text.welcomeIgnore },
    ],
  });
  return sendEmail({
    storeId,
    kind: "account.welcome",
    to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `account-welcome:${customerId}`,
  });
}

/** Welcome to the account opened with an order at checkout. */
export async function sendWelcomeForOrder(storeId: string, orderId: string): Promise<SendOutcome | null> {
  const [order] = await db().execute<Row>(sql`
    select customer_id, market_code, locale from commerce.orders
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid and customer_id is not null
  `);
  if (!order) return null;
  return sendWelcome(storeId, String(order.customer_id), {
    marketCode: String(order.market_code),
    locale: String(order.locale),
  });
}

/** What renews, its shipping and total, and the link to manage it. */
function subscriptionBlocks(
  subscription: SubscriptionView,
  store: EmailStore,
  market: Market,
  text: EmailText,
  money: (minor: number) => string,
  every: string,
): EmailBlock[] {
  return [
    {
      type: "lines",
      rows: [
        ...subscription.lines.map((line) => ({ label: `${line.quantity} × ${line.title}`, value: money(line.totalMinor) })),
        ...(subscription.shippingMinor > 0
          ? [{ label: text.shipping, value: money(subscription.shippingMinor), muted: true }]
          : []),
        { label: `${text.total} · ${every.toLowerCase()}`, value: money(subscription.totalMinor), strong: true },
      ],
    },
    {
      type: "button",
      text: text.manageSubscription,
      url: `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, `/subscription/${subscription.manageToken}`)}`,
    },
  ];
}

/** Confirms a change the subscriber or the store made (D29). */
export async function sendSubscriptionChanged(
  storeId: string,
  subscription: SubscriptionView,
  change: SubscriptionChange | "change",
): Promise<SendOutcome | null> {
  if (!subscription.email) return null;
  const ctx = await context(storeId, subscription.marketCode, subscription.locale);
  if (!ctx) return null;
  const { store, market, text, m } = ctx;
  const money = (minor: number) => formatMoney(minor, subscription.currency, market.locale);
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(market.locale, { dateStyle: "long", timeZone: "Europe/Oslo" }) : "";
  const intro =
    change === "cancel"
      ? text.changes.cancel(date(subscription.endsAt))
      : change === "pause" || change === "skip"
        ? text.changes[change](date(subscription.nextChargeAt))
        : text.changes[change]();
  const ended = change === "cancel_now";
  const email = renderEmail({
    subject: text.changedSubject(store.name),
    preview: intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: text.changedHeading },
      { type: "paragraph", text: intro },
      ...(ended
        ? []
        : subscriptionBlocks(subscription, store, market, text, money, m.planEvery(subscription.interval, subscription.intervalCount))),
    ],
  });
  return sendEmail({
    storeId,
    kind: `subscription.${change}`,
    to: subscription.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    subscriptionId: subscription.id,
  });
}

/**
 * Tells the subscriber a charge is coming (D29): before a free trial ends,
 * and before a renewal. Once per charge date.
 */
export async function sendRenewalReminder(
  storeId: string,
  subscription: SubscriptionView,
  kind: "trial" | "renewal",
  chargeAt: Date,
): Promise<SendOutcome | null> {
  if (!subscription.email) return null;
  const ctx = await context(storeId, subscription.marketCode, subscription.locale);
  if (!ctx) return null;
  const { store, market, text, m } = ctx;
  const money = (minor: number) => formatMoney(minor, subscription.currency, market.locale);
  const date = chargeAt.toLocaleDateString(market.locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  const amount = money(subscription.totalMinor);
  const intro = kind === "trial" ? text.trialIntro(date, amount) : text.reminderIntro(date, amount);
  const email = renderEmail({
    subject: kind === "trial" ? text.trialSubject(store.name, date) : text.reminderSubject(store.name, date),
    preview: intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: kind === "trial" ? text.trialHeading : text.reminderHeading },
      { type: "paragraph", text: intro },
      ...subscriptionBlocks(subscription, store, market, text, money, m.planEvery(subscription.interval, subscription.intervalCount)),
      { type: "paragraph", text: text.reminderChange },
    ],
  });
  return sendEmail({
    storeId,
    kind: `subscription.${kind}_reminder`,
    to: subscription.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `subscription-reminder:${subscription.id}:${chargeAt.toISOString()}`,
    subscriptionId: subscription.id,
  });
}

export { context as emailContext, footer as emailFooter, orderUrl, orderLines as orderLinesBlock, storeById };
