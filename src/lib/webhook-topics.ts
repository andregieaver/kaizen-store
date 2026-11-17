import { z } from "zod";

import { DISCOUNT_KINDS } from "./discounts";
import { APP_EVENTS, EVENTS, isServiceEvent, type AppEvent, type IntegrationEvent } from "./integrations";
import { SUBSCRIBE_SOURCES, SUBSCRIBER_STATUSES, UNSUBSCRIBE_SOURCES } from "./marketing-consent";
import { DELIVERIES, PRODUCT_KINDS } from "./product-input";
import { VAT_KINDS } from "./vat-treatment";
import { ID_HEADER, PAYLOAD_VERSION, SIGNATURE_HEADER, TIMESTAMP_HEADER, TOLERANCE_SECONDS, TOPIC_HEADER } from "./webhook-signature";
import { jsonSchemaOf, type JsonSchema } from "./openapi";

/**
 * The webhook topics' contracts (wave 14 unit A, D438, `docs/wave-14-developer-platform.md` A3): each topic of `EVENTS` with who may be
 * sent it and the zod of its `data`, the subject under its own name (`order`, `product`, …). `subjectData()` builds each topic's data as
 * these types say and checks it against them on the way out; the catalogue is published at `/api/webhooks/v1/topics.json` and in the
 * Admin API's OpenAPI document (`webhooks`). Amounts in a payload are decimal numbers in the currency's units (199.5, not minor units), as
 * they always were (`PAYLOAD_VERSION` 1). Pure.
 */

const id = z.guid();
const when = z.iso.datetime({ offset: true });
const amount = z.number().describe("An amount in the currency's units, such as 199.5 (not minor units).");
const adminUrl = z.string().describe("Where it is in the store's admin; empty in a sample.");

const ORDER_STATES = ["pending_payment", "authorized", "paid", "fulfilled", "cancelled", "closed"] as const;
const SUBSCRIPTION_STATES = ["pending", "active", "past_due", "paused", "cancelled", "expired"] as const;
const RETURN_STATES = ["requested", "approved", "in_transit", "received", "inspected", "closed", "declined", "cancelled"] as const;
const PRODUCT_STATES = ["draft", "active", "archived"] as const;

const address = z.object({
  name: z.string(),
  line1: z.string(),
  line2: z.string(),
  postal_code: z.string(),
  city: z.string(),
  country: z.string(),
  phone: z.string(),
});

