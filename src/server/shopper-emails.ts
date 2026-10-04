import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { formatBookingTime } from "@/lib/booking-slots";
import { bookingWhen, isRange } from "@/lib/booking-text";
import { discountNote } from "@/lib/customer-tiers";
import { pickupPointLine } from "@/lib/delivery-options";
import { formatWindow } from "@/lib/porterbuddy";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText, orderBonusEarned, orderBonusRows, orderReferralRows, orderVatParagraph, orderVatReliefRows, refundVatNote, type EmailText } from "@/lib/email-text";
import { calendarFile, type CalendarEvent } from "@/lib/ics";
import { t, type Messages } from "@/lib/i18n";
import { conversionFor, localizationOf } from "@/lib/localization";
import { marketSlug } from "@/lib/market-slug";
import { findMarket, toMarket, type Market, type MarketRow } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { absoluteUrl } from "@/lib/seo";
import { cutoffWeekday, formatDeliveryDate, weekdayName } from "@/lib/standing-orders";
import { siteUrl } from "@/lib/site";
import { lineUnitPriceText } from "@/lib/unit-price-text";

import { sendEmail, type OutgoingEmail, type SendOutcome } from "./email";
import { documentBlocks, emailsCarryInvoice, recordDocumentDeliveries, type DocumentBlocks, type DocumentWant } from "./invoice-emails";
import { ensureUi } from "./ui-text";
import { withdrawBlocks } from "./withdraw-link";
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
export type EmailStore = Pick<Store, "id" | "slug" | "name" | "details" | "markets" | "localization">;

