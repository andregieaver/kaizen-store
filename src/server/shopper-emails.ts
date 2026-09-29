import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { formatBookingTime } from "@/lib/booking-slots";
import { bookingWhen, isRange } from "@/lib/booking-text";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText, type EmailText } from "@/lib/email-text";
import { calendarFile, type CalendarEvent } from "@/lib/ics";
import { t, type Messages } from "@/lib/i18n";
import { toMarket, type Market, type MarketRow } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { absoluteUrl } from "@/lib/seo";
import { cutoffWeekday, formatDeliveryDate, weekdayName } from "@/lib/standing-orders";
import { siteUrl } from "@/lib/site";

import { sendEmail, type OutgoingEmail, type SendOutcome } from "./email";
import { getOrder, type OrderBooking, type OrderView } from "./orders";
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
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider in ('stripe', 'venue')
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
        label: line.booking
          ? `${isRange(line.booking) ? line.title : `${line.quantity} × ${line.title}`}, ${bookingWhen(line.booking, order.locale, m)}`
          : `${line.quantity} × ${line.title}`,
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
      // Paid at the appointment (D66): what is still to pay there.
      ...(order.balanceMinor > 0 ? [{ label: m.booking.atVenue, value: money(order.balanceMinor) }] : []),
      // Bought for a business (B2B): the total without VAT too.
      ...(order.company ? [{ label: m.totalExclVat, value: money(order.totalMinor - order.taxMinor), muted: true }] : []),
    ],
  };
}

type BookedLine = OrderView["lines"][number] & { booking: OrderBooking };

/** An order's appointments (D65), confirmed ones unless said. */
function bookedLines(order: OrderView, status: OrderBooking["status"] = "confirmed"): BookedLine[] {
  return order.lines.filter((line): line is BookedLine => line.booking?.status === status);
}

/** A booking as a calendar event: the same uid in every email about it, so a cancellation replaces it. */
function bookingEvent(line: BookedLine, store: EmailStore, m: Messages, cancelled = false): CalendarEvent {
  const { booking } = line;
  return {
    uid: `booking-${booking.id}@kaizen`,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    summary: `${line.title} · ${store.name}`,
    description: booking.kind === "appointment" ? m.booking.withStaff(booking.staff) : booking.staff,
    location: booking.place ?? undefined,
    organizer: store.details.contactEmail ? { name: store.name, email: store.details.contactEmail } : null,
    cancelled,
    // Each move raised it; a cancellation goes one higher, so calendars take it over the event.
    sequence: booking.sequence + (cancelled ? 1 : 0),
  };
}

/** The calendar file sent with an email about bookings. */
function calendarAttachment(events: CalendarEvent[]): NonNullable<OutgoingEmail["attachments"]> {
  if (events.length === 0) return [];
  const cancel = events.every((e) => e.cancelled);
  return [
    {
      filename: cancel ? "cancelled.ics" : "appointment.ics",
      content: calendarFile(events),
      contentType: `text/calendar; charset=utf-8; method=${cancel ? "CANCEL" : "PUBLISH"}`,
    },
  ];
}