/** What each subject of an event is, as `src/server/integrations.ts` builds it. */
export const WEBHOOK_SUBJECTS = {
  order: z.object({
    id,
    number: z.string(),
    status: z.enum(ORDER_STATES),
    placed_at: when,
    market: z.string().describe("The market's code (its country)."),
    currency: z.string(),
    email: z.string(),
    customer_name: z.string(),
    subtotal: amount,
    shipping: amount,
    discount: amount.describe("Everything taken off: codes, groups, campaigns, credits, a friend's welcome discount and VAT not charged; subtotal + shipping - discount = total."),
    credits_used: amount,
    referral_discount: amount,
    discount_code: z.string(),
    vat: amount,
    vat_kind: z.enum(VAT_KINDS).describe("standard, reverse_charge (a business buyer in another EU country) or ioss."),
    vat_relief: amount.describe("The VAT a reverse-charge order did not charge."),
    total: amount,
    refunded: amount,
    shipping_address: address,
    billing_address: address,
    lines: z.array(z.object({ sku: z.string(), title: z.string(), quantity: z.int(), unit_price: amount, total: amount, delivery: z.enum(DELIVERIES) })),
    shipment: z.object({ carrier: z.string(), tracking_number: z.string(), tracking_url: z.string().nullable() }).nullable().describe("The latest parcel, if one is sent."),
    subscription_id: id.nullable(),
    admin_url: adminUrl,
  }),
  customer: z.object({
    id,
    email: z.string(),
    name: z.string(),
    phone: z.string(),
    email_confirmed: z.boolean(),
    created_at: when,
    admin_url: adminUrl,
  }),
  subscription: z.object({
    id,
    number: z.string(),
    status: z.enum(SUBSCRIPTION_STATES),
    email: z.string(),
    currency: z.string(),
    total_per_renewal: amount,
    every: z.string().describe("How often it renews, such as \"1 month\"."),
    renews_at: when.nullable(),
    started_at: when,
    admin_url: adminUrl,
  }),
  return: z.object({
    id,
    number: z.string(),
    kind: z.enum(["withdrawal", "return"]),
    status: z.enum(RETURN_STATES),
    withdrawal: z.boolean(),
    order_id: id,
    order_number: z.string(),
    currency: z.string(),
    refund: amount.nullable(),
    lines: z.array(z.object({ order_line_id: id, sku: z.string(), title: z.string(), quantity: z.int() })),
    created_at: when,
    admin_url: adminUrl,
  }),
  withdrawal: z.object({
    id,
    order_id: id,
    order_number: z.string(),
    channel: z.string().describe("How the shopper withdrew, such as form or email."),
    confirmed_at: when,
    reference: z.string(),
    admin_url: adminUrl,
  }),
  product: z.object({
    id,
    handle: z.string(),
    title: z.string(),
    status: z.enum(PRODUCT_STATES),
    kind: z.enum(PRODUCT_KINDS),
    variants: z.array(z.object({ id, sku: z.string(), active: z.boolean() })),
    created_at: when,
    updated_at: when,
    admin_url: adminUrl,
  }),
  stock: z.object({
    variant_id: id,
    sku: z.string(),
    product_id: id,
    available: z.number().nullable().describe("What can be sold now."),
    stock_at_crossing: z.number().nullable().describe("The stock when it fell to the low-stock level."),
    crossed_at: when.nullable(),
  }),
  discount: z.object({
    id,
    code: z.string(),
    kind: z.enum(DISCOUNT_KINDS),
    percent: z.number().nullable(),
    amounts: z.record(z.string(), z.number()).nullable().describe("For a fixed amount off: per market, in minor units of the market's currency."),
    starts_at: when.nullable(),
    ends_at: when.nullable(),
    usage_limit: z.number().nullable(),
    admin_url: adminUrl,
  }),
  support: z.object({
    waiting: z.int().describe("How many support conversations wait for a person now. Never who or what they wrote."),
    admin_url: adminUrl,
  }),
  // Wave 14 unit C (D440) -------------------------------------------------------------------------------------------------------------
  fulfilment: z.object({
    id,
    order_id: id,
    order_number: z.string(),
    carrier: z.string(),
    tracking_number: z.string(),
    tracking_url: z.string().nullable(),
    undone: z.boolean().describe("The parcel was undone: it was recorded by mistake, and its units are to send again."),
    tracking: z
      .object({ phase: z.string().describe("Where the parcel is, as the carrier says (D238)."), delivered_at: when.nullable(), updated_at: when })
      .nullable()
      .describe("The carrier's tracking, when the store follows it."),
    lines: z.array(z.object({ order_line_id: id, sku: z.string(), title: z.string(), quantity: z.int() })),
    created_at: when,
    admin_url: adminUrl,
  }),
  refund: z.object({
    id,
    order_id: id,
    order_number: z.string(),
    currency: z.string(),
    amount: amount,
    kind: z.enum(["money", "store_credit"]).describe("money: back to the payment. store_credit: a gift card of the store's (D364)."),
    restocked: z.boolean(),
    created_at: when,
    admin_url: adminUrl,
  }),
  draft: z.object({
    id,
    number: z.string(),
    status: z.enum(["open", "sent", "paid", "expired", "cancelled"]),
    source: z.enum(["staff", "quote"]).describe("staff: made in the admin or over the API. quote: a shopper's request for a quote (D431)."),
    market: z.string(),
    currency: z.string(),
    email: z.string(),
    lines: z.array(z.object({ sku: z.string(), title: z.string(), quantity: z.int(), unit_price: amount.nullable().describe("null for a requested product priced on request with no price yet.") })),
    order_id: id.nullable(),
    expires_at: when.nullable(),
    created_at: when,
    admin_url: adminUrl,
  }),
  contract: z.object({
    id,
    title: z.string(),
    status: z.enum(["sent", "signed", "declined", "expired", "cancelled"]),
    language: z.string(),
    deal_id: id.nullable().describe("The deal it is for; null only for a signed contract whose deal was deleted."),
    template: z.string().nullable().describe("The name of the template it was made from."),
    signers: z
      .array(z.object({ role: z.enum(["store", "customer", "other"]), name: z.string(), signed_at: when.nullable(), declined_at: when.nullable() }))
      .describe("In the order they sign. Never their email or the reason a signer gave for declining."),
    sent_at: when.nullable(),
    expires_at: when.nullable(),
    completed_at: when.nullable().describe("When it was signed by the last signer, or declined."),
    admin_url: adminUrl,
  }),
  form_response: z.object({
    id,
    form_id: id,
    form_name: z.string().describe("The owner's name for the form; never shown on the site."),
    form_kind: z.enum(["message", "signup"]).describe("A message form, or a newsletter sign-up (sent once its address is confirmed)."),
    answers: z.array(z.object({ label: z.string(), value: z.string() })).describe("What the visitor answered, labelled in the owner's language, in the form's order."),
    contact_email: z.string().nullable().describe("The first email address answered, lower case; a sign-up's address."),
    path: z.string().describe("The page it was sent from, a path on the site."),
    locale: z.string(),
    created_at: when,
    admin_url: adminUrl,
  }),
  erasure: z.object({
    customer_id: id.describe("The account that was erased. Nothing else about the person is sent, now or later."),
  }),
  gift_card: z.object({
    id,
    last4: z.string().nullable().describe("The code's last four characters. The code itself is never sent."),
    currency: z.string(),
    initial: amount,
    balance: amount,
    source: z.enum(["order", "staff", "refund"]).describe("Bought with an order, issued by staff, or store credit from a refund (D364)."),
    test: z.boolean(),
    issued_at: when,
    expires_at: when.nullable(),
    admin_url: adminUrl,
  }),
  review: z.object({
    id,
    product_id: id,
    rating: z.int().describe("1 to 5 stars."),
    title: z.string(),
    body: z.string(),
    author_name: z.string().describe("The name the buyer chose to show."),
    status: z.string().describe("pending (waiting for the store's check), published or hidden."),
    verified: z.boolean().describe("Written for an order of the store's."),
    locale: z.string(),
    created_at: when,
    admin_url: adminUrl,
  }),
  inventory: z.object({
    variant_id: id,
    product_id: id,
    sku: z.string(),
    on_hand: z.int().describe("Units on hand across the store's locations."),
    available: z.number().nullable().describe("What can be sold now: on hand less what open orders hold; null for a variant whose stock is not counted."),
    locations: z.array(z.object({ location_id: id, on_hand: z.int() })).describe("Units on hand at each location that has the variant."),
    updated_at: when.describe("When its stock last moved."),
    admin_url: adminUrl,
  }),
  // An A/B test with an answer (D148 phase 15): the store's own verdict and figures, as its page shows them.
  experiment: z.object({
    id,
    name: z.string(),
    goal: z
      .enum(["orders", "revenue", "cart", "checkout", "click", "form", "signup", "page"])
      .describe(
        "What the test counts: paid orders, revenue per visitor, adding to the cart, reaching checkout, a click, a form sent, going on to a chosen page or (Kaizena Flow's own store only) a sign-up to Kaizena Flow.",
      ),
    target: z.object({
      kind: z.enum(["page", "layout", "header", "footer", "role"]).describe("A page, a product layout, the header, the footer, or a page with a place of its own (the front page, the cart, …)."),
      title: z.string(),
      address: z.string().nullable().describe("A page's address on the site, such as /about; null for a page with a place of its own, a header, footer or product layout."),
      part: z.string().nullable().describe("The row or component tested, when only a part of the page was."),
    }),
    status: z.enum(["running", "stopped", "applied", "discarded"]).describe("Where the test is when the event is sent: still running, stopped, a version applied, or the original kept."),
    verdict: z.enum(["better", "worse", "even", "broken", "early", "few"]).describe("better: a version did clearly better; worse: the original did; even: no clear difference; broken: the visitors were not divided as planned; early or few: no answer (yet), which an answered test only shows when it was built again later."),
    best: z.string().nullable().describe("For better: the version that did clearly better (b, c, …); null otherwise."),
    headline: z.string().describe("The verdict in one sentence, in English."),
    days: z.int().describe("Days the test has run."),
    versions: z.array(
      z.object({
        key: z.string().describe("a is the original."),
        name: z.string(),
        visitors: z.int().describe("Visitors counted in the version: only those who accepted statistics cookies."),
        conversions: z.int().nullable().describe("Visitors who did the goal; null for revenue per visitor."),
        rate: z.number().nullable().describe("conversions / visitors as a share (0.112 is 11.2 %); null for revenue per visitor."),
        revenue_per_visitor: amount.nullable().describe("Revenue per visitor without VAT, in the store's main currency; null for the other goals."),
      }),
    ),
    currency: z.string(),
    answered_at: when.nullable(),
    learning: z.string().nullable().describe("What the owner wrote the test taught, once they have."),
    admin_url: adminUrl,
  }),
  // Ecosystem plan E3.2 (D718): the subjects of the events that were missing. Ids and the facts a receiver needs; never a person's
  // message (a reason typed, a rating's comment, a conversation's words) or a secret (a cart's restore link).
  deal: z.object({
    id,
    title: z.string(),
    status: z.enum(["open", "won", "lost"]),
    pipeline: z.object({ id, name: z.string() }),
    stage: z.object({ id, name: z.string(), position: z.int().describe("Its place in the pipeline, from 0.") }),
    value: amount.nullable().describe("What the deal is worth in `currency`: its linked orders', quotes' and Work assignments' amounts, or the estimate while nothing is linked; null when there is neither."),
    currency: z.string().describe("The store's main currency, which `value` is in."),
    customer_id: id.nullable(),
    company_id: id.nullable(),
    owner_id: id.nullable().describe("The staff member who owns the deal."),
    expected_close_on: z.string().nullable().describe("A date, YYYY-MM-DD."),
    closed_at: when.nullable(),
    closed_via: z.enum(["person", "order", "work_invoice", "platform", "contract"]).nullable().describe("What closed it: a person, a paid order, an issued Work invoice, Kaizena Flow's own records or a signed contract."),
    stage_entered_at: when,
    created_at: when,
    admin_url: adminUrl,
  }),
  subscriber: z.object({
    id,
    email: z.string(),
    status: z.enum(SUBSCRIBER_STATUSES),
    source: z.enum(SUBSCRIBE_SOURCES).describe("Where they joined: a page's form, checkout, their account, or moved in from Shopify or WooCommerce."),
    unsubscribe_source: z.enum(UNSUBSCRIBE_SOURCES).nullable().describe("How they left: an email's link or one-click button, their account, staff, a complaint or a bounce."),
    customer_id: id.nullable().describe("The store's customer, only when a signed-in customer with a proven email subscribed."),
    locale: z.string(),
    market: z.string().nullable(),
    consented_at: when,
    confirmed_at: when.nullable(),
    unsubscribed_at: when.nullable(),
    admin_url: adminUrl,
  }),
  conversation: z.object({
    id,
    source: z.enum(["site", "email", "form"]).describe("The site's chat, an email to the desk, or the site's email form."),
    status: z.enum(["open", "ended"]),
    handler: z.enum(["ai", "queue", "human"]).describe("Who had it last: the AI, the queue for a person, or a person."),
    ended_by: z.enum(["customer", "agent", "timeout", "system"]).nullable(),
    rating: z.enum(["good", "bad"]).nullable().describe("The customer's rating. Never the comment they wrote."),
    escalation: z.string().nullable().describe("Why a person had to answer, as the AI named it when it handed over."),
    customer_id: id.nullable().describe("The signed-in customer, when there was one."),
    market: z.string().nullable(),
    locale: z.string(),
    messages: z.int().describe("How many messages it holds."),
    created_at: when,
    first_answer_at: when.nullable().describe("When a person first answered."),
    ended_at: when.nullable(),
    admin_url: adminUrl,
  }),
  checkout: z.object({
    id,
    cart_id: id,
    order_id: id.nullable().describe("The order waiting for payment that checkout made."),
    email: z.string().nullable().describe("The address typed at checkout; null once it is erased (opted out, or 30 days on)."),
    market: z.string(),
    locale: z.string(),
    currency: z.string(),
    subtotal: amount,
    lines: z.array(z.object({ variant_id: id, sku: z.string(), title: z.string(), quantity: z.int(), unit_price: amount })),
    captured_at: when.nullable(),
    abandoned_at: when.nullable(),
    recovered: z.boolean().describe("It was bought since."),
    admin_url: adminUrl,
  }),
  work_client: z.object({
    id,
    name: z.string(),
    legal_name: z.string().nullable(),
    organisation_number: z.string().nullable(),
    vat_number: z.string().nullable(),
    country: z.string().nullable(),
    business: z.boolean(),
    currency: z.string(),
    vat_treatment: z.enum(["domestic", "reverse_charge", "outside_scope", "exempt"]),
    customer_id: id.nullable(),
    company_id: id.nullable(),
    archived: z.boolean(),
    created_at: when,
    admin_url: adminUrl,
  }),
  work_invoice: z.object({
    id,
    number: z.string().nullable().describe("The invoice's number, such as W-1042; null for a draft."),
    status: z.enum(["draft", "sent", "paid", "void", "lost"]),
    client_id: id,
    assignment_id: id.nullable(),
    currency: z.string(),
    subtotal: amount,
    vat: amount,
    total: amount,
    paid: amount.describe("What payments have covered."),
    credited: amount.describe("What credit notes have taken off."),
    issued_on: z.string().nullable().describe("A date, YYYY-MM-DD."),
    due_on: z.string().nullable().describe("A date, YYYY-MM-DD."),
    sent_at: when.nullable(),
    paid_at: when.nullable(),
    admin_url: adminUrl,
  }),
  // An app's installation on the store (D441 D2): what app.uninstalled and store.erase_requested are about.
  installation: z.object({
    id: id.describe("The installation's id, as the app was given it when it was installed (the grant)."),
    client_id: z.string().describe("The app's client ID."),
    removed_at: when.describe("When the app was removed from the store."),
  }),
} as const;