async function storeById(storeId: string): Promise<EmailStore | null> {
  const [row] = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.legal_name, s.organisation_number, s.contact_email, s.postal_address, s.country, s.locales,
      (select coalesce(json_agg(json_build_object('currency', c.currency, 'rate', c.rate, 'roundTo', c.round_to) order by c.position, c.currency), '[]')
         from commerce.store_currencies c where c.store_id = s.id) as currencies,
      coalesce(json_agg(json_build_object('code', m.code, 'currency', m.currency, 'defaultLocale', m.default_locale)
        order by (m.code = s.country) desc nulls last, m.created_at) filter (where m.code is not null), '[]') as markets
    from commerce.stores s
    left join commerce.markets m on m.store_id = s.id
    where s.id = ${storeId}::uuid
    group by s.id
  `);
  if (!row) return null;
  const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
  const markets = (row.markets as MarketRow[]).map(toMarket);
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
    markets,
    localization: localizationOf(
      ((row.locales ?? []) as string[]).map(String),
      ((row.currencies ?? []) as { currency: string; rate: string | number | null; roundTo: number }[]).map((c) => ({
        currency: String(c.currency).trim(),
        rate: c.rate === null ? null : Number(c.rate),
        roundTo: Number(c.roundTo),
      })),
      markets,
    ),
  };
}

/**
 * The store, the order's market and its language, for one order's emails. The
 * market is the country as the shopper saw it (D109): its links keep their
 * language and currency while the store still offers them, else lead to the
 * country's own address, which always exists.
 */
async function context(storeId: string, marketCode: string, locale: string, currency?: string) {
  await ensureUi();
  const store = await storeById(storeId);
  if (!store) return null;
  const native: Market | undefined = store.markets.find((m) => m.code === marketCode) ?? store.markets[0];
  if (!native) return null;
  const lang = locale.split("-")[0] || native.lang;
  const wanted = marketSlug(native.code, { lang, currency: currency ?? native.nativeCurrency }, { lang: native.ownLocale.split("-")[0], currency: native.nativeCurrency });
  const view = findMarket(store.markets, wanted, {
    locales: store.localization.locales,
    conversion: (from, to) => conversionFor(store.localization, from, to),
  });
  // Numbers and dates read as the shopper chose, whatever the store offers now.
  const market: Market = { ...(view ?? native), locale: locale || native.locale, lang };
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
          : // The price per kg, litre or metre as sold (D160): from the line's own price and its frozen measure, in the order's currency.
            [`${line.quantity} × ${line.title}`, lineUnitPriceText(line, order.currency, order.locale, m)].filter(Boolean).join(" · "),
        // A free product a campaign gave (D114): its price is all taken off below.
        value: line.gift ? `${money(line.unitPriceMinor * line.quantity)} (${m.freeGift})` : money(line.unitPriceMinor * line.quantity),
        image: line.image ? absoluteUrl(line.image, origin) : null,
      })),
      { label: text.subtotal, value: money(order.subtotalMinor), muted: true },
      ...(order.ships ? [{ label: order.delivery?.label ?? text.shipping, value: money(order.shippingMinor), muted: true }] : []),
      ...(order.discountMinor > 0
        ? [
            {
              label: discountNote(order) ? `${text.discount} (${discountNote(order)})` : text.discount,
              value: `−${money(order.discountMinor)}`,
              muted: true,
            },
          ]
        : []),
      // The friend's welcome discount (D131) and the bonus credits used (D130), after the discounts.
      ...orderReferralRows(text, order.referralDiscountMinor, money),
      ...orderBonusRows(text, order.bonus, money),
      // The VAT a reverse-charge order did not charge (D157), the last thing taken off, so the rows add up to the total.
      ...orderVatReliefRows(order.locale.split("-")[0], order, money),
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

function addressText(order: OrderView, m?: Messages, timeZone = "Europe/Oslo"): string | null {
  const a = order.shippingAddress;
  if (!order.ships || !a.line1) return null;
  const point = order.delivery?.pickupPoint;
  const window = order.delivery?.window;
  return [
    a.name,
    a.line1,
    a.line2,
    `${a.postalCode ?? ""} ${a.city ?? ""}`.trim(),
    point && m ? m.deliveryChoice.pickupAt(pickupPointLine(point)) : null,
    window && m ? m.deliveryChoice.windowLine(formatWindow(window, order.locale, timeZone)) : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The confirmation for a paid order: a new one, or a subscription's renewal. Once per order. */
export async function sendOrderConfirmation(
  storeId: string,
  orderId: string,
  { resend = false }: { resend?: boolean } = {},
): Promise<SendOutcome | null> {
  const order = await getOrder(storeId, orderId);
  // History copied from another store (D129) is never mailed about; the database refuses its emails too.
  if (!order || order.copied || !order.email || order.status === "pending_payment" || order.status === "cancelled") return null;
  const ctx = await context(storeId, order.marketCode, order.locale, order.currency);
  if (!ctx) return null;
  const { store, market, text, m } = ctx;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const subscription = order.subscriptionId ? await getSubscriptionForOrder(storeId, orderId) : null;
  const renewal = subscription !== null && subscription.number !== order.number;
  const url = await orderUrl(storeId, store, market, orderId);
  const address = addressText(order, m);
  const digital = order.lines.some((line) => line.delivery === "digital" && line.variantId !== null);
  const booked = bookedLines(order);
  // The invoice (D159): its number and a link, issued in the payment's own transaction; nothing when there is none (waiting, test, copied).
  const documents = await documentsFor(storeId, order, store, market, { invoice: true }, { switchable: true });

  const blocks: EmailBlock[] = [
    { type: "heading", text: text.orderHeading },
    { type: "paragraph", text: renewal ? text.renewalIntro(order.number) : text.orderIntro(order.number) },
    orderLines(order, text, m, money, storeSiteUrl(store.slug)),
    // Reverse charge or IOSS (D157): the statement, with both VAT numbers or the IOSS number. The shopper's own email.
    ...[orderVatParagraph(order.locale.split("-")[0], order)].flatMap((vat) => (vat ? [{ type: "paragraph" as const, text: vat }] : [])),
    // The credits this order earned (D130), once it is paid: when they can be used.
    ...[orderBonusEarned(text, order.bonus, money, (iso) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "long" }))].flatMap((earned) =>
      earned ? [{ type: "paragraph" as const, text: earned }] : [],
    ),
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
    ...(documents?.blocks ?? []),
    ...(url ? [{ type: "button" as const, text: text.seeOrder, url }] : []),
    // The right of withdrawal (D153): a consumer's order says so and links to the withdrawal function.
    ...(await withdrawBlocks(storeId, store, market, order, text)),
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
  const kind = renewal ? "subscription.renewed" : "order.confirmation";
  const idempotencyKey = resend ? undefined : `order-confirmation:${orderId}`;
  const outcome = await sendEmail({
    storeId,
    kind,
    to: order.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    // Staff can send it again; the automatic one goes once.
    idempotencyKey,
    orderId,
    subscriptionId: subscription?.id ?? null,
    attachments: [...calendarAttachment(booked.map((line) => bookingEvent(line, store, m))), ...(documents?.attachments ?? [])],
  });
  await noteDeliveries(storeId, documents, outcome, { idempotencyKey, orderId, kind });
  return outcome;
}

/** The documents an email adds for an order, or null (never throws: a document never stops an email). */
async function documentsFor(
  storeId: string,
  order: OrderView,
  store: EmailStore,
  market: Market,
  want: DocumentWant,
  { switchable = false }: { switchable?: boolean } = {},
): Promise<DocumentBlocks | null> {
  try {
    if (switchable && !(await emailsCarryInvoice(storeId))) return null;
    const found = await documentBlocks({ storeId, orderId: order.id, storeSlug: store.slug, marketSlug: market.slug, lang: order.locale.split("-")[0] || market.lang, want, attach: true });
    return found.docs.length > 0 ? found : null;
  } catch {
    return null;
  }
}

/** Notes which documents an email carried, once it is kept. */
async function noteDeliveries(storeId: string, documents: DocumentBlocks | null, outcome: SendOutcome, email: { idempotencyKey?: string; orderId: string; kind: string }) {
  if (!documents || outcome === "duplicate" || outcome === "failed") return;
  await recordDocumentDeliveries(storeId, documents.docs, email);
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
  }) => { subject: string; heading: string; intro: string; extra?: EmailBlock[]; attachments?: OutgoingEmail["attachments"]; withdraw?: boolean },
  /** The documents the email carries (D159): the invoice (when the owner lets the emails carry it) or a refund's credit note. */
  documents?: { want: DocumentWant; switchable?: boolean },
): Promise<SendOutcome | null> {
  const order = await getOrder(storeId, orderId);
  if (!order?.email || order.copied) return null;
  const ctx = await context(storeId, order.marketCode, order.locale, order.currency);
  if (!ctx) return null;
  const { store, market, text, m } = ctx;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const built = build({ order, text, money, store, m });
  const url = await orderUrl(storeId, store, market, orderId);
  const carried = documents ? await documentsFor(storeId, order, store, market, documents.want, { switchable: documents.switchable }) : null;
  const email = renderEmail({
    subject: built.subject,
    preview: built.intro,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: built.heading },
      { type: "paragraph", text: built.intro },
      ...(built.extra ?? []),
      ...(carried?.blocks ?? []),
      ...(url ? [{ type: "button" as const, text: text.seeOrder, url }] : []),
      ...(built.withdraw ? await withdrawBlocks(storeId, store, market, order, text) : []),
    ],
  });
  const outcome = await sendEmail({
    storeId,
    kind,
    to: order.email,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: key,
    orderId,
    attachments: [...(built.attachments ?? []), ...(carried?.attachments ?? [])],
  });
  await noteDeliveries(storeId, carried, outcome, { idempotencyKey: key, orderId, kind });
  return outcome;
}

export function sendShipped(
  storeId: string,
  orderId: string,
  shipment: { id: string; carrier: string; trackingNumber: string; trackingUrl: string | null },
  { resend = false }: { resend?: boolean } = {},
) {
  // Sent again on request: a key of its own, so the first sending does not stop it.
  const key = resend ? `order-sent:${shipment.id}:again:${crypto.randomUUID()}` : `order-sent:${shipment.id}`;
  return orderNotice(
    storeId,
    orderId,
    "order.sent",
    key,
    ({ order, text, store, m }) => {
      const address = addressText(order, m);
      return {
        subject: text.shippedSubject(store.name, order.number),
        heading: text.shippedHeading,
        intro: text.shippedIntro(order.number),
        withdraw: true,
        extra: [
          ...(shipment.trackingNumber ? [{ type: "paragraph" as const, text: text.tracking(shipment.carrier, shipment.trackingNumber) }] : []),
          ...(shipment.trackingUrl ? [{ type: "button" as const, text: text.trackParcel, url: shipment.trackingUrl }] : []),
          ...(address ? [{ type: "paragraph" as const, text: `${text.deliverTo}:\n${address}` }] : []),
        ],
      };
    },
    // The invoice again, for the shopper who has lost it (D159).
    { want: { invoice: true }, switchable: true },
  );
}

export function sendRefunded(storeId: string, orderId: string, refundId: string, amountMinor: number) {
  return orderNotice(
    storeId,
    orderId,
    "order.refunded",
    `order-refunded:${refundId}`,
    ({ order, text, money, store }) => ({
      subject: text.refundSubject(store.name, order.number),
      heading: text.refundHeading,
      // An order whose VAT was not charged (reverse charge, D157) is refunded without VAT, and the email says so.
      intro: [text.refundIntro(money(amountMinor), order.number), refundVatNote(order.locale.split("-")[0], order)].filter(Boolean).join(" "),
    }),
    // The refund's credit note (D159), made when the refund succeeded: a link, and the PDF when it exists.
    refundId ? { want: { creditNoteOfRefund: refundId } } : undefined,
  );
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

// ---------------------------------------------------------------------------
// Company accounts (D108)
// ---------------------------------------------------------------------------

/** Where an email about a company is read: the market whose language and address it uses. */
export type EmailMarket = { marketCode: string; locale: string };

/** The invitation to join a company as an employee, with the link that accepts it. */
export async function sendCompanyInvite(
  storeId: string,
  { marketCode, locale }: EmailMarket,
  invite: { id: string; to: string; token: string; inviter: string; company: string; percent: number | null; expiresAt: string },
): Promise<SendOutcome | null> {
  const ctx = await context(storeId, marketCode, locale);
  if (!ctx) return null;
  const { store, market, text } = ctx;
  const c = text.company;
  const url = `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, `/account/company/invite/${invite.token}`)}`;
  const email = renderEmail({
    subject: c.inviteSubject(invite.company, store.name),
    preview: c.inviteHeading(invite.company),
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: c.inviteHeading(invite.company) },
      { type: "paragraph", text: c.inviteIntro(invite.inviter, invite.company, store.name) },
      ...(invite.percent ? [{ type: "paragraph" as const, text: c.inviteDiscount(String(invite.percent)) }] : []),
      { type: "button", text: c.inviteButton, url },
      { type: "paragraph", text: c.inviteExpires(new Date(invite.expiresAt).toLocaleDateString(market.locale, { dateStyle: "medium" })) },
      { type: "paragraph", text: c.inviteIgnore },
    ],
  });
  return sendEmail({
    storeId,
    kind: "company.invite",
    to: invite.to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `company-invite:${invite.id}:${invite.token.slice(0, 8)}`,
  });
}

/**
 * The confirmation once an invitation is accepted: for a new account and for
 * one the person already had, with a link that signs them in once.
 */
export async function sendCompanyJoined(
  storeId: string,
  { marketCode, locale }: EmailMarket,
  joined: { customerId: string; to: string; token: string; company: string; percent: number | null; existing: boolean },
): Promise<SendOutcome | null> {
  const ctx = await context(storeId, marketCode, locale);
  if (!ctx) return null;
  const { store, market, text } = ctx;
  const c = text.company;
  const url = `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, `/account/sign-in/${joined.token}`)}`;
  const email = renderEmail({
    subject: c.joinedSubject(store.name),
    preview: c.joinedHeading(joined.company),
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: c.joinedHeading(joined.company) },
      { type: "paragraph", text: joined.existing ? c.joinedExisting(joined.to) : c.joinedNew(joined.to) },
      ...(joined.percent ? [{ type: "paragraph" as const, text: c.joinedDiscount(String(joined.percent)) }] : []),
      { type: "button", text: c.joinedButton, url },
      { type: "paragraph", text: c.joinedLinkNote },
    ],
  });
  return sendEmail({
    storeId,
    kind: "company.joined",
    to: joined.to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `company-joined:${joined.customerId}:${joined.token.slice(0, 8)}`,
  });
}

/** Told to someone taken out of a company: the company discount no longer applies. */
export async function sendCompanyEnded(
  storeId: string,
  { marketCode, locale }: EmailMarket,
  ended: { key: string; to: string; company: string },
): Promise<SendOutcome | null> {
  const ctx = await context(storeId, marketCode, locale);
  if (!ctx) return null;
  const { store, text } = ctx;
  const c = text.company;
  const email = renderEmail({
    subject: c.endedSubject(ended.company),
    preview: c.endedHeading,
    lang: ctx.lang,
    footer: footer(store, text),
    blocks: [
      { type: "heading", text: c.endedHeading },
      { type: "paragraph", text: c.endedIntro(ended.company, store.name) },
    ],
  });
  return sendEmail({
    storeId,
    kind: "company.ended",
    to: ended.to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `company-ended:${ended.key}`,
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

/**
 * A message from the store to one customer (D104), written with the owner
 * and sent on their yes: the subject and paragraphs as given, in the
 * customer's language's frame, with the store's footer and a reply-to of
 * its contact email; with an order, a link to it too.
 */
export async function sendStoreMessage(
  storeId: string,
  message: { to: string; subject: string; text: string; orderId: string | null; marketCode: string | null; locale: string | null },
): Promise<SendOutcome | null> {
  const store = await storeById(storeId);
  if (!store) return null;
  const market = store.markets.find((m) => m.code === message.marketCode) ?? store.markets[0];
  if (!market) return null;
  const ctx = await context(storeId, market.code, message.locale ?? market.locale);
  if (!ctx) return null;
  const url = message.orderId ? await orderUrl(storeId, ctx.store, ctx.market, message.orderId) : null;
  const paragraphs = message.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const email = renderEmail({
    subject: message.subject,
    preview: paragraphs[0]?.slice(0, 140) ?? message.subject,
    lang: ctx.lang,
    footer: footer(ctx.store, ctx.text),
    blocks: [
      ...paragraphs.map((text) => ({ type: "paragraph" as const, text })),
      ...(url ? [{ type: "button" as const, text: ctx.text.seeOrder, url }] : []),
    ],
  });
  return sendEmail({
    storeId,
    kind: "store.message",
    to: message.to,
    email,
    fromName: ctx.store.name,
    replyTo: ctx.store.details.contactEmail,
    idempotencyKey: `store-message:${crypto.randomUUID()}`,
    orderId: message.orderId,
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
  const ctx = await context(storeId, order.marketCode, order.locale, order.currency);
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
