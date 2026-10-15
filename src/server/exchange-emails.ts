import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText, type EmailText } from "@/lib/email-text";
import { lastDayOf } from "@/lib/exchange";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { formatStoreDay } from "@/lib/return-time";
import { siteUrl } from "@/lib/site";
import type { PlaceholderValues } from "@/lib/email-template";

import { sendEmail, type SendOutcome } from "./email";
import { exchangeLinkFor, exchangeView, type ExchangeView } from "./exchanges";
import { firstNameOf, notificationOn, templatedSlots } from "./notifications";
import { loadFacts, recipientsOf, type OrderFacts } from "./return-facts";
import { emailContext, emailFooter, orderUrl } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The emails of exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md` 2.5). Each goes to the order's own address only (never an address
 * typed anywhere), in the order's language and currency, kept in `email_messages` and idempotent by key. The words are `emailText().exchange` and
 * `.returnLabel` (`src/lib/exchange-email-text.ts`), hand-written nb, sv, da and en, and need legal review. A switchable notification the store turned off
 * (D238) is not sent; `return.exchange_to_pay` and `return.exchanged` are required. The staff alert of a customer's wish goes to the store's contact address
 * and names the order and the return, never the wish's words.
 */

type Ctx = NonNullable<Awaited<ReturnType<typeof emailContext>>>;

type Built = { subject: string; heading: string; intro: string; blocks: EmailBlock[]; values?: PlaceholderValues; button?: { text: string; url: string } | null };

async function mailOf(storeId: string, x: ExchangeView): Promise<{ facts: OrderFacts; ctx: Ctx } | null> {
  const facts = await loadFacts(storeId, x.orderId);
  if (!facts || facts.order.copied) return null;
  const ctx = await emailContext(storeId, facts.marketCode, facts.locale, facts.currency);
  return ctx ? { facts, ctx } : null;
}

/** Sends one customer email of an exchange, with the store's own subject, heading and intro where it set them (D238 4.2). */
async function send(storeId: string, kind: string, key: string, x: ExchangeView, build: (text: EmailText, money: (minor: number) => string, ctx: Ctx, facts: OrderFacts) => Promise<Built> | Built): Promise<SendOutcome | null> {
  if (!(await notificationOn(storeId, kind))) return null;
  const mail = await mailOf(storeId, x);
  if (!mail) return null;
  const { facts, ctx } = mail;
  const [to] = recipientsOf(facts);
  if (!to) return null;
  const { store, market, text } = ctx;
  const money = (minor: number) => formatMoney(minor, x.currency, market.locale);
  const fixed = await build(text, money, ctx, facts);
  const [names] = await db().execute<Row>(sql`
    select shipping_address ->> 'name' as shipping_name, billing_address ->> 'name' as billing_name from commerce.orders
    where store_id = ${storeId}::uuid and id = ${x.orderId}::uuid
  `);
  const slots = await templatedSlots(storeId, kind, ctx.lang, fixed, {
    store_name: store.name,
    order_number: x.orderNumber,
    customer_first_name: firstNameOf(names?.shipping_name as string | null, names?.billing_name as string | null),
    return_number: x.returnNumber,
    ...fixed.values,
  });
  const email = renderEmail({
    subject: slots.subject,
    preview: slots.preview,
    lang: ctx.lang,
    footer: emailFooter(store, text),
    blocks: [
      { type: "heading", text: slots.heading },
      { type: "paragraph", text: slots.intro },
      ...fixed.blocks,
      ...(fixed.button ? [{ type: "button" as const, text: fixed.button.text, url: fixed.button.url }] : []),
    ],
  });
  return sendEmail({ storeId, kind, to, email, fromName: store.name, replyTo: store.details.contactEmail, idempotencyKey: key, orderId: x.orderId });
}

const dayOf = (x: ExchangeView, facts: OrderFacts, locale: string) => (x.expiresAt ? formatStoreDay(lastDayOf(new Date(x.expiresAt), facts.timeZone), locale) : null);

/** The credit's working and the replacements as lines of the email, with the outcome. */
function summary(text: EmailText, money: (minor: number) => string, x: ExchangeView): EmailBlock[] {
  const o = x.outcome;
  return [
    {
      type: "lines",
      rows: [
        ...x.lines.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: money(l.totalMinor), muted: true })),
        ...(x.shippingMinor > 0 ? [{ label: text.shipping, value: money(x.shippingMinor), muted: true }] : []),
        { label: text.exchange.total(""), value: money(x.totalMinor) },
        { label: text.exchange.credit(""), value: money(x.creditAtProcessingMinor ?? x.creditMinor) },
      ].map((row) => ({ ...row, label: row.label.replace(/:\s*$/, "") })),
    },
    { type: "paragraph", text: o.kind === "refund_due" ? text.exchange.outcomeRefund(money(o.refundMinor)) : o.kind === "even" ? text.exchange.outcomeEven : text.exchange.outcomePay(money(o.toPayMinor)) },
  ];
}

/** `return.exchange_proposed`: the page to confirm on, the credit, the replacements, the outcome and the confirm-by date. `n` is the send's number (a new key each send). */
export async function sendExchangeProposed(storeId: string, exchangeId: string, token: string, n: number): Promise<SendOutcome | null> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return null;
  return send(storeId, "return.exchange_proposed", `return.${x.returnId}.exchange.${x.id}.${n}`, x, (text, money, ctx, facts) => {
    const day = dayOf(x, facts, ctx.market.locale);
    return {
      subject: text.exchange.proposedSubject(ctx.store.name, x.returnNumber),
      heading: text.exchange.proposedHeading,
      intro: text.exchange.proposedIntro(ctx.store.name, x.returnNumber),
      blocks: [
        ...summary(text, money, x),
        { type: "paragraph", text: text.exchange.agreement },
        // The fee-free sentence is about the refund's way only; a difference the customer pays is said plainly beside it (review finding, Art. 22).
        ...(x.outcome.toPayMinor > 0 ? [{ type: "paragraph" as const, text: text.exchange.agreementToPay(money(x.outcome.toPayMinor)) }] : []),
        ...(day ? [{ type: "paragraph" as const, text: text.exchange.confirmBy(day) }] : []),
      ],
      button: { text: text.exchange.proposedButton, url: exchangeLinkFor(ctx.store, x.marketSlug, token) },
    };
  });
}

/** `return.exchange_to_pay` (required): the pay step's link, the difference and the pay-by date. */
export async function sendExchangeToPay(storeId: string, exchangeId: string, token: string, n: number): Promise<SendOutcome | null> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return null;
  return send(storeId, "return.exchange_to_pay", `return.${x.returnId}.exchange.${x.id}.pay.${n}`, x, (text, money, ctx, facts) => {
    const day = dayOf(x, facts, ctx.market.locale);
    return {
      subject: text.exchange.toPaySubject(ctx.store.name, x.returnNumber),
      heading: text.exchange.toPayHeading,
      intro: text.exchange.toPayIntro(x.returnNumber),
      blocks: [{ type: "paragraph", text: text.exchange.toPayAmount(money(x.outcome.toPayMinor)) }, ...(day ? [{ type: "paragraph" as const, text: text.exchange.payBy(day) }] : [])],
      button: { text: text.exchange.toPayButton, url: exchangeLinkFor(ctx.store, x.marketSlug, token) },
    };
  });
}

/** `return.exchanged` (required): the new order and its link, what was refunded or paid, the documents. The return's own refund email is not sent as well. */
export async function sendExchanged(storeId: string, exchangeId: string): Promise<SendOutcome | null> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x || x.status !== "settled" || !x.exchangeOrderId) return null;
  return send(storeId, "return.exchanged", `return.${x.returnId}.exchanged`, x, async (text, money, ctx) => {
    const url = await orderUrl(storeId, ctx.store, ctx.market, x.exchangeOrderId!);
    const o = x.outcome;
    return {
      subject: text.exchange.exchangedSubject(ctx.store.name, x.exchangeOrderNumber ?? ""),
      heading: text.exchange.exchangedHeading,
      intro: text.exchange.exchangedIntro(x.returnNumber, x.exchangeOrderNumber ?? ""),
      values: { refund_amount: money(o.refundMinor) },
      blocks: [
        ...(o.refundMinor > 0 ? [{ type: "paragraph" as const, text: text.exchange.exchangedRefund(money(o.refundMinor)) }] : []),
        ...(o.toPayMinor > 0 ? [{ type: "paragraph" as const, text: text.exchange.exchangedPaid(money(o.toPayMinor)) }] : []),
        { type: "paragraph", text: text.exchange.exchangedDocuments },
      ],
      button: url ? { text: text.exchange.exchangedButton, url } : null,
    };
  });
}

/** `return.exchange_lapsed`: a confirmed exchange ended before it was settled; the money comes back as usual. Once per exchange. */
export async function sendExchangeLapsed(storeId: string, exchangeId: string): Promise<SendOutcome | null> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x || !["expired", "cancelled"].includes(x.status) || !x.confirmedAt) return null;
  return send(storeId, "return.exchange_lapsed", `return.${x.returnId}.exchange.${x.id}.lapsed`, x, (text, _money, ctx) => ({
    subject: text.exchange.lapsedSubject(ctx.store.name, x.returnNumber),
    heading: text.exchange.lapsedHeading,
    intro: text.exchange.lapsedIntro(x.returnNumber),
    blocks: [],
  }));
}

/**
 * `return.exchange_wished`: the staff alert that a customer asked for an exchange, to the store's contact address (English, the admin's language), once per
 * return. The order and return numbers and a link to the return; never the wish's words (staff read them in the admin).
 */
export async function sendExchangeWished(storeId: string, returnId: string): Promise<SendOutcome | null> {
  const [r] = await db().execute<Row>(sql`
    select r.number, o.number as order_number, o.id as order_id, s.slug, s.name, s.contact_email
    from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id join commerce.stores s on s.id = r.store_id
    where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
  `);
  if (!r?.contact_email) return null;
  const text = emailText("en");
  const email = renderEmail({
    subject: text.exchange.wishedSubject(String(r.number)),
    preview: text.exchange.wishedIntro(String(r.number), String(r.order_number)),
    lang: "en",
    footer: [String(r.name)],
    blocks: [
      { type: "heading", text: text.exchange.wishedHeading },
      { type: "paragraph", text: text.exchange.wishedIntro(String(r.number), String(r.order_number)) },
      { type: "button", text: text.exchange.wishedButton, url: `${siteUrl()}/admin/${String(r.slug)}/returns/${returnId}` },
    ],
  });
  return sendEmail({
    storeId,
    kind: "return.exchange_wished",
    to: String(r.contact_email),
    email,
    fromName: String(r.name),
    idempotencyKey: `return.${returnId}.exchange_wish`,
    orderId: String(r.order_id),
  });
}

/**
 * `return.label_ready`: a return label was booked (by staff or the job). A button to Kaizen's label route (never the carrier's own address, and never the
 * file as an attachment), the carrier, the tracking number and who pays. A test label says it cannot be used. Once per real label (and once for a test).
 */
export async function sendLabelReady(storeId: string, returnId: string): Promise<SendOutcome | null> {
  if (!(await notificationOn(storeId, "return.label_ready"))) return null;
  const [r] = await db().execute<Row>(sql`
    select r.number, r.order_id, r.public_token, r.label_source, r.label_carrier_id, r.label_tracking_number, r.label_test, r.label_cost_minor
    from commerce.returns r where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
  `);
  if (!r || r.label_source !== "carrier") return null;
  const facts = await loadFacts(storeId, String(r.order_id));
  if (!facts || facts.order.copied) return null;
  const ctx = await emailContext(storeId, facts.marketCode, facts.locale, facts.currency);
  if (!ctx) return null;
  const [to] = recipientsOf(facts);
  if (!to) return null;
  const { store, market, text } = ctx;
  const money = (minor: number) => formatMoney(minor, facts.currency, market.locale);
  const carrierName = r.label_carrier_id === "bring" ? "Posten / Bring" : String(r.label_carrier_id ?? "");
  const cost = r.label_cost_minor === null || r.label_cost_minor === undefined ? null : Number(r.label_cost_minor);
  const fixed = {
    subject: text.returnLabel.readySubject(store.name, String(r.number)),
    heading: text.returnLabel.readyHeading,
    intro: text.returnLabel.readyIntro(String(r.number)),
  };
  const slots = await templatedSlots(storeId, "return.label_ready", ctx.lang, fixed, {
    store_name: store.name,
    order_number: facts.number,
    return_number: String(r.number),
    carrier: carrierName,
    tracking_number: r.label_tracking_number ? String(r.label_tracking_number) : "",
  });
  const email = renderEmail({
    subject: slots.subject,
    preview: slots.preview,
    lang: ctx.lang,
    footer: emailFooter(store, text),
    blocks: [
      { type: "heading", text: slots.heading },
      { type: "paragraph", text: slots.intro },
      ...(r.label_test ? [{ type: "paragraph" as const, text: text.returnLabel.test }] : []),
      { type: "paragraph", text: [text.returnLabel.carrier(carrierName), ...(r.label_tracking_number ? [text.returnLabel.tracking(String(r.label_tracking_number))] : [])].join("\n") },
      {
        type: "paragraph",
        text:
          facts.whoPaysReturn === "store"
            ? text.returnLabel.freeForYou
            : // Nothing is taken off at booking (4.8, As built): only if the parcel goes with this label, and never for a test label.
              !r.label_test && cost !== null && cost > 0
              ? text.returnLabel.costIfUsed(money(cost))
              : text.returns.shopperPays,
      },
      { type: "button", text: text.returnLabel.button, url: `${returnStatusUrl(store, market.slug, String(r.public_token))}/label` },
    ],
  });
  return sendEmail({
    storeId,
    kind: "return.label_ready",
    to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: `return.${returnId}.label${r.label_test ? ".test" : ""}`,
    orderId: facts.orderId,
  });
}

/** The status page of a return, where the customer finds the label (and the exchange). */
export const returnStatusUrl = (store: { slug: string }, marketSlug: string, token: string) => `${storeSiteUrl(store.slug)}${marketPath(store.slug, marketSlug, `/returns/${token}`)}`;