export type WebhookSubjectName = keyof typeof WEBHOOK_SUBJECTS;
/** A subject as its builder makes it. */
export type WebhookSubject<S extends WebhookSubjectName> = z.input<(typeof WEBHOOK_SUBJECTS)[S]>;

/** The subject each topic is about. */
const SUBJECT_OF: Record<IntegrationEvent | AppEvent, WebhookSubjectName> = {
  "order.paid": "order",
  "order.sent": "order",
  "order.cancelled": "order",
  "order.refunded": "order",
  "customer.created": "customer",
  "subscription.started": "subscription",
  "subscription.cancelled": "subscription",
  "support.waiting": "support",
  "return.requested": "return",
  "withdrawal.received": "withdrawal",
  "product.created": "product",
  "product.updated": "product",
  "stock.low": "stock",
  "discount.created": "discount",
  "inventory.updated": "inventory",
  "product.archived": "product",
  "order.created": "order",
  "order.updated": "order",
  "fulfilment.created": "fulfilment",
  "fulfilment.updated": "fulfilment",
  "refund.created": "refund",
  "return.updated": "return",
  "quote.requested": "draft",
  "draft.sent": "draft",
  "customer.updated": "customer",
  "customer.erased": "erasure",
  "subscription.renewed": "subscription",
  "subscription.payment_failed": "subscription",
  "gift_card.issued": "gift_card",
  "review.created": "review",
  "experiment.answered": "experiment",
  "contract.sent": "contract",
  "contract.signed": "contract",
  "contract.declined": "contract",
  "deal.created": "deal",
  "deal.stage_changed": "deal",
  "deal.won": "deal",
  "deal.lost": "deal",
  "subscriber.subscribed": "subscriber",
  "subscriber.unsubscribed": "subscriber",
  "conversation.ended": "conversation",
  "conversation.rated": "conversation",
  "review.published": "review",
  "checkout.abandoned": "checkout",
  "work_client.created": "work_client",
  "work_invoice.sent": "work_invoice",
  "work_invoice.paid": "work_invoice",
  "work_invoice.credited": "work_invoice",
  "form.response": "form_response",
  "app.uninstalled": "installation",
  "store.erase_requested": "installation",
};