/** An appointment (or a stay, a rental) as the emails write it: what, when, with whom or in what, and where. */
function bookingText(line: BookedLine, locale: string, m: Messages): string {
  return [`${line.title}: ${bookingWhen(line.booking, locale, m)}`, line.booking.place].filter(Boolean).join("\n");
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
  const booked = bookedLines(order);

  const blocks: EmailBlock[] = [
    { type: "heading", text: text.orderHeading },
    { type: "paragraph", text: renewal ? text.renewalIntro(order.number) : text.orderIntro(order.number) },
    orderLines(order, text, m, money, storeSiteUrl(store.slug)),
    ...[companyText(order, m)].flatMap((company) => (company ? [{ type: "paragraph" as const, text: company }] : [])),
    ...(address ? [{ type: "paragraph" as const, text: `${text.deliverTo}:\n${address}` }] : []),
    ...(digital ? [{ type: "paragraph" as const, text: text.downloadsReady }] : []),
    // Appointments (D65): where and when again, and the calendar file.
    ...(booked.length > 0
      ? [
          {
            type: "paragraph" as const,
            text: `${text.appointmentsHeading}:\n${booked.map((line) => bookingText(line, order.locale, m)).join("\n\n")}\n\n${text.calendarNote}`,
          },
        ]
      : []),
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
    attachments: calendarAttachment(booked.map((line) => bookingEvent(line, store, m))),
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
    m: Messages;
  }) => { subject: string; heading: string; intro: string; extra?: EmailBlock[]; attachments?: OutgoingEmail["attachments"] },
): Promise<SendOutcome | null> {
  const order = await getOrder(storeId, orderId);
  if (!order?.email) return null;
  const ctx = await context(storeId, order.marketCode, order.locale);
  if (!ctx) return null;
  const { store, market, text, m } = ctx;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const built = build({ order, text, money, store, m });
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
    attachments: built.attachments,
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

export function sendCancelled(storeId: string, orderId: string, amountMinor: number, { unpaid = false }: { unpaid?: boolean } = {}) {
  return orderNotice(storeId, orderId, "order.cancelled", `order-cancelled:${orderId}`, ({ order, text, money, store, m }) => ({
    subject: text.cancelledSubject(store.name, order.number),
    heading: text.cancelledHeading,
    // A weekly delivery cancelled before it was sent (D102) was never charged.
    intro: unpaid ? text.cancelledUnpaidIntro(order.number) : text.cancelledIntro(order.number, money(amountMinor)),
    // Its appointments come out of the shopper's calendar too (D65).
    attachments: calendarAttachment(bookedLines(order, "cancelled").map((line) => bookingEvent(line, store, m, true))),
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

// ---------------------------------------------------------------------------
// Appointments (D65)
// ---------------------------------------------------------------------------

/** An order's email about one of its bookings, with that booking's calendar event. */
async function bookingEmail(
  storeId: string,
  bookingId: string,
  kind: string,
  build: (args: {
    order: OrderView;
    line: BookedLine;
    when: string;
    text: EmailText;
    store: EmailStore;
    m: Messages;
    money: (minor: number) => string;
  }) => {
    subject: string;
    heading: string;
    intro: string;
    cancelled: boolean;
  },
): Promise<SendOutcome | null> {
  const [row] = await db().execute<Row>(sql`
    select order_id from commerce.bookings where store_id = ${storeId}::uuid and id = ${bookingId}::uuid
  `);
  const order = row?.order_id ? await getOrder(storeId, String(row.order_id)) : null;
  const line = order?.lines.find((l): l is BookedLine => l.booking?.id === bookingId);
  if (!order?.email || !line) return null;
  const money = (minor: number) => formatMoney(minor, order.currency, order.locale);
  const ctx = await context(storeId, order.marketCode, order.locale);
  if (!ctx) return null;
  const { store, market, text, m } = ctx;
  const when = formatBookingTime(line.booking.startsAt, order.locale, line.booking.timeZone);
  const built = build({ order, line, when, text, store, m, money });
  const url = await orderUrl(storeId, store, market, order.id);
  const email = renderEmail({
    subject: built.subject,
    preview: built.intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: built.heading },
      { type: "paragraph", text: built.intro },
      { type: "paragraph", text: bookingText(line, order.locale, m) },
      ...(built.cancelled ? [] : [{ type: "paragraph" as const, text: text.calendarNote }]),
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
    // Once per booking and change: a booking moved twice gets two emails.
    idempotencyKey: `${kind}:${bookingId}:${line.booking.sequence}`,
    orderId: order.id,
    attachments: calendarAttachment([bookingEvent(line, store, m, built.cancelled)]),
  });
}

/** The reminder a set number of hours before an appointment. Once per booking. */
export function sendBookingReminder(storeId: string, bookingId: string) {
  return bookingEmail(storeId, bookingId, "booking.reminder", ({ when, text, store }) => ({
    subject: text.bookingReminderSubject(store.name, when),
    heading: text.bookingReminderHeading,
    intro: text.bookingReminderIntro(when),
    cancelled: false,
  }));
}

/** The shopper moved their appointment (D66): the new time, replacing the event in their calendar. */
export function sendBookingMoved(storeId: string, bookingId: string) {
  return bookingEmail(storeId, bookingId, "booking.moved", ({ when, text, store }) => ({
    subject: text.bookingMovedSubject(store.name, when),
    heading: text.bookingMovedHeading,
    intro: text.bookingMovedIntro(when),
    cancelled: false,
  }));
}

/** The shopper cancelled their appointment (D66): what is paid back, and it leaves their calendar. */
export function sendBookingCancelledByShopper(storeId: string, bookingId: string, refundMinor: number) {
  return bookingEmail(storeId, bookingId, "booking.cancelled_by_customer", ({ line, when, text, store, money }) => ({
    subject: text.bookingCancelledByYouSubject(store.name, when),
    heading: text.bookingCancelledByYouHeading,
    intro: text.bookingCancelledByYouIntro(line.title, when, refundMinor > 0 ? money(refundMinor) : null),
    cancelled: true,
  }));
}

/** The store has cancelled one appointment: the shopper is told, and it leaves their calendar. */
export function sendBookingCancelled(storeId: string, bookingId: string) {
  return bookingEmail(storeId, bookingId, "booking.cancelled", ({ line, when, text, store }) => ({
    subject: text.bookingCancelledSubject(store.name, when),
    heading: text.bookingCancelledHeading,
    intro: text.bookingCancelledIntro(line.title, when),
    cancelled: true,
  }));
}

/**
 * Tells each member of staff with an email about their new bookings in a
 * paid order, with the calendar event. In English, like the admin; once per
 * booking.
 */
export async function sendBookingStaffNotices(storeId: string, orderId: string): Promise<SendOutcome[]> {
  const order = await getOrder(storeId, orderId);
  const booked = order ? bookedLines(order) : [];
  if (!order || booked.length === 0) return [];
  const store = await storeById(storeId);
  if (!store) return [];
  const emails = await db().execute<Row>(sql`
    select b.id, r.email from commerce.bookings b
    join commerce.booking_resources r on r.store_id = b.store_id and r.id = b.resource_id
    where b.store_id = ${storeId}::uuid and b.order_id = ${orderId}::uuid and r.email <> ''
  `);
  const staffEmail = new Map(emails.map((row) => [String(row.id), String(row.email)]));
  const m = t("en");
  const customer = [order.billingAddress.name, order.email, order.billingAddress.phone].filter(Boolean).join(" · ");
  const outcomes: SendOutcome[] = [];
  for (const line of booked) {
    const to = staffEmail.get(line.booking.id);
    if (!to) continue;
    const when = formatBookingTime(line.booking.startsAt, "en-GB", line.booking.timeZone);
    const email = renderEmail({
      subject: `New booking: ${line.title}, ${when}`,
      preview: `${line.title}, ${when}, ${customer}`,
      lang: "en",
      footer: [store.name],
      blocks: [
        { type: "heading", text: "New booking" },
        { type: "paragraph", text: bookingText(line, "en-GB", m) },
        { type: "paragraph", text: `Customer: ${customer}\nOrder ${order.number}` },
        { type: "button", text: "See the order", url: `${siteUrl()}/admin/${store.slug}/orders/${order.id}` },
      ],
    });
    outcomes.push(
      await sendEmail({
        storeId,
        kind: "booking.staff",
        to,
        email,
        fromName: store.name,
        replyTo: order.email,
        idempotencyKey: `booking.staff:${line.booking.id}`,
        orderId: order.id,
        attachments: calendarAttachment([{ ...bookingEvent(line, store, m), description: `${customer}\nOrder ${order.number}` }]),
      }),
    );
  }
  return outcomes;
}

/**
 * Sends the reminders now due, across stores: confirmed appointments of
 * paid orders starting within the store's reminder hours. Each is claimed
 * before it is sent, so none goes twice. Bookings made inside that window
 * get none: their confirmation has just told them.
 */
export async function sendDueBookingReminders(limit = 100): Promise<number> {
  const due = await db().execute<Row>(sql`
    update commerce.bookings set reminded_at = now()
    where id in (
      select b.id from commerce.bookings b
      join commerce.stores s on s.id = b.store_id
      join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
      where b.status = 'confirmed' and b.reminded_at is null
        and b.starts_at > now()
        and s.booking_reminder_hours > 0
        and b.starts_at <= now() + make_interval(hours => s.booking_reminder_hours)
        and b.created_at <= b.starts_at - make_interval(hours => s.booking_reminder_hours)
        and o.status in ('paid', 'fulfilled') and o.email <> ''
      order by b.starts_at
      limit ${limit}
      for update of b skip locked
    )
    returning id, store_id
  `);
  let sent = 0;
  for (const row of due) {
    const outcome = await sendBookingReminder(String(row.store_id), String(row.id));
    if (outcome === "sent" || outcome === "logged") sent += 1;
  }
  return sent;
}

/**
 * Tells the member of staff, if they have an email, that a customer moved
 * or cancelled their booking (D66), with the calendar event updated or
 * cancelled. In English, like the admin.
 */
export async function sendBookingStaffChange(
  storeId: string,
  bookingId: string,
  change: "moved" | "cancelled",
): Promise<SendOutcome | null> {
  const [row] = await db().execute<Row>(sql`
    select b.order_id, r.email from commerce.bookings b
    join commerce.booking_resources r on r.store_id = b.store_id and r.id = b.resource_id
    where b.store_id = ${storeId}::uuid and b.id = ${bookingId}::uuid
  `);
  if (!row?.email || !row.order_id) return null;
  const order = await getOrder(storeId, String(row.order_id));
  const line = order?.lines.find((l): l is BookedLine => l.booking?.id === bookingId);
  const store = await storeById(storeId);
  if (!order || !line || !store) return null;
  const when = formatBookingTime(line.booking.startsAt, "en-GB", line.booking.timeZone);
  const customer = [order.billingAddress.name, order.email].filter(Boolean).join(" · ");
  const heading = change === "moved" ? "Booking moved" : "Booking cancelled";
  const email = renderEmail({
    subject: `${heading}: ${line.title}, ${when}`,
    preview: `${line.title}, ${when}, ${customer}`,
    lang: "en",
    footer: [store.name],
    blocks: [
      { type: "heading", text: heading },
      {
        type: "paragraph",
        text: `${change === "moved" ? "The customer moved their booking to" : "The customer cancelled their booking on"} ${when}: ${line.title}.`,
      },
      { type: "paragraph", text: `Customer: ${customer}\nOrder ${order.number}` },
      { type: "button", text: "See the order", url: `${siteUrl()}/admin/${store.slug}/orders/${order.id}` },
    ],
  });
  return sendEmail({
    storeId,
    kind: `booking.staff_${change}`,
    to: String(row.email),
    email,
    fromName: store.name,
    replyTo: order.email,
    idempotencyKey: `booking.staff_${change}:${bookingId}:${line.booking.sequence}`,
    orderId: order.id,
    attachments: calendarAttachment([bookingEvent(line, store, t("en"), change === "cancelled")]),
  });
}

// ---------------------------------------------------------------------------
// Weekly deliveries (D102)
// ---------------------------------------------------------------------------

/** A list's shopper, market and delivery day, for its emails. */
async function listContext(storeId: string, listId: string) {
  const [row] = await db().execute<Row>(sql`
    select l.id, c.email, c.locale, d.market_code, d.delivery_weekday, d.cutoff_days, d.cutoff_time, m.default_locale
    from commerce.standing_orders l
    join commerce.customers c on c.store_id = l.store_id and c.id = l.customer_id
    join commerce.delivery_schedules d on d.store_id = l.store_id and d.id = l.schedule_id
    join commerce.markets m on m.store_id = d.store_id and m.code = d.market_code
    where l.store_id = ${storeId}::uuid and l.id = ${listId}::uuid
  `);
  if (!row?.email) return null;
  const locale = String(row.default_locale);
  const ctx = await context(storeId, String(row.market_code), locale);
  if (!ctx) return null;
  const listUrl = `${storeSiteUrl(ctx.store.slug)}${marketPath(ctx.store.slug, ctx.market.slug, "/deliveries")}`;
  const schedule = { deliveryWeekday: Number(row.delivery_weekday), cutoffDays: Number(row.cutoff_days) };
  return { ...ctx, email: String(row.email), locale, listUrl, schedule, cutoffTime: String(row.cutoff_time) };
}

/** The shopper's agreement to a weekly delivery, confirmed: when, how it is charged, and how to stop. */
export async function sendDeliveryStarted(storeId: string, listId: string): Promise<SendOutcome | null> {
  const ctx = await listContext(storeId, listId);
  if (!ctx) return null;
  const { store, text, locale, schedule } = ctx;
  const d = text.deliveries;
  const cutoff = `${weekdayName(cutoffWeekday(schedule), locale)} ${ctx.cutoffTime}`;
  const intro = d.startedIntro(weekdayName(schedule.deliveryWeekday, locale), cutoff);
  const email = renderEmail({
    subject: d.startedSubject(store.name),
    preview: intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: d.startedHeading },
      { type: "paragraph", text: intro },
      { type: "paragraph", text: d.startedCharge },
      { type: "paragraph", text: d.startedCancel },
      { type: "button", text: d.manage, url: ctx.listUrl },
    ],
  });
  return sendEmail({
    storeId,
    kind: "delivery.started",
    to: ctx.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `delivery-started:${listId}`,
  });
}

/** At the cutoff: what the next delivery holds and what it will cost, what was left out, or that there is none. */
export async function sendDeliveryPrepared(storeId: string, listId: string, date: string): Promise<SendOutcome | null> {
  const ctx = await listContext(storeId, listId);
  if (!ctx) return null;
  const [delivery] = await db().execute<Row>(sql`
    select order_id, left_out from commerce.standing_deliveries
    where store_id = ${storeId}::uuid and standing_order_id = ${listId}::uuid and delivery_date = ${date}::date
  `);
  if (!delivery) return null;
  const { store, market, text, m, locale } = ctx;
  const d = text.deliveries;
  const day = formatDeliveryDate(date, locale);
  const leftOut = (delivery.left_out ?? []) as { title: string; wanted: number; got: number }[];
  const order = delivery.order_id ? await getOrder(storeId, String(delivery.order_id)) : null;
  const money = (minor: number) => formatMoney(minor, order?.currency ?? market.currency, market.locale);
  const intro = order ? d.preparedIntro(day) : d.nothingIntro(day);
  const email = renderEmail({
    subject: d.preparedSubject(store.name, day),
    preview: intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: d.preparedHeading },
      { type: "paragraph", text: intro },
      ...(order
        ? [
            orderLines(order, text, m, money, storeSiteUrl(store.slug)),
            { type: "paragraph" as const, text: d.preparedCharge(money(order.totalMinor)) },
          ]
        : []),
      ...(leftOut.length > 0
        ? [
            {
              type: "paragraph" as const,
              text: `${d.leftOutHeading}:\n${leftOut.map((l) => d.leftOutLine(l.title, l.wanted, l.got)).join("\n")}`,
            },
          ]
        : []),
      ...(order ? [{ type: "paragraph" as const, text: `${text.deliverTo}:\n${addressText(order) ?? ""}` }] : []),
      { type: "button", text: d.manage, url: ctx.listUrl },
    ],
  });
  return sendEmail({
    storeId,
    kind: "delivery.prepared",
    to: ctx.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `delivery-prepared:${listId}:${date}`,
    orderId: order?.id ?? null,
  });
}

/** The card did not pay for a delivery being sent: a link to pay, and to use another card from now on. */
export async function sendDeliveryCard(storeId: string, orderId: string): Promise<SendOutcome | null> {
  const [row] = await db().execute<Row>(sql`
    select standing_order_id from commerce.standing_deliveries where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
  `);
  const order = await getOrder(storeId, orderId);
  const ctx = row ? await listContext(storeId, String(row.standing_order_id)) : null;
  if (!ctx || !order) return null;
  const { store, market, text } = ctx;
  const d = text.deliveries;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const intro = d.cardIntro(order.number, money(order.totalMinor));
  const email = renderEmail({
    subject: d.cardSubject(store.name, order.number),
    preview: intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: d.cardHeading },
      { type: "paragraph", text: intro },
      { type: "button", text: d.payNow, url: ctx.listUrl },
    ],
  });
  return sendEmail({
    storeId,
    kind: "delivery.card_failed",
    to: ctx.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    orderId,
  });
}