/**
 * The area a subject is read in (D441): an app's installation is sent a topic only while its scopes read that area (`orders:read`, …).
 * A subject not here is never an app's to choose.
 */
export const SUBJECT_READ_AREA: Partial<Record<WebhookSubjectName, string>> = {
  order: "orders",
  subscription: "orders",
  return: "orders",
  withdrawal: "orders",
  fulfilment: "orders",
  refund: "orders",
  draft: "orders",
  customer: "customers",
  erasure: "customers",
  contract: "customers",
  form_response: "customers",
  product: "products",
  stock: "products",
  inventory: "products",
  support: "support",
  discount: "marketing",
  gift_card: "marketing",
  review: "marketing",
  experiment: "marketing",
  // Ecosystem plan E3.2 (D718). Work's clients and invoices are the owner's, read at the owner's level, never an app's to choose.
  deal: "customers",
  subscriber: "marketing",
  conversation: "support",
  checkout: "orders",
};

/**
 * Who may be sent a topic: the services (Zapier, Make and Slack, D41), an owner's own endpoints (D354), and apps installed on the store
 * (D441: a topic an app chose whose area its installation reads, and the two that are an app's own).
 */
export type WebhookReceiver = "services" | "endpoints" | "apps";

export type WebhookTopic = {
  id: IntegrationEvent | AppEvent;
  title: string;
  description: string;
  receivers: WebhookReceiver[];
  subject: WebhookSubjectName;
  /** The payload's `data`: the subject under its own name. */
  data: z.ZodObject;
};

const dataOf = (subject: WebhookSubjectName) => z.object({ [subject]: WEBHOOK_SUBJECTS[subject] });

export const WEBHOOK_TOPICS: WebhookTopic[] = [
  ...EVENTS.map((event): WebhookTopic => ({
    id: event.id,
    title: event.label,
    description: event.hint,
    receivers: [...(isServiceEvent(event.id) ? (["services"] as const) : []), "endpoints", ...(SUBJECT_READ_AREA[SUBJECT_OF[event.id]] ? (["apps"] as const) : [])],
    subject: SUBJECT_OF[event.id],
    data: dataOf(SUBJECT_OF[event.id]),
  })),
  ...APP_EVENTS.map((event): WebhookTopic => ({
    id: event.id,
    title: event.label,
    description: event.hint,
    receivers: ["apps"],
    subject: SUBJECT_OF[event.id],
    data: dataOf(SUBJECT_OF[event.id]),
  })),
];

export const topicOf = (id: string): WebhookTopic | undefined => WEBHOOK_TOPICS.find((t) => t.id === id);

/** What a test sends (`Send a test`): the store's latest paid order, or a sample with the same fields. */
export const WEBHOOK_TEST_DATA = z.object({ test: z.literal(true), order: WEBHOOK_SUBJECTS.order });

/** When a delivery that was not taken is tried again (seconds after each failed try); after the last, it has failed. */
export const WEBHOOK_RETRY_SECONDS = [60, 300, 1800, 7200, 21600] as const;
/** How long a receiver has to answer. */
export const WEBHOOK_TIMEOUT_SECONDS = 10;

const spoken = (seconds: number) => (seconds < 3600 ? `${seconds / 60} minute${seconds === 60 ? "" : "s"}` : `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`);

/** The body an endpoint receives (D354): the same envelope for every topic. */
export const webhookEnvelope = (topic: z.ZodType, data: z.ZodType) =>
  z.object({
    id: id.describe("The delivery's id: the same when a delivery is sent again, so a receiver can do it once."),
    topic,
    version: z.literal(PAYLOAD_VERSION).describe("The payload's version; a change to a shape raises it."),
    store: z.object({ slug: z.string(), name: z.string() }),
    created_at: when.describe("When the event happened."),
    data,
  });

/** The headers every delivery carries. */
export const WEBHOOK_HEADERS = [
  { name: ID_HEADER, description: "The delivery's id, as the body's `id`: the same when a delivery is sent again." },
  { name: TIMESTAMP_HEADER, description: "When it was signed, in whole seconds since 1970 (UTC)." },
  { name: TOPIC_HEADER, description: "The topic, as the body's `topic`." },
  { name: SIGNATURE_HEADER, description: "`v1=` and the HMAC-SHA256, in lowercase hex, of `{timestamp}.{body}` with the endpoint's secret; several, separated by commas, while a secret is renewed." },
] as const;

/** How a receiver checks a delivery, the same steps as `verifyWebhook()`. */
export const SIGNATURE_STEPS = [
  "Read the body as it arrived, before parsing it: the signature is over the exact bytes.",
  `Take ${TIMESTAMP_HEADER} and refuse the delivery when it is more than ${TOLERANCE_SECONDS} seconds from your own clock, so a captured delivery cannot be played again later.`,
  "Compute the HMAC-SHA256 of the timestamp, a full stop and the body (`{timestamp}.{body}`) with the endpoint's secret, as lowercase hex, and put `v1=` before it.",
  `Compare it, in constant time, with each signature in ${SIGNATURE_HEADER} (separated by commas or spaces): one match is enough.`,
  `Answer with any 2xx status within ${WEBHOOK_TIMEOUT_SECONDS} seconds. Do the work once per ${ID_HEADER}: a delivery that is tried again, or sent again by hand, keeps its id.`,
] as const;

/** The public catalogue (`/api/webhooks/v1/topics.json`): every topic with its payload's JSON Schema, the headers and the signature steps. */
export function webhookCatalogue() {
  return {
    version: PAYLOAD_VERSION,
    description: `Events a store sends to its owner's own HTTPS endpoints, to the apps installed on it (the topics marked apps: those an app chose whose area its installation reads, and app.uninstalled and store.erase_requested, which every installed app is sent) and, for the topics marked services, to Zapier, Make and Slack. Each delivery is a POST of JSON, signed, and tried again when it is not taken: after ${WEBHOOK_RETRY_SECONDS.map(spoken).join(", ")}.`,
    retry_seconds: [...WEBHOOK_RETRY_SECONDS],
    timeout_seconds: WEBHOOK_TIMEOUT_SECONDS,
    headers: WEBHOOK_HEADERS.map((h) => ({ ...h })),
    signature: {
      algorithm: "HMAC-SHA256",
      header: SIGNATURE_HEADER,
      format: "v1={hex}",
      signed: "{timestamp}.{body}",
      tolerance_seconds: TOLERANCE_SECONDS,
      steps: [...SIGNATURE_STEPS],
    },
    envelope: jsonSchemaOf(webhookEnvelope(z.string().describe("The topic."), z.object({}).describe("What the event is about, under its own name."))),
    topics: WEBHOOK_TOPICS.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      receivers: t.receivers,
      subject: t.subject,
      data: jsonSchemaOf(t.data),
    })),
    test: { description: "What Send a test delivers: `data.test` is true and `data.order` the store's latest paid order, or a sample.", data: jsonSchemaOf(WEBHOOK_TEST_DATA) },
  };
}

/** The topics as the `webhooks` of an OpenAPI 3.1 document: each a POST to the receiver's address with its payload. */
export function webhookOpenApi(): Record<string, JsonSchema> {
  const parameters = WEBHOOK_HEADERS.map((h) => ({ name: h.name, in: "header", required: true, description: h.description, schema: { type: "string" } }));
  return Object.fromEntries(
    WEBHOOK_TOPICS.map((t) => [
      t.id,
      {
        post: {
          operationId: `webhook.${t.id}`,
          summary: t.title,
          description: `${t.description} Sent to ${t.receivers.join(" and ")}.`,
          tags: ["Webhooks"],
          parameters,
          requestBody: { required: true, content: { "application/json": { schema: jsonSchemaOf(webhookEnvelope(z.literal(t.id), t.data)) } } },
          responses: { "200": { description: `Any 2xx status takes the delivery; anything else, or no answer within ${WEBHOOK_TIMEOUT_SECONDS} seconds, is tried again later.` } },
        },
      },
    ]),
  );
}
