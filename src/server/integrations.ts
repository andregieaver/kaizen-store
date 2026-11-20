import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  checkWebhookUrl,
  isAppEvent,
  isEvent,
  isServiceEvent,
  webhookHint,
  type IntegrationEvent,
  type Provider,
} from "@/lib/integrations";
import { storeZoneOf } from "@/lib/dates";
import { mainCurrency } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import { escapeSlack, slackMessage } from "@/lib/slack";
import { ID_HEADER, PAYLOAD_VERSION, signWebhook, SIGNATURE_HEADER, TIMESTAMP_HEADER, TOPIC_HEADER } from "@/lib/webhook-signature";
import { topicOf, WEBHOOK_RETRY_SECONDS, WEBHOOK_TIMEOUT_SECONDS, type WebhookSubject } from "@/lib/webhook-topics";

import { audit, type Membership } from "./auth";
import { notifyEndpointOff } from "./endpoint-emails";
import { log } from "./log";
import { getOrder, type Address } from "./orders";
import { safeFetch } from "./replicate-fetch";
import { encryptionKey } from "./encryption-key";
import { col, typedRow } from "./typed-rows";
import { FAILING_DAYS, openEndpoint } from "./webhook-endpoints";

type Row = Record<string, unknown>;

/**
 * Integrations (decision D41): a store connects Zapier or Make by giving
 * the webhook address the service made for it, and chooses which events
 * to send. The database queues each event as it happens (see the rules
 * migration); a job every minute builds its content and sends it, trying
 * again later when the service does not take it. Deliveries are kept 30
 * days, for the log and retries. Slack (D101) gets the same events as
 * messages (`slackMessage()`), and only those are kept for it.
 */

/** When to try again after each failed try; after the last, the delivery has failed (published in the topics' catalogue, D438). */
export const RETRY_SECONDS: readonly number[] = WEBHOOK_RETRY_SECONDS;
const TIMEOUT_MS = WEBHOOK_TIMEOUT_SECONDS * 1000;
const KEEP_DAYS = 30;

export type StoreIntegration = {
  provider: Provider;
  enabled: boolean;
  hint: string;
  events: IntegrationEvent[];
  updatedAt: string;
};

export type IntegrationStatus = StoreIntegration & {
  lastDelivery: { status: DeliveryStatus; at: string } | null;
  /** Deliveries that gave up in the last 7 days. */
  recentFailures: number;
};

function toIntegration(row: Row): StoreIntegration {
  return {
    provider: row.provider as Provider,
    enabled: Boolean(row.enabled),
    hint: String(row.webhook_hint),
    events: ((row.events ?? []) as string[]).filter(isEvent),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/** The store's integrations, each with how its last delivery went. */
export async function listIntegrations(storeId: string): Promise<IntegrationStatus[]> {
  const rows = await db().execute<Row>(sql`
    select i.*, last.status as last_status, last.created_at as last_at,
      (select count(*)::int from commerce.integration_deliveries d
        where d.store_id = i.store_id and d.provider = i.provider and d.status = 'failed'
          and d.created_at > now() - interval '7 days') as recent_failures
    from commerce.store_integrations i
    left join lateral (
      select status, created_at from commerce.integration_deliveries d
      where d.store_id = i.store_id and d.provider = i.provider
      order by created_at desc limit 1
    ) last on true
    where i.store_id = ${storeId}::uuid
  `);
  return rows.map((row) => ({
    ...toIntegration(row),
    lastDelivery: row.last_status
      ? { status: row.last_status as DeliveryStatus, at: new Date(String(row.last_at)).toISOString() }
      : null,
    recentFailures: Number(row.recent_failures),
  }));
}

export async function getIntegration(storeId: string, provider: Provider): Promise<StoreIntegration | null> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.store_integrations where store_id = ${storeId}::uuid and provider = ${provider}
  `);
  return row ? toIntegration(row) : null;
}

export type SaveResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Connects the service, or changes what it gets. A new webhook address
 * replaces the old one; left empty, the old one stays.
 */
export async function saveIntegration(
  { account, store }: Membership,
  provider: Provider,
  input: { url: string; events: string[]; enabled: boolean },
): Promise<SaveResult> {
  const events = [...new Set(input.events.filter(isServiceEvent))];
  const existing = await getIntegration(store.id, provider);
  let encrypted: string | null = null;
  let hint: string | null = null;
  if (input.url.trim()) {
    const checked = checkWebhookUrl(provider, input.url);
    if (!checked.ok) return { ok: false, problems: [checked.problem] };
    const key = encryptionKey();
    if (!key) return { ok: false, problems: ["Kaizena Flow cannot keep the address safe right now, so it was not saved. Try again later."] };
    encrypted = encryptSecret(checked.url, key);
    hint = webhookHint(checked.url);
  } else if (!existing) {
    return { ok: false, problems: ["Paste the webhook address from the service."] };
  }
  if (events.length === 0) return { ok: false, problems: ["Choose at least one event to send."] };
  await keepIntegration({ account, store }, provider, { encrypted, hint, events, enabled: input.enabled });
  return { ok: true };
}

/** The events a newly connected service gets until the owner chooses. */
export const DEFAULT_EVENTS: IntegrationEvent[] = ["order.paid", "order.sent", "order.refunded", "customer.created"];

/**
 * Connects Slack with the webhook Slack made when the owner added Kaizen's
 * Slack app to a channel (D101): switched on, with the events it had or the
 * usual ones, and the channel as its hint.
 */
export async function connectSlackWebhook(
  { account, store }: Membership,
  webhook: { url: string; channel: string; team: string },
): Promise<SaveResult> {
  const checked = checkWebhookUrl("slack", webhook.url);
  if (!checked.ok) return { ok: false, problems: [checked.problem] };
  const key = encryptionKey();
  if (!key) return { ok: false, problems: ["Kaizena Flow cannot keep the address safe right now, so it was not saved. Try again later."] };
  const existing = await getIntegration(store.id, "slack");
  const channel = webhook.channel.trim() || "a channel";
  const hint = webhook.team.trim() ? `${channel} in ${webhook.team.trim()}` : channel;
  await keepIntegration({ account, store }, "slack", {
    encrypted: encryptSecret(checked.url, key),
    hint: hint.slice(0, 120),
    events: existing?.events.length ? existing.events : DEFAULT_EVENTS,
    enabled: true,
  });
  return { ok: true };
}

async function keepIntegration(
  { account, store }: Pick<Membership, "account" | "store">,
  provider: Provider,
  { encrypted, hint, events, enabled }: { encrypted: string | null; hint: string | null; events: IntegrationEvent[]; enabled: boolean },
): Promise<void> {
  await db().execute(sql`
    insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events, updated_by)
    values (${store.id}::uuid, ${provider}, ${enabled}, ${encrypted ?? ""}, ${hint ?? ""},
      array[${sql.join(events.map((event) => sql`${event}`), sql`, `)}]::text[], ${account.id}::uuid)
    on conflict (store_id, provider) do update set
      enabled = excluded.enabled,
      webhook_url_encrypted = coalesce(nullif(excluded.webhook_url_encrypted, ''), store_integrations.webhook_url_encrypted),
      webhook_hint = coalesce(nullif(excluded.webhook_hint, ''), store_integrations.webhook_hint),
      events = excluded.events, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(account.id, store.id, "integration.saved", { provider, enabled, events, newAddress: Boolean(encrypted) });
}

/** Disconnects the service: its address and settings go; deliveries waiting are dropped. */
export async function removeIntegration({ account, store }: Membership, provider: Provider): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.store_integrations where store_id = ${store.id}::uuid and provider = ${provider} returning provider
  `);
  await db().execute(sql`
    update commerce.integration_deliveries set status = 'failed', last_error = 'Disconnected'
    where store_id = ${store.id}::uuid and provider = ${provider} and status = 'pending'
  `);
  if (rows.length > 0) await audit(account.id, store.id, "integration.removed", { provider });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// What is sent
// ---------------------------------------------------------------------------

const amount = (minor: number, currency: string) => minor / 10 ** minorUnitDigits(currency);

function address(a: Address) {
  return {
    name: a.name ?? "",
    line1: a.line1 ?? "",
    line2: a.line2 ?? "",
    postal_code: a.postalCode ?? "",
    city: a.city ?? "",
    country: a.country ?? "",
    phone: a.phone ?? "",
  };
}

async function orderData(storeId: string, storeSlug: string, orderId: string): Promise<WebhookSubject<"order"> | null> {
  const order = await getOrder(storeId, orderId);
  if (!order) return null;
  const [extra] = await db().execute<Row>(sql`
    select
      (select json_build_object('carrier', s.carrier, 'tracking_number', s.tracking_number, 'tracking_url', s.tracking_url)
         from commerce.shipments s where s.store_id = ${storeId}::uuid and s.order_id = ${orderId}::uuid and s.undone_at is null
         order by s.created_at desc limit 1) as shipment,
      (select coalesce(sum(r.amount_minor), 0)::bigint from commerce.refunds r
         join commerce.payments p on p.id = r.payment_id
         where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and r.status = 'succeeded') as refunded
  `);
  const money = (minor: number) => amount(minor, order.currency);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    placed_at: order.placedAt,
    market: order.marketCode,
    currency: order.currency,
    email: order.email,
    customer_name: order.billingAddress.name || order.shippingAddress.name || "",
    subtotal: money(order.subtotalMinor),
    shipping: money(order.shippingMinor),
    // Bonus credits used (D130), the friend's welcome discount (D131) and the VAT a reverse-charge order did not charge (D157) are
    // part of the discount, so subtotal + shipping - discount is still the total.
    discount: money(order.discountMinor + order.referralDiscountMinor + order.creditMinor + order.vatReliefMinor),
    credits_used: money(order.creditMinor),
    referral_discount: money(order.referralDiscountMinor),
    discount_code: order.discountCode ?? "",
    vat: money(order.taxMinor),
    // The VAT treatment (D157): its kind and the VAT not charged. Never a VAT number or VIES's answer.
    vat_kind: order.vatKind,
    vat_relief: money(order.vatReliefMinor),
    total: money(order.totalMinor),
    refunded: money(Number(extra?.refunded ?? 0)),
    shipping_address: address(order.shippingAddress),
    billing_address: address(order.billingAddress),
    lines: order.lines.map((line) => ({
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      unit_price: money(line.unitPriceMinor),
      total: money(line.totalMinor),
      delivery: line.delivery,
    })),
    shipment: (extra?.shipment as WebhookSubject<"order">["shipment"]) ?? null,
    subscription_id: order.subscriptionId,
    admin_url: `${siteUrl()}/admin/${storeSlug}/orders/${order.id}`,
  };
}

async function customerData(storeId: string, storeSlug: string, customerId: string): Promise<WebhookSubject<"customer"> | null> {
  const [row] = await db().execute<Row>(sql`
    select id, email, name, phone, created_at, email_verified_at is not null as verified
    from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    email_confirmed: Boolean(row.verified),
    created_at: new Date(String(row.created_at)).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/customers/${String(row.id)}`,
  };
}

async function subscriptionData(storeId: string, storeSlug: string, subscriptionId: string): Promise<WebhookSubject<"subscription"> | null> {
  const [row] = await db().execute<Row>(sql`
    select id, number, status, email, currency, total_minor, interval, interval_count, current_period_end, created_at
    from commerce.subscriptions where store_id = ${storeId}::uuid and id = ${subscriptionId}::uuid
  `);
  if (!row) return null;
  const currency = String(row.currency);
  return {
    id: String(row.id),
    number: String(row.number),
    status: String(row.status) as WebhookSubject<"subscription">["status"],
    email: String(row.email),
    currency,
    total_per_renewal: amount(Number(row.total_minor), currency),
    every: `${Number(row.interval_count)} ${String(row.interval)}`,
    renews_at: row.current_period_end ? new Date(String(row.current_period_end)).toISOString() : null,
    started_at: new Date(String(row.created_at)).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/subscriptions/${String(row.id)}`,
  };
}

/**
 * What an event is about, as it is now; null when it is gone (or the event has no subject the services are sent). Workflows (D356) test it
 * too. Each subject is built as its topic's contract says (`WEBHOOK_TOPICS`, D438) and checked against it: a payload of another shape is
 * logged with where it differs (never a value) and sent as built, so a drift is found without a delivery being held back.
 */
export async function subjectData(
  store: { id: string; slug: string; name: string },
  event: string,
  subjectId: string | null,
): Promise<Record<string, unknown> | null> {
  const data = await buildSubject(store, event, subjectId);
  const topic = topicOf(event);
  if (data && topic) {
    const checked = topic.data.safeParse(data);
    if (!checked.success) {
      const at = [...new Set(checked.error.issues.map((i) => i.path.map((p) => (typeof p === "number" ? "#" : String(p))).join(".")))].slice(0, 5);
      log("error", "webhooks.payload_shape", { storeId: store.id, topic: event, at: at.join(" ") });
    }
  }
  return data;
}

async function buildSubject(store: { id: string; slug: string; name: string }, event: string, subjectId: string | null): Promise<Record<string, unknown> | null> {
  if (event === "support.waiting") return { support: await supportWaitingData(store.id, store.slug) };
  if (!subjectId) return null;
  if (event.startsWith("order.")) {
    const order = await orderData(store.id, store.slug, subjectId);
    return order && { order };
  }
  // An erased customer (D162) is gone: only its id, never read again.
  if (event === "customer.erased") return { erasure: { customer_id: subjectId } };
  // An app removed from the store (D441 D2): its installation, kept 90 days after it ended.
  if (isAppEvent(event)) {
    const installation = await installationData(store.id, subjectId);
    return installation && { installation };
  }
  if (event === "customer.created" || event === "customer.updated") {
    const customer = await customerData(store.id, store.slug, subjectId);
    return customer && { customer };
  }
  if (event.startsWith("subscription.")) {
    const subscription = await subscriptionData(store.id, store.slug, subjectId);
    return subscription && { subscription };
  }
  if (event === "return.requested" || event === "return.updated") {
    const value = await returnData(store.id, store.slug, subjectId);
    return value && { return: value };
  }
  if (event === "withdrawal.received") {
    const withdrawal = await withdrawalData(store.id, store.slug, subjectId);
    return withdrawal && { withdrawal };
  }
  if (event.startsWith("product.")) {
    const product = await productData(store.id, store.slug, subjectId);
    return product && { product };
  }
  if (event === "stock.low") {
    const stock = await stockData(store.id, subjectId);
    return stock && { stock };
  }
  if (event === "discount.created") {
    const discount = await discountData(store.id, store.slug, subjectId);
    return discount && { discount };
  }
  if (event === "inventory.updated") {
    const inventory = await inventoryData(store.id, store.slug, subjectId);
    return inventory && { inventory };
  }
  if (event.startsWith("fulfilment.")) {
    const fulfilment = await fulfilmentData(store.id, store.slug, subjectId);
    return fulfilment && { fulfilment };
  }
  if (event === "refund.created") {
    const refund = await refundData(store.id, store.slug, subjectId);
    return refund && { refund };
  }
  if (event === "gift_card.issued") {
    const gift_card = await giftCardData(store.id, store.slug, subjectId);
    return gift_card && { gift_card };
  }
  if (event === "review.created") {
    const review = await reviewData(store.id, store.slug, subjectId);
    return review && { review };
  }
  if (event === "experiment.answered") {
    const experiment = await experimentData(store.slug, subjectId);
    return experiment && { experiment };
  }
  if (event === "quote.requested" || event === "draft.sent") {
    const draft = await draftData(store.id, store.slug, subjectId);
    return draft && { draft };
  }
  if (event.startsWith("contract.")) {
    const contract = await contractData(store.id, store.slug, subjectId);
    return contract && { contract };
  }
  // Ecosystem plan E3.2 (D718).
  if (event.startsWith("deal.")) {
    const deal = await dealData(store.slug, subjectId);
    return deal && { deal };
  }
  if (event.startsWith("subscriber.")) {
    const subscriber = await subscriberData(store.id, store.slug, subjectId);
    return subscriber && { subscriber };
  }
  if (event.startsWith("conversation.")) {
    const conversation = await conversationData(store.id, store.slug, subjectId);
    return conversation && { conversation };
  }
  if (event === "review.published") {
    const review = await reviewData(store.id, store.slug, subjectId);
    return review && { review };
  }
  if (event === "checkout.abandoned") {
    const checkout = await checkoutData(store.id, store.slug, subjectId);
    return checkout && { checkout };
  }
  if (event === "work_client.created") {
    const work_client = await workClientData(store.id, store.slug, subjectId);
    return work_client && { work_client };
  }
  if (event.startsWith("work_invoice.")) {
    const work_invoice = await workInvoiceData(store.id, store.slug, subjectId);
    return work_invoice && { work_invoice };
  }
  if (event === "form.response") {
    const form_response = await formResponseData(store.id, store.slug, subjectId);
    return form_response && { form_response };
  }
  // Email plan M1.2 (D732).
  if (event.startsWith("email.")) {
    const email = await emailData(store.id, store.slug, subjectId);
    return email && { email };
  }
  if (event === "broadcast.sent") {
    const broadcast = await broadcastData(store.id, store.slug, subjectId);
    return broadcast && { broadcast };
  }
  if (event === "marketing.paused") {
    const sending_pause = await sendingPauseData(store.id, store.slug, subjectId);
    return sending_pause && { sending_pause };
  }
  // Ecosystem plan E5.1 (D757).
  if (event.startsWith("activity.")) {
    const activity = await activityData(store.id, store.slug, subjectId);
    return activity && { activity };
  }
  if (event.startsWith("lead.")) {
    const lead = await leadData(store.id, store.slug, subjectId);
    return lead && { lead };
  }
  if (event.startsWith("domain.")) {
    const domain = await domainData(store.id, store.slug, subjectId);
    return domain && { domain };
  }
  return null;
}

/**
 * A call, a meeting or a task (ecosystem plan E5.1, D757, `activity.*`): when, for whom and about whom, as ids. Never its note. It opens on
 * its deal's page, or its customer's or company's, or Home's *Today*.
 */
async function activityData(storeId: string, storeSlug: string, activityId: string): Promise<WebhookSubject<"activity"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      kind: z.enum(["call", "meeting", "task"]),
      title: col.text,
      due_at: col.timestamp,
      timed: col.bool,
      duration_minutes: col.int.nullable(),
      done_at: col.timestampOrNull,
      assignee_id: col.uuid.nullable(),
      done_by: col.uuid.nullable(),
      customer_id: col.uuid.nullable(),
      company_id: col.uuid.nullable(),
      deal_id: col.uuid.nullable(),
      created_at: col.timestamp,
    }),
    sql`
      select id, kind, title, due_at, timed, duration_minutes, done_at, assignee_id, done_by, customer_id, company_id, deal_id, created_at
      from commerce.activities where store_id = ${storeId}::uuid and id = ${activityId}::uuid
    `,
  );
  if (!row) return null;
  const base = `${siteUrl()}/admin/${storeSlug}`;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    due_at: row.due_at,
    timed: row.timed,
    duration_minutes: row.duration_minutes,
    done_at: row.done_at,
    assignee_id: row.assignee_id,
    done_by: row.done_by,
    customer_id: row.customer_id,
    company_id: row.company_id,
    deal_id: row.deal_id,
    created_at: row.created_at,
    admin_url: row.deal_id
      ? `${base}/deals/${row.deal_id}`
      : row.customer_id
        ? `${base}/customers/${row.customer_id}`
        : row.company_id
          ? `${base}/companies/${row.company_id}`
          : base,
  };
}

/**
 * Staff's decision about a lead (ecosystem plan E5.1, D757, `lead.*`): dismissed, or made a deal of, with the deal, the store's customer of
 * the address and what the person asked for, as ids. Never the address, a name or what they wrote.
 */
async function leadData(storeId: string, storeSlug: string, decisionId: string): Promise<WebhookSubject<"lead"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      email: col.text,
      decision: z.enum(["dismissed", "deal"]),
      deal_id: col.uuid.nullable(),
      customer_id: col.uuid.nullable(),
      decided_by: col.uuid.nullable(),
      decided_at: col.timestamp,
    }),
    sql`
      select ld.id, ld.email, ld.decision, ld.deal_id, ld.decided_by, ld.decided_at,
        coalesce(
          (select dl.customer_id from commerce.deals dl where dl.store_id = ld.store_id and dl.id = ld.deal_id),
          (select c.id from commerce.customers c where c.store_id = ld.store_id and lower(c.email) = ld.email and c.copied_from is null
            order by c.created_at limit 1)
        ) as customer_id
      from commerce.lead_decisions ld where ld.store_id = ${storeId}::uuid and ld.id = ${decisionId}::uuid
    `,
  );
  if (!row) return null;
  const { leadRequestsOf } = await import("./leads");
  return {
    id: row.id,
    decision: row.decision,
    deal_id: row.deal_id,
    customer_id: row.customer_id,
    requests: await leadRequestsOf(storeId, row.email, row.decided_at),
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    admin_url: row.deal_id ? `${siteUrl()}/admin/${storeSlug}/deals/${row.deal_id}` : `${siteUrl()}/admin/${storeSlug}/leads`,
  };
}

/**
 * One of the store's connected domains as the daily domain watch last knew it (ecosystem plan E5.1, D757, `domain.*`; E4.2): whether it
 * reaches the store, and when it was asked.
 */
async function domainData(storeId: string, storeSlug: string, domainId: string): Promise<WebhookSubject<"domain"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      hostname: col.text,
      is_primary: col.bool,
      language: col.textOrNull,
      market: col.textOrNull,
      serving: col.textOrNull,
      watched_at: col.textOrNull,
    }),
    sql`
      select id, hostname, is_primary, language, trim(market) as market,
        coalesce(checks -> 'watch' ->> 'known', checks -> 'watch' ->> 'serving') as serving, checks -> 'watch' ->> 'at' as watched_at
      from commerce.store_domains where store_id = ${storeId}::uuid and id = ${domainId}::uuid
    `,
  );
  if (!row) return null;
  const serving = row.serving === "ok" || row.serving === "certificate" || row.serving === "elsewhere" ? row.serving : null;
  const at = row.watched_at ? Date.parse(row.watched_at) : Number.NaN;
  return {
    id: row.id,
    hostname: row.hostname,
    primary: row.is_primary,
    language: row.language,
    market: row.market,
    serving,
    watched_at: Number.isNaN(at) ? null : new Date(at).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/settings/domains`,
  };
}

/** One of the store's emails that bounced or was marked as spam (email plan M1.2, D732, `email.*`): which, to whom and why. Never its words. */
async function emailData(storeId: string, storeSlug: string, emailId: string): Promise<WebhookSubject<"email"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      kind: col.text,
      to_address: col.text,
      status: col.text,
      error: col.textOrNull,
      order_id: col.uuid.nullable(),
      sent_at: col.timestampOrNull,
    }),
    sql`
      select id, kind, to_address, status::text as status, error, order_id, sent_at
      from commerce.email_messages where store_id = ${storeId}::uuid and id = ${emailId}::uuid
    `,
  );
  if (!row || (row.status !== "bounced" && row.status !== "complained") || row.to_address === "[removed]") return null;
  return {
    id: row.id,
    kind: row.kind,
    to: row.to_address.toLowerCase(),
    status: row.status,
    reason: row.status === "bounced" ? row.error : null,
    order_id: row.order_id,
    sent_at: row.sent_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/emails/${row.id}`,
  };
}

/** A broadcast that finished sending (D732, `broadcast.sent`): its counts from its recipients, or the figures kept once they are pruned. */
async function broadcastData(storeId: string, storeSlug: string, broadcastId: string): Promise<WebhookSubject<"broadcast"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      title: col.text,
      audience_words: col.textOrNull,
      recipient_count: col.int.nullable(),
      sent: col.int,
      skipped: col.int,
      failed: col.int,
      started_at: col.timestampOrNull,
      finished_at: col.timestampOrNull,
    }),
    sql`
      select b.id, b.title, b.audience_words, b.recipient_count, b.started_at, b.finished_at,
        count(r.*) filter (where r.status = 'sent')::int as sent,
        count(r.*) filter (where r.status = 'skipped')::int as skipped,
        count(r.*) filter (where r.status = 'failed')::int as failed
      from commerce.broadcasts b
      left join commerce.broadcast_recipients r on r.broadcast_id = b.id and r.store_id = b.store_id
      where b.store_id = ${storeId}::uuid and b.id = ${broadcastId}::uuid
      group by b.id
    `,
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    audience: row.audience_words,
    recipients: row.recipient_count ?? 0,
    sent: row.sent,
    skipped: row.skipped,
    failed: row.failed,
    started_at: row.started_at,
    finished_at: row.finished_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/broadcasts/${row.id}`,
  };
}

/** The sending guard holding the store's marketing email (D730, D732, `marketing.paused`): the line passed and what was counted. */
async function sendingPauseData(storeId: string, storeSlug: string, pauseId: string): Promise<WebhookSubject<"sending_pause"> | null> {
  const row = await typedRow(
    z.object({ id: col.uuid, reason: z.enum(["bounces", "complaints"]), counts: z.unknown(), paused_at: col.timestamp }),
    sql`select id, reason, counts, paused_at from commerce.sending_pauses where store_id = ${storeId}::uuid and id = ${pauseId}::uuid`,
  );
  if (!row) return null;
  const c = (row.counts && typeof row.counts === "object" ? row.counts : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : 0);
  return {
    id: row.id,
    reason: row.reason,
    sent: n(c.sent),
    bounced: n(c.bounced),
    complained: n(c.complained),
    paused_at: row.paused_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/marketing`,
  };
}

/**
 * A deal (ecosystem plan E3.2, D718, `deal.*`): its pipeline and stage, its value worked out where the board works it out (`listDeals()`,
 * in the store's main currency) and who it is for, as ids. Never the reason typed for closing it.
 */
async function dealData(storeSlug: string, dealId: string): Promise<WebhookSubject<"deal"> | null> {
  const [{ getStore }, { listDeals, pipelinesOf }] = await Promise.all([import("./stores"), import("./deals")]);
  const shop = await getStore(storeSlug);
  if (!shop) return null;
  const [deal] = await listDeals(shop, { id: dealId });
  if (!deal) return null;
  const pipeline = (await pipelinesOf(shop.id)).find((p) => p.id === deal.pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
  const currency = mainCurrency(shop);
  return {
    id: deal.id,
    title: deal.title,
    status: deal.status,
    pipeline: { id: deal.pipelineId, name: pipeline?.name ?? "" },
    stage: { id: deal.stageId, name: stage?.name ?? "", position: stage?.position ?? 0 },
    value: deal.value.minor === null ? null : amount(deal.value.minor, currency),
    currency,
    customer_id: deal.customer?.id ?? null,
    company_id: deal.company?.id ?? null,
    owner_id: deal.owner?.id ?? null,
    expected_close_on: deal.expectedCloseOn,
    closed_at: deal.closedAt,
    closed_via: (deal.closedVia as WebhookSubject<"deal">["closed_via"]) ?? null,
    stage_entered_at: deal.stageEnteredAt,
    created_at: deal.createdAt,
    admin_url: `${siteUrl()}/admin/${storeSlug}/deals/${deal.id}`,
  };
}

/** An address on the store's email list (ecosystem plan E3.2, D718, `subscriber.*`): where and how it joined or left. Never its token. */
async function subscriberData(storeId: string, storeSlug: string, subscriberId: string): Promise<WebhookSubject<"subscriber"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      email: col.text,
      status: z.enum(["pending", "subscribed", "unsubscribed"]),
      source: z.enum(["form", "checkout", "account", "shopify", "woocommerce"]),
      unsubscribe_source: z.enum(["link", "one_click", "account", "staff", "complaint", "bounce"]).nullable(),
      customer_id: col.uuid.nullable(),
      locale: col.text,
      market_code: col.textOrNull,
      consented_at: col.timestamp,
      confirmed_at: col.timestampOrNull,
      unsubscribed_at: col.timestampOrNull,
    }),
    sql`
      select id, email, status, source, unsubscribe_source, customer_id, locale, market_code, consented_at, confirmed_at, unsubscribed_at
      from commerce.marketing_subscribers where store_id = ${storeId}::uuid and id = ${subscriberId}::uuid
    `,
  );
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    source: row.source,
    unsubscribe_source: row.unsubscribe_source,
    customer_id: row.customer_id,
    locale: row.locale,
    market: row.market_code,
    consented_at: row.consented_at,
    confirmed_at: row.confirmed_at,
    unsubscribed_at: row.unsubscribed_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/subscribers/${row.id}`,
  };
}

/**
 * A support conversation of the store's desk (ecosystem plan E3.2, D718, `conversation.ended`, `conversation.rated`): how it went, as ids,
 * states and counts. Never a message, the summary, the rating's comment or the contact the visitor typed.
 */
async function conversationData(storeId: string, storeSlug: string, conversationId: string): Promise<WebhookSubject<"conversation"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      source: z.enum(["site", "admin", "email", "form"]),
      status: z.enum(["open", "ended"]),
      handler: z.enum(["ai", "queue", "human"]),
      ended_by: z.enum(["customer", "agent", "timeout", "system"]).nullable(),
      rating: z.enum(["good", "bad"]).nullable(),
      escalation: col.textOrNull,
      customer_id: col.uuid.nullable(),
      market: col.textOrNull,
      locale: col.text,
      message_seq: col.int,
      created_at: col.timestamp,
      first_agent_at: col.timestampOrNull,
      ended_at: col.timestampOrNull,
    }),
    sql`
      select id, source, status, handler, ended_by, rating, escalation, customer_id, market, locale, message_seq, created_at, first_agent_at, ended_at
      from commerce.support_conversations where store_id = ${storeId}::uuid and id = ${conversationId}::uuid
    `,
  );
  // An owner asking Kaizena Flow is the platform's desk, never a store's: no store's event is about one.
  if (!row || row.source === "admin") return null;
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    handler: row.handler,
    ended_by: row.ended_by,
    rating: row.rating,
    escalation: row.escalation,
    customer_id: row.customer_id,
    market: row.market,
    locale: row.locale,
    messages: row.message_seq,
    created_at: row.created_at,
    first_answer_at: row.first_agent_at,
    ended_at: row.ended_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/support?c=${row.id}`,
  };
}

/**
 * A checkout left without paying (ecosystem plan E3.2, D718, `checkout.abandoned`): the cart as it was kept for the reminders, each line's
 * SKU as it is now. Never the reminder links' secret.
 */
async function checkoutData(storeId: string, storeSlug: string, checkoutId: string): Promise<WebhookSubject<"checkout"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      cart_id: col.uuid,
      order_id: col.uuid.nullable(),
      email: col.textOrNull,
      market_code: col.text,
      locale: col.text,
      currency: col.currency,
      subtotal_minor: col.minor,
      captured_at: col.timestampOrNull,
      abandoned_at: col.timestampOrNull,
      recovered: col.bool,
      lines: z.array(z.object({ variant_id: col.uuid, sku: col.textOrNull, title: col.text, quantity: col.int, unit_price_minor: col.minor })),
    }),
    sql`
      select a.id, a.cart_id, a.order_id, a.email, trim(a.market_code) as market_code, a.locale, trim(a.currency) as currency, a.subtotal_minor,
        a.captured_at, a.abandoned_at, a.recovered_at is not null as recovered,
        coalesce((select json_agg(json_build_object('variant_id', l.value ->> 'variantId', 'sku', v.sku, 'title', l.value ->> 'title',
            'quantity', (l.value ->> 'quantity')::int, 'unit_price_minor', (l.value ->> 'unitPriceMinor')::bigint) order by l.ordinality)
          from jsonb_array_elements(a.lines) with ordinality l
          left join commerce.product_variants v on v.store_id = a.store_id and v.id::text = l.value ->> 'variantId'), '[]'::json) as lines
      from commerce.abandoned_checkouts a where a.store_id = ${storeId}::uuid and a.id = ${checkoutId}::uuid
    `,
  );
  if (!row) return null;
  return {
    id: row.id,
    cart_id: row.cart_id,
    order_id: row.order_id,
    email: row.email,
    market: row.market_code,
    locale: row.locale,
    currency: row.currency,
    subtotal: amount(row.subtotal_minor, row.currency),
    lines: row.lines.map((l) => ({ variant_id: l.variant_id, sku: l.sku ?? "", title: l.title, quantity: l.quantity, unit_price: amount(l.unit_price_minor, row.currency) })),
    captured_at: row.captured_at,
    abandoned_at: row.abandoned_at,
    recovered: row.recovered,
    admin_url: `${siteUrl()}/admin/${storeSlug}/cart-reminders`,
  };
}

/** A client in Work (ecosystem plan E3.2, D718, `work_client.created`): who they are as a business. Never their email or phone. */
async function workClientData(storeId: string, storeSlug: string, clientId: string): Promise<WebhookSubject<"work_client"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      name: col.text,
      legal_name: col.textOrNull,
      organisation_number: col.textOrNull,
      vat_number: col.textOrNull,
      country: col.textOrNull,
      business: col.bool,
      currency: col.currency,
      vat_treatment: z.enum(["domestic", "reverse_charge", "outside_scope", "exempt"]),
      customer_id: col.uuid.nullable(),
      customer_company_id: col.uuid.nullable(),
      archived: col.bool,
      created_at: col.timestamp,
    }),
    sql`
      select id, name, legal_name, organisation_number, vat_number, trim(country) as country, business, trim(currency) as currency, vat_treatment,
        customer_id, customer_company_id, archived_at is not null as archived, created_at
      from commerce.work_clients where store_id = ${storeId}::uuid and id = ${clientId}::uuid
    `,
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legal_name,
    organisation_number: row.organisation_number,
    vat_number: row.vat_number,
    country: row.country,
    business: row.business,
    currency: row.currency,
    vat_treatment: row.vat_treatment,
    customer_id: row.customer_id,
    company_id: row.customer_company_id,
    archived: row.archived,
    created_at: row.created_at,
    admin_url: `${siteUrl()}/admin/account/work/s/${storeSlug}/clients/${row.id}`,
  };
}

/** An invoice in Work (ecosystem plan E3.2, D718, `work_invoice.*`): its number, amounts, and what payments and credit notes have covered. */
async function workInvoiceData(storeId: string, storeSlug: string, invoiceId: string): Promise<WebhookSubject<"work_invoice"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      document_number: col.textOrNull,
      status: z.enum(["draft", "sent", "paid", "void", "lost"]),
      client_id: col.uuid,
      assignment_id: col.uuid.nullable(),
      currency: col.currency,
      subtotal_minor: col.minor,
      vat_minor: col.minor,
      total_minor: col.minor,
      paid_minor: col.minor,
      credited_minor: col.minor,
      issued_on: col.textOrNull,
      due_on: col.textOrNull,
      sent_at: col.timestampOrNull,
      paid_at: col.timestampOrNull,
    }),
    sql`
      select i.id, i.document_number, i.status, i.client_id, i.assignment_id, trim(i.currency) as currency, i.subtotal_minor, i.vat_minor, i.total_minor,
        coalesce((select sum(p.amount_minor) from commerce.work_invoice_payments p where p.store_id = i.store_id and p.invoice_id = i.id), 0) as paid_minor,
        coalesce((select sum(c.total_minor) from commerce.work_credit_notes c where c.store_id = i.store_id and c.invoice_id = i.id), 0) as credited_minor,
        to_char(i.issued_on, 'YYYY-MM-DD') as issued_on, to_char(i.due_on, 'YYYY-MM-DD') as due_on, i.sent_at, i.paid_at
      from commerce.work_invoices i where i.store_id = ${storeId}::uuid and i.id = ${invoiceId}::uuid
    `,
  );
  if (!row) return null;
  return {
    id: row.id,
    number: row.document_number,
    status: row.status,
    client_id: row.client_id,
    assignment_id: row.assignment_id,
    currency: row.currency,
    subtotal: amount(row.subtotal_minor, row.currency),
    vat: amount(row.vat_minor, row.currency),
    total: amount(row.total_minor, row.currency),
    paid: amount(row.paid_minor, row.currency),
    credited: amount(row.credited_minor, row.currency),
    issued_on: row.issued_on,
    due_on: row.due_on,
    sent_at: row.sent_at,
    paid_at: row.paid_at,
    admin_url: `${siteUrl()}/admin/account/work/s/${storeSlug}/invoices/${row.id}`,
  };
}

/** The latest paid order, or a sample in the store's own country and currency when it has none: what a test sends. */
async function testOrder(store: { id: string; slug: string }) {
  const [latest] = await db().execute<Row>(sql`
    select id from commerce.orders where store_id = ${store.id}::uuid and status in ('paid', 'fulfilled', 'closed') and copied_from is null
    order by placed_at desc limit 1
  `);
  const order = latest ? await orderData(store.id, store.slug, String(latest.id)) : null;
  if (order) return order;
  const [market] = await db().execute<Row>(sql`
    select m.code, m.currency from commerce.markets m join commerce.stores s on s.id = m.store_id
    where s.id = ${store.id}::uuid and m.active order by (m.code = s.country) desc nulls last, m.created_at, m.code limit 1
  `);
  return sampleOrder(market ? String(market.code) : "", market ? String(market.currency) : "");
}

/** The content of an event, as the service receives it; null when what it is about is gone. */
export async function buildPayload(
  store: { id: string; slug: string; name: string },
  delivery: { id: string; event: string; subjectId: string | null; createdAt: string },
): Promise<Record<string, unknown> | null> {
  const head = {
    id: delivery.id,
    event: delivery.event,
    created_at: delivery.createdAt,
    store: { slug: store.slug, name: store.name },
  };
  if (delivery.event === "test") return { ...head, test: true, order: await testOrder(store) };
  const data = await subjectData(store, delivery.event, delivery.subjectId);
  return data && { ...head, ...data };
}

/**
 * The content of an event to an owner's endpoint (D354): `{ id, topic, version, store, created_at, data }`, `data` holding what the event is
 * about under its own name (`order`, `product`, …). A change to a shape raises `PAYLOAD_VERSION`. Null when what it is about is gone.
 */
export async function endpointPayload(
  store: { id: string; slug: string; name: string },
  delivery: { id: string; event: string; subjectId: string | null; createdAt: string },
): Promise<Record<string, unknown> | null> {
  const data = delivery.event === "test" ? { test: true, order: await testOrder(store) } : await subjectData(store, delivery.event, delivery.subjectId);
  if (!data) return null;
  return { id: delivery.id, topic: delivery.event, version: PAYLOAD_VERSION, store: { slug: store.slug, name: store.name }, created_at: delivery.createdAt, data };
}

/** An app's installation as its own two events carry it (D441 D2): its id, the app's client ID and when it was removed. */
async function installationData(storeId: string, grantId: string): Promise<WebhookSubject<"installation"> | null> {
  const row = await typedRow(
    z.object({ id: col.uuid, client_id: col.text, removed_at: col.timestamp.nullable() }),
    sql`
      select g.id, c.client_id, g.revoked_at as removed_at
      from commerce.oauth_grants g join commerce.oauth_clients c on c.id = g.client_id
      where g.id = ${grantId}::uuid and g.store_id = ${storeId}::uuid and g.resource = 'admin'
    `,
  );
  if (!row?.removed_at) return null;
  return { id: row.id, client_id: row.client_id, removed_at: row.removed_at };
}

/** A return as an endpoint gets it (D354): its number, kind, state, lines and what is refunded, in the order's own currency. */
async function returnData(storeId: string, storeSlug: string, returnId: string): Promise<WebhookSubject<"return"> | null> {
  const [row] = await db().execute<Row>(sql`
    select r.id, r.number, r.kind, r.status::text as status, r.created_at, r.order_id, o.number as order_number, o.currency,
      r.refund_minor, r.withdrawal_request_id is not null as withdrawal,
      coalesce((select json_agg(json_build_object('order_line_id', l.order_line_id, 'sku', ol.sku, 'title', ol.title, 'quantity', l.quantity)
        order by ol.title) from commerce.return_lines l join commerce.order_lines ol on ol.id = l.order_line_id
        where l.store_id = r.store_id and l.return_id = r.id), '[]'::json) as lines
    from commerce.returns r join commerce.orders o on o.id = r.order_id
    where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
  `);
  if (!row) return null;
  const currency = String(row.currency).trim();
  return {
    id: String(row.id),
    number: String(row.number ?? ""),
    kind: String(row.kind) as WebhookSubject<"return">["kind"],
    status: String(row.status) as WebhookSubject<"return">["status"],
    withdrawal: Boolean(row.withdrawal),
    order_id: String(row.order_id),
    order_number: String(row.order_number),
    currency,
    refund: row.refund_minor === null ? null : amount(Number(row.refund_minor), currency),
    lines: row.lines as WebhookSubject<"return">["lines"],
    created_at: new Date(String(row.created_at)).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/returns/${String(row.id)}`,
  };
}

/** A confirmed withdrawal (D153): which order and when, never a reason (none is asked). The shopper's details are the order's. */
async function withdrawalData(storeId: string, storeSlug: string, withdrawalId: string): Promise<WebhookSubject<"withdrawal"> | null> {
  const [row] = await db().execute<Row>(sql`
    select w.id, w.order_id, o.number as order_number, w.channel, w.confirmed_at, w.acknowledgement_reference
    from commerce.withdrawal_requests w join commerce.orders o on o.id = w.order_id
    where w.store_id = ${storeId}::uuid and w.id = ${withdrawalId}::uuid and w.confirmed_at is not null
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    order_number: String(row.order_number),
    channel: String(row.channel),
    confirmed_at: new Date(String(row.confirmed_at)).toISOString(),
    reference: String(row.acknowledgement_reference ?? ""),
    admin_url: `${siteUrl()}/admin/${storeSlug}/orders/${String(row.order_id)}`,
  };
}

/** A product as the admin keeps it: its handle, state, kind, title in the store's main language and its variants with their SKUs. */
async function productData(storeId: string, storeSlug: string, productId: string): Promise<WebhookSubject<"product"> | null> {
  const [row] = await db().execute<Row>(sql`
    select p.id, p.handle, p.status::text as status, p.kind, p.created_at, p.updated_at,
      (select t.title from commerce.product_translations t where t.product_id = p.id
        order by (t.locale = (select m.default_locale from commerce.markets m join commerce.stores s on s.id = m.store_id
          where s.id = p.store_id and m.active order by (m.code = s.country) desc nulls last, m.created_at limit 1)) desc, t.locale limit 1) as title,
      coalesce((select json_agg(json_build_object('id', v.id, 'sku', v.sku, 'active', v.active) order by v.created_at, v.id)
        from commerce.product_variants v where v.product_id = p.id), '[]'::json) as variants
    from commerce.products p where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    handle: String(row.handle),
    title: String(row.title ?? ""),
    status: String(row.status) as WebhookSubject<"product">["status"],
    kind: String(row.kind) as WebhookSubject<"product">["kind"],
    variants: row.variants as WebhookSubject<"product">["variants"],
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/products/${String(row.id)}`,
  };
}

/** A variant whose stock fell to its low-stock level (D172): what is available now, as the store reads it. */
async function stockData(storeId: string, variantId: string): Promise<WebhookSubject<"stock"> | null> {
  const [row] = await db().execute<Row>(sql`
    select v.id, v.sku, v.product_id, a.stock_at_crossing, a.crossed_at,
      (select va.raw_available from commerce.variant_availability va where va.variant_id = v.id) as available
    from commerce.stock_alerts a join commerce.product_variants v on v.id = a.variant_id
    where a.store_id = ${storeId}::uuid and a.variant_id = ${variantId}::uuid
  `);
  if (!row) return null;
  return {
    variant_id: String(row.id),
    sku: String(row.sku ?? ""),
    product_id: String(row.product_id),
    available: row.available === null ? null : Number(row.available),
    stock_at_crossing: row.stock_at_crossing === null ? null : Number(row.stock_at_crossing),
    crossed_at: row.crossed_at ? new Date(String(row.crossed_at)).toISOString() : null,
  };
}

/**
 * A variant's stock as it is when the event is sent (D440, `inventory.updated`): on hand at each location and in all, and what can be sold
 * now as the store reads it. The event waits for its minute, so this is the stock after every change in it.
 */
async function inventoryData(storeId: string, storeSlug: string, variantId: string): Promise<WebhookSubject<"inventory"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      sku: col.textOrNull,
      product_id: col.uuid,
      on_hand: col.minor,
      available: col.int.nullable(),
      locations: z.array(z.object({ location_id: col.uuid, on_hand: col.int })),
      updated_at: col.timestamp,
    }),
    sql`
    select v.id, v.sku, v.product_id,
      coalesce((select sum(l.on_hand) from commerce.inventory_levels l where l.store_id = v.store_id and l.variant_id = v.id), 0)::bigint as on_hand,
      (select va.raw_available from commerce.variant_availability va where va.variant_id = v.id) as available,
      coalesce((select json_agg(json_build_object('location_id', l.location_id, 'on_hand', l.on_hand) order by l.location_id)
        from commerce.inventory_levels l where l.store_id = v.store_id and l.variant_id = v.id), '[]'::json) as locations,
      coalesce((select max(l.updated_at) from commerce.inventory_levels l where l.store_id = v.store_id and l.variant_id = v.id), v.created_at) as updated_at
    from commerce.product_variants v where v.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid
  `,
  );
  if (!row) return null;
  return {
    variant_id: row.id,
    product_id: row.product_id,
    sku: row.sku ?? "",
    on_hand: row.on_hand,
    available: row.available,
    locations: row.locations,
    updated_at: row.updated_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/inventory`,
  };
}

/** A parcel of an order (D440, `fulfilment.*`): its carrier, tracking and lines, and the carrier's tracking when the store follows it (D238). */
async function fulfilmentData(storeId: string, storeSlug: string, shipmentId: string): Promise<WebhookSubject<"fulfilment"> | null> {
  const [row] = await db().execute<Row>(sql`
    select s.id, s.order_id, o.number as order_number, s.carrier, s.tracking_number, s.tracking_url, s.undone_at is not null as undone, s.created_at,
      t.phase as tracking_phase, t.delivered_at as tracking_delivered_at, t.updated_at as tracking_updated_at,
      coalesce((select json_agg(json_build_object('order_line_id', l.order_line_id, 'sku', ol.sku, 'title', ol.title, 'quantity', l.quantity) order by ol.title, l.order_line_id)
        from commerce.shipment_lines l join commerce.order_lines ol on ol.store_id = l.store_id and ol.id = l.order_line_id
        where l.store_id = s.store_id and l.shipment_id = s.id), '[]'::json) as lines
    from commerce.shipments s
    join commerce.orders o on o.store_id = s.store_id and o.id = s.order_id
    left join commerce.shipment_tracking t on t.store_id = s.store_id and t.shipment_id = s.id
    where s.store_id = ${storeId}::uuid and s.id = ${shipmentId}::uuid
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    order_number: String(row.order_number),
    carrier: String(row.carrier ?? ""),
    tracking_number: String(row.tracking_number ?? ""),
    tracking_url: row.tracking_url ? String(row.tracking_url) : null,
    undone: Boolean(row.undone),
    tracking: row.tracking_updated_at
      ? {
          phase: String(row.tracking_phase ?? ""),
          delivered_at: row.tracking_delivered_at ? new Date(String(row.tracking_delivered_at)).toISOString() : null,
          updated_at: new Date(String(row.tracking_updated_at)).toISOString(),
        }
      : null,
    lines: row.lines as WebhookSubject<"fulfilment">["lines"],
    created_at: new Date(String(row.created_at)).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/orders/${String(row.order_id)}`,
  };
}

/** A refund (D440, `refund.created`): how much went back, in the order's currency, and how; never its reason, which staff wrote. */
async function refundData(storeId: string, storeSlug: string, refundId: string): Promise<WebhookSubject<"refund"> | null> {
  const row = await typedRow(
    z.object({ id: col.uuid, order_id: col.uuid, order_number: col.text, currency: col.currency, amount_minor: col.minor, kind: col.text, restocked: col.bool, created_at: col.timestamp }),
    sql`
    select r.id, p.order_id, o.number as order_number, trim(p.currency) as currency, r.amount_minor, r.kind, coalesce(jsonb_typeof(r.restocked) = 'array' and jsonb_array_length(r.restocked) > 0, false) as restocked, r.created_at
    from commerce.refunds r
    join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
    join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
    where r.store_id = ${storeId}::uuid and r.id = ${refundId}::uuid
  `,
  );
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    order_number: row.order_number,
    currency: row.currency,
    amount: amount(row.amount_minor, row.currency),
    kind: row.kind === "store_credit" ? "store_credit" : "money",
    restocked: row.restocked,
    created_at: row.created_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/orders/${row.order_id}`,
  };
}

/** A draft order or a shopper's request for a quote (D440, `quote.requested`, `draft.sent`): its lines and prices as saved, and its order once sent. */
async function draftData(storeId: string, storeSlug: string, draftId: string): Promise<WebhookSubject<"draft"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      number: col.text,
      status: col.text,
      source: col.text,
      market_code: col.text,
      currency: col.currency,
      email: col.text,
      order_id: col.uuid.nullable(),
      expires_at: col.timestampOrNull,
      created_at: col.timestamp,
      lines: z.array(z.object({ sku: col.textOrNull, title: col.text, quantity: col.int, unit_price_minor: col.minor, requested: col.bool })),
    }),
    sql`
    select d.id, d.number, d.status, d.source, d.market_code, trim(d.currency) as currency, coalesce(d.email, '') as email, d.order_id, d.expires_at, d.created_at,
      coalesce((select json_agg(json_build_object('sku', l.sku, 'title', l.title, 'quantity', l.quantity, 'unit_price_minor', l.unit_price_minor, 'requested', l.price_requested)
        order by l.position, l.id) from commerce.draft_order_lines l where l.store_id = d.store_id and l.draft_id = d.id), '[]'::json) as lines
    from commerce.draft_orders d where d.store_id = ${storeId}::uuid and d.id = ${draftId}::uuid
  `,
  );
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    status: row.status as WebhookSubject<"draft">["status"],
    source: row.source === "quote" ? "quote" : "staff",
    market: row.market_code,
    currency: row.currency,
    email: row.email,
    lines: row.lines.map((l) => ({ sku: l.sku ?? "", title: l.title, quantity: l.quantity, unit_price: l.requested ? null : amount(l.unit_price_minor, row.currency) })),
    order_id: row.order_id,
    expires_at: row.expires_at,
    created_at: row.created_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/orders/drafts/${row.id}`,
  };
}

/**
 * A deal's contract (D695 step 4, `contract.sent`, `contract.signed`, `contract.declined`): its title, state, template and signers in order
 * with when each signed or declined. Never a signer's email, the reason a signer gave or the contract's words: those stay on its page.
 */
async function contractData(storeId: string, storeSlug: string, contractId: string): Promise<WebhookSubject<"contract"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      title: col.text,
      status: z.enum(["draft", "sent", "signed", "declined", "expired", "cancelled"]),
      language: col.text,
      deal_id: col.uuid.nullable(),
      template: col.textOrNull,
      sent_at: col.timestampOrNull,
      expires_at: col.timestampOrNull,
      completed_at: col.timestampOrNull,
      signers: z.array(
        z.object({ role: z.enum(["store", "customer", "other"]), name: col.text, signed_at: col.timestampOrNull, declined_at: col.timestampOrNull }),
      ),
    }),
    sql`
    select k.id, k.title, k.status, k.language, k.deal_id, t.name as template, k.sent_at, k.expires_at, k.completed_at,
      coalesce((select json_agg(json_build_object('role', g.role, 'name', g.name, 'signed_at', g.signed_at, 'declined_at', g.declined_at) order by g.position)
        from commerce.contract_signers g where g.store_id = k.store_id and g.contract_id = k.id), '[]'::json) as signers
    from commerce.contracts k left join commerce.contract_templates t on t.store_id = k.store_id and t.id = k.template_id
    where k.store_id = ${storeId}::uuid and k.id = ${contractId}::uuid
  `,
  );
  // A draft is never an event's subject: a contract is sent before anything is said of it.
  if (!row || row.status === "draft") return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    language: row.language,
    deal_id: row.deal_id,
    template: row.template,
    signers: row.signers,
    sent_at: row.sent_at,
    expires_at: row.expires_at,
    completed_at: row.completed_at,
    admin_url: row.deal_id ? `${siteUrl()}/admin/${storeSlug}/deals/${row.deal_id}/contracts/${row.id}` : `${siteUrl()}/admin/${storeSlug}/deals`,
  };
}

/**
 * What a visitor sent with one of the store's forms (D705 F5, `form.response`): the form, and the answers as kept, labelled in the owner's
 * language. Sent only to the owner's own endpoints, apps that read customers and workflows; a response deleted by then sends nothing.
 */
async function formResponseData(storeId: string, storeSlug: string, responseId: string): Promise<WebhookSubject<"form_response"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      form_id: col.uuid,
      form_name: col.text,
      form_kind: z.enum(["message", "signup"]),
      answers: z.array(z.object({ label: z.string(), value: z.string() })),
      contact_email: col.textOrNull,
      path: col.text,
      locale: col.text,
      created_at: col.timestamp,
    }),
    sql`
    select r.id, r.form_id, f.name as form_name, f.kind as form_kind, r.answers, r.contact_email, r.path, r.locale, r.created_at
    from commerce.form_responses r join commerce.forms f on f.id = r.form_id
    where r.store_id = ${storeId}::uuid and r.id = ${responseId}::uuid
  `,
  );
  return row && { ...row, admin_url: `${siteUrl()}/admin/${storeSlug}/forms/responses/${row.form_id}` };
}

/** A gift card or store credit (D440, `gift_card.issued`): what it holds and how it came; never its code, which is kept only as a hash. */
async function giftCardData(storeId: string, storeSlug: string, cardId: string): Promise<WebhookSubject<"gift_card"> | null> {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      last4: col.textOrNull,
      currency: col.currency,
      initial_minor: col.minor,
      balance: col.minor,
      source: col.text,
      test_mode: col.bool,
      issued_at: col.timestamp,
      expires_at: col.timestampOrNull,
    }),
    sql`
      select g.id, g.last4, trim(g.currency) as currency, g.initial_minor, commerce.gift_card_balance(g.id) as balance, g.source, g.test_mode, g.issued_at, g.expires_at
      from commerce.gift_cards g where g.store_id = ${storeId}::uuid and g.id = ${cardId}::uuid
    `,
  );
  if (!row) return null;
  return {
    id: row.id,
    last4: row.last4 || null,
    currency: row.currency,
    initial: amount(row.initial_minor, row.currency),
    balance: amount(row.balance, row.currency),
    source: row.source as WebhookSubject<"gift_card">["source"],
    test: row.test_mode,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    admin_url: `${siteUrl()}/admin/${storeSlug}/gift-cards/${row.id}`,
  };
}

/** A product review a buyer wrote (D440, `review.created`): its stars and words as the buyer gave them to be shown, and whether it is published yet. */
async function reviewData(storeId: string, storeSlug: string, reviewId: string): Promise<WebhookSubject<"review"> | null> {
  const [row] = await db().execute<Row>(sql`
    select r.id, r.product_id, r.rating, coalesce(r.title, '') as title, coalesce(r.body, '') as body, coalesce(r.author_name, '') as author_name,
      r.status::text as status, r.order_id is not null as verified, coalesce(r.locale, '') as locale, r.created_at
    from commerce.product_reviews r where r.store_id = ${storeId}::uuid and r.id = ${reviewId}::uuid
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    rating: Number(row.rating),
    title: String(row.title),
    body: String(row.body),
    author_name: String(row.author_name),
    status: String(row.status),
    verified: Boolean(row.verified),
    locale: String(row.locale),
    created_at: new Date(String(row.created_at)).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/reviews`,
  };
}

/**
 * An A/B test as its page shows it (D148 phase 15, `experiment.answered`): the store's own verdict and each version's figures, worked out
 * when the delivery is built. A draft or scheduled test has none, so it is never sent.
 */
async function experimentData(storeSlug: string, experimentId: string): Promise<WebhookSubject<"experiment"> | null> {
  const [{ getStore }, { getExperiment }, { experimentResults }, { targetLabelText }, { EXPERIMENTS_WORDS }] = await Promise.all([
    import("./stores"),
    import("./experiment-admin"),
    import("./experiment-results"),
    import("@/lib/experiment-words"),
    import("@/lib/admin-words/experiments"),
  ]);
  const store = await getStore(storeSlug);
  const test = store && (await getExperiment(store.id, experimentId));
  if (!store || !test || test.status === "draft" || test.status === "scheduled") return null;
  const results = await experimentResults(store, test, new Date());
  const unit = 10 ** minorUnitDigits(results.currency);
  const rate = test.goal !== "revenue";
  return {
    id: test.id,
    name: test.name,
    goal: test.goal,
    target: {
      kind: test.page.kind,
      title: test.page.title,
      address: test.page.kind === "page" ? targetLabelText("page", test.page.slug, test.page.title, null, EXPERIMENTS_WORDS.en) : null,
      part: test.part?.label ?? null,
    },
    status: test.status,
    verdict: results.verdict.kind,
    best: results.verdict.best,
    headline: results.verdict.headline,
    days: results.days,
    versions: results.figures.map((f) => ({
      key: f.key,
      name: test.variants.find((v) => v.key === f.key)?.name ?? f.name,
      visitors: f.visitors,
      conversions: rate ? f.conversions : null,
      rate: rate ? (f.visitors > 0 ? f.conversions / f.visitors : 0) : null,
      revenue_per_visitor: rate ? null : f.visitors > 0 && f.money ? Math.round(f.money.sum / f.visitors) / unit : 0,
    })),
    currency: results.currency,
    answered_at: test.answeredAt ? new Date(test.answeredAt).toISOString() : null,
    learning: test.learning,
    admin_url: `${siteUrl()}/admin/${storeSlug}/experiments/${test.id}`,
  };
}

/** A discount code as made (D31, D299): its code, kind, amount and dates. */
async function discountData(storeId: string, storeSlug: string, codeId: string): Promise<WebhookSubject<"discount"> | null> {
  const [row] = await db().execute<Row>(sql`
    select id, code, kind, percent, amounts, starts_at, ends_at, usage_limit
    from commerce.discount_codes where store_id = ${storeId}::uuid and id = ${codeId}::uuid
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    code: String(row.code),
    kind: String(row.kind) as WebhookSubject<"discount">["kind"],
    percent: row.percent === null ? null : Number(row.percent),
    // Amounts off, per country, in minor units of the country's currency.
    amounts: (row.amounts ?? null) as WebhookSubject<"discount">["amounts"],
    starts_at: row.starts_at ? new Date(String(row.starts_at)).toISOString() : null,
    ends_at: row.ends_at ? new Date(String(row.ends_at)).toISOString() : null,
    usage_limit: row.usage_limit === null ? null : Number(row.usage_limit),
    admin_url: `${siteUrl()}/admin/${storeSlug}/discounts/${String(row.id)}`,
  };
}

/**
 * A support conversation waiting for a person (D216, step 14): how many of the store's wait now and the inbox's address. Never the
 * conversation, the customer's name, email or words, so the subject is not read beyond the store.
 */
async function supportWaitingData(storeId: string, storeSlug: string): Promise<WebhookSubject<"support">> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as waiting from commerce.support_conversations where store_id = ${storeId}::uuid and status = 'open' and handler = 'queue'
  `);
  return { waiting: Number(row?.waiting ?? 0), admin_url: `${siteUrl()}/admin/${storeSlug}/support` };
}

/** What a test sends when the store has no orders yet: the fields a real order has (its topic's contract, D438). */
function sampleOrder(country: string, currency: string): WebhookSubject<"order"> {
  const address = { name: "Sample Customer", line1: "Sample Street 1", line2: "", postal_code: "12345", city: "Sample City", country, phone: "" };
  return {
    id: "00000000-0000-4000-8000-000000000000",
    number: "1001",
    status: "paid",
    placed_at: "2026-01-01T12:00:00.000Z",
    market: country,
    currency,
    email: "customer@example.com",
    customer_name: "Sample Customer",
    subtotal: 398,
    shipping: 99,
    discount: 0,
    credits_used: 0,
    referral_discount: 0,
    discount_code: "",
    vat: 99.4,
    vat_kind: "standard",
    vat_relief: 0,
    total: 497,
    refunded: 0,
    shipping_address: address,
    billing_address: address,
    lines: [{ sku: "SAMPLE-1", title: "Sample product", quantity: 2, unit_price: 199, total: 398, delivery: "physical" }],
    shipment: null,
    subscription_id: null,
    admin_url: "",
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type DeliveryStatus = "pending" | "delivered" | "failed";

/** `final`: the service said it never will take it (Slack's channel or webhook is gone), so it is not tried again. */
export type Outcome = { ok: boolean; status: number | null; error: string | null; final?: boolean };

/** Slack's answers that trying again cannot change: a bad message, or a webhook, channel or app gone. */
const SLACK_FINAL = new Set([400, 403, 404, 410]);

/** A service's own webhook (Zapier, Make, Slack), for a store's events and Kaizena Flow's own (D465). */
export async function postToService(provider: Provider, url: string, deliveryId: string, event: string, payload: Record<string, unknown>): Promise<Outcome> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "KaizenaFlow-Webhooks/1.0",
        "X-Kaizen-Event": event,
        "X-Kaizen-Delivery": deliveryId,
      },
      body: JSON.stringify(payload),
      // The address was checked to be the service's own; never follow it elsewhere.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.ok) return { ok: true, status: response.status, error: null };
    const text = (await response.text().catch(() => "")).slice(0, 200);
    return {
      ok: false,
      status: response.status,
      error: text || response.statusText || "Not accepted",
      ...(provider === "slack" && SLACK_FINAL.has(response.status) && { final: true }),
    };
  } catch (error) {
    const name = (error as Error).name;
    return { ok: false, status: null, error: name === "TimeoutError" ? "No answer within 10 seconds" : "Could not reach the service" };
  }
}

/**
 * A signed event to an owner's endpoint (D354): through the address guard again (`safeFetch()`: a public address, no redirect, ten seconds,
 * a small answer read), with the delivery's id, the time, the topic and the HMAC of `"{time}.{body}"` in the headers. The secret is never
 * logged or kept outside the endpoint's row. The platform's own endpoints (D515) are sent through it too.
 */
export async function postSigned(url: string, secret: string, deliveryId: string, topic: string, payload: Record<string, unknown>): Promise<Outcome> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const fetched = await safeFetch(url, {
    maxBytes: 16_384,
    timeoutMs: TIMEOUT_MS,
    maxRedirects: 0,
    accept: "application/json, */*",
    post: {
      body,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "KaizenaFlow-Webhooks/1.0",
        [ID_HEADER]: deliveryId,
        [TIMESTAMP_HEADER]: String(timestamp),
        [TOPIC_HEADER]: topic,
        [SIGNATURE_HEADER]: signWebhook(secret, timestamp, body),
      },
    },
  });
  if (fetched.ok) return { ok: true, status: fetched.status, error: null };
  return { ok: false, status: fetched.status ?? null, error: fetched.problem };
}

type Claimed = {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  /** The store's zone, which a message about it reads its moments in (D796). */
  storeTimeZone: string;
  /** The store's main language, for amounts in Slack's messages. */
  locale: string;
  /** A service, or `webhook` for an owner's own endpoint (D354). */
  provider: Provider | "webhook";
  event: string;
  subjectId: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
  createdAt: string;
  encryptedUrl: string | null;
  enabled: boolean;
  /** An owner's endpoint (D354), or an app's installation's (D441): its id and encrypted secret. */
  endpointId: string | null;
  encryptedSecret: string | null;
  /** Why the endpoint is off (`failing`, `owner`, `uninstalled`), or null. */
  endpointOff: string | null;
  /** The endpoint is an app's installation's (D441 D2), not the owner's. */
  appEndpoint: boolean;
};

async function attempt(delivery: Claimed): Promise<Outcome> {
  const key = encryptionKey();
  let payload = delivery.payload;
  const fail = async (error: string) => {
    await db().execute(sql`
      update commerce.integration_deliveries set status = 'failed', last_error = ${error}
      where id = ${delivery.id}::uuid
    `);
    return { ok: false, status: null, error };
  };
  if (!delivery.encryptedUrl) return fail("Disconnected");
  // An app's own two events (D441 D2) reach the installation's endpoint though removing the app switched it off; nothing else does.
  const farewell = delivery.appEndpoint && isAppEvent(delivery.event) && delivery.endpointOff === "uninstalled";
  if (!delivery.enabled && delivery.event !== "test" && !farewell) return fail("Switched off");
  if (!key) return fail("Kaizena Flow could not read the address");
  const endpoint = delivery.provider === "webhook";
  if (!payload) {
    const store = { id: delivery.storeId, slug: delivery.storeSlug, name: delivery.storeName };
    const about = { id: delivery.id, event: delivery.event, subjectId: delivery.subjectId, createdAt: delivery.createdAt };
    payload = endpoint ? await endpointPayload(store, about) : await buildPayload(store, about);
    if (!payload) return fail("What it was about no longer exists");
    if (delivery.provider === "slack") {
      payload = slackMessage(payload, delivery.locale);
      if (!payload) return fail("Slack is not sent this event");
    }
    await db().execute(sql`
      update commerce.integration_deliveries set payload = ${JSON.stringify(payload)}::jsonb where id = ${delivery.id}::uuid
    `);
  }
  let outcome: Outcome;
  if (endpoint) {
    const opened = delivery.encryptedSecret ? openEndpoint(delivery.encryptedUrl, delivery.encryptedSecret) : null;
    if (!opened) return fail("Kaizena Flow could not read the address");
    // The event's own id, which the body carries too: the same when a delivery is sent again (a resend is a new row with the old payload),
    // so a receiver that does the work once per Kaizena-Webhook-Id never does it twice (D354, D438).
    const eventId = typeof payload.id === "string" ? payload.id : delivery.id;
    outcome = await postSigned(opened.url, opened.secret, eventId, delivery.event, payload);
  } else {
    let url: string;
    try {
      url = decryptSecret(delivery.encryptedUrl, key);
    } catch {
      return fail("Kaizena Flow could not read the address");
    }
    outcome = await postToService(delivery.provider as Provider, url, delivery.id, delivery.event, payload);
  }
  const tries = delivery.attempts + 1;
  const wait = outcome.final ? undefined : RETRY_SECONDS[tries - 1];
  await db().execute(sql`
    update commerce.integration_deliveries set
      attempts = ${tries},
      last_status = ${outcome.status}::int,
      last_error = ${outcome.error},
      status = ${outcome.ok ? "delivered" : wait === undefined || delivery.event === "test" ? "failed" : "pending"},
      delivered_at = ${outcome.ok ? sql`now()` : sql`null`},
      next_attempt_at = now() + make_interval(secs => ${wait ?? 0})
    where id = ${delivery.id}::uuid
  `);
  if (endpoint && delivery.endpointId && delivery.event !== "test") await keepEndpointHealth(delivery, outcome);
  return outcome;
}

/**
 * An endpoint's failures (D354): a delivery that arrives clears them; one that fails starts the count, and an endpoint where everything
 * has failed for `FAILING_DAYS` is switched off (`disabled_reason = 'failing'`), what it still has queued marked failed, and its owners
 * told once. Tests do not count.
 */
async function keepEndpointHealth(delivery: Claimed, outcome: Outcome): Promise<void> {
  if (outcome.ok) {
    await db().execute(sql`update commerce.webhook_endpoints set failing_since = null where id = ${delivery.endpointId}::uuid and failing_since is not null`);
    return;
  }
  await db().execute(sql`
    update commerce.webhook_endpoints set failing_since = now() where id = ${delivery.endpointId}::uuid and failing_since is null
  `);
  const [off] = await db().execute<Row>(sql`
    update commerce.webhook_endpoints set enabled = false, disabled_reason = 'failing', updated_at = now()
    where id = ${delivery.endpointId}::uuid and enabled and failing_since <= now() - make_interval(days => ${FAILING_DAYS})
    returning id, name, hint, failing_since
  `);
  if (!off) return;
  await db().execute(sql`
    update commerce.integration_deliveries set status = 'failed', last_error = 'Switched off'
    where endpoint_id = ${delivery.endpointId}::uuid and status = 'pending'
  `);
  log("warn", "integrations.endpoint_switched_off", { storeId: delivery.storeId, endpointId: delivery.endpointId, app: delivery.appEndpoint });
  // An app's installation's endpoint (D441) is the app's to mend: the store's owners are not told of an address they never gave.
  if (delivery.appEndpoint) return;
  await notifyEndpointOff(
    { id: delivery.storeId, slug: delivery.storeSlug, name: delivery.storeName, timeZone: delivery.storeTimeZone },
    { id: String(off.id), name: String(off.name), hint: String(off.hint), since: new Date(String(off.failing_since)).toISOString(), error: outcome.error ?? String(outcome.status ?? "") },
  );
}

const claimedColumns = sql`
  d.id, d.store_id, s.slug, s.name, s.time_zone, d.provider, d.event, d.subject_id, d.payload, d.attempts, d.created_at,
  coalesce(i.webhook_url_encrypted, e.url_encrypted) as webhook_url_encrypted, coalesce(i.enabled, e.enabled, false) as enabled,
  d.endpoint_id, e.secret_encrypted, e.disabled_reason as endpoint_off, e.app_grant_id is not null as app_endpoint,
  coalesce((
    select m.default_locale from commerce.markets m
    where m.store_id = s.id and m.active
    order by (m.code = s.country) desc nulls last, m.created_at, m.code limit 1
  ), 'en') as locale
`;

function toClaimed(row: Row): Claimed {
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    storeSlug: String(row.slug),
    storeName: String(row.name),
    storeTimeZone: storeZoneOf(row.time_zone),
    locale: String(row.locale),
    provider: row.provider as Provider | "webhook",
    event: String(row.event),
    subjectId: row.subject_id ? String(row.subject_id) : null,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    attempts: Number(row.attempts),
    createdAt: new Date(String(row.created_at)).toISOString(),
    encryptedUrl: row.webhook_url_encrypted ? String(row.webhook_url_encrypted) : null,
    enabled: Boolean(row.enabled),
    endpointId: row.endpoint_id ? String(row.endpoint_id) : null,
    encryptedSecret: row.secret_encrypted ? String(row.secret_encrypted) : null,
    endpointOff: row.endpoint_off ? String(row.endpoint_off) : null,
    appEndpoint: row.app_endpoint === true,
  };
}

/**
 * Sends what is due, oldest first. Each delivery is claimed for five
 * minutes before sending (outside any transaction, so no database
 * connection waits on the service), so two runs never send it twice.
 */
export async function deliverDue(limit = 50): Promise<{ delivered: number; retrying: number; failed: number }> {
  const ids = await db().execute<Row>(sql`
    update commerce.integration_deliveries set next_attempt_at = now() + interval '5 minutes'
    where id in (
      select id from commerce.integration_deliveries
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at limit ${limit}
      for update skip locked
    )
    returning id
  `);
  const claimed =
    ids.length === 0
      ? []
      : await db().execute<Row>(sql`
          select ${claimedColumns}
          from commerce.integration_deliveries d
          join commerce.stores s on s.id = d.store_id
          left join commerce.store_integrations i on i.store_id = d.store_id and i.provider = d.provider
          left join commerce.webhook_endpoints e on e.id = d.endpoint_id
          where d.id in (${sql.join(ids.map((r) => sql`${String(r.id)}::uuid`), sql`, `)})
          order by d.created_at
        `);
  const counts = { delivered: 0, retrying: 0, failed: 0 };
  for (const row of claimed) {
    const delivery = toClaimed(row);
    const outcome = await attempt(delivery);
    if (outcome.ok) counts.delivered++;
    else if (!outcome.final && RETRY_SECONDS[delivery.attempts] !== undefined && delivery.encryptedUrl && delivery.enabled) counts.retrying++;
    else counts.failed++;
  }
  return counts;
}

/** Deliveries older than KEEP_DAYS go (the daily run; it was every minute until bloat review step 0.31). Returns how many. */
export async function pruneDeliveries(): Promise<number> {
  const rows = await db().execute(sql`delete from commerce.integration_deliveries where created_at < now() - make_interval(days => ${KEEP_DAYS}) returning 1`);
  return rows.length;
}

/** Sends a test event now, and says how it went. */
export async function sendTest({ account, store }: Membership, provider: Provider): Promise<Outcome> {
  const integration = await getIntegration(store.id, provider);
  if (!integration) return { ok: false, status: null, error: "Save the webhook address first." };
  const [row] = await db().execute<Row>(sql`
    with made as (
      insert into commerce.integration_deliveries (store_id, provider, event, next_attempt_at)
      values (${store.id}::uuid, ${provider}, 'test', now() + interval '5 minutes')
      returning *
    )
    select ${claimedColumns}
    from made d join commerce.stores s on s.id = d.store_id
    left join commerce.store_integrations i on i.store_id = d.store_id and i.provider = d.provider
    left join commerce.webhook_endpoints e on e.id = d.endpoint_id
  `);
  await audit(account.id, store.id, "integration.test_sent", { provider });
  return attempt(toClaimed(row));
}

/** Sends a test event to one of the owner's endpoints now (D354), signed as any other, and says how it went. */
export async function sendEndpointTest({ account, store }: Membership, endpointId: string): Promise<Outcome | null> {
  const [row] = await db().execute<Row>(sql`
    with made as (
      insert into commerce.integration_deliveries (store_id, provider, event, endpoint_id, next_attempt_at)
      select e.store_id, 'webhook', 'test', e.id, now() + interval '5 minutes'
      from commerce.webhook_endpoints e where e.store_id = ${store.id}::uuid and e.id = ${endpointId}::uuid and e.app_grant_id is null
      returning *
    )
    select ${claimedColumns}
    from made d join commerce.stores s on s.id = d.store_id
    left join commerce.store_integrations i on i.store_id = d.store_id and i.provider = d.provider
    left join commerce.webhook_endpoints e on e.id = d.endpoint_id
  `);
  if (!row) return null;
  await audit(account.id, store.id, "integration.endpoint_test_sent", {}, { target: { type: "webhook_endpoint", id: endpointId } });
  return attempt(toClaimed(row));
}

/**
 * A message to the store's Slack channel from the AI manager (D104), on the
 * owner's yes: sent at once through the same queue and log as events, as
 * text that cannot mention anyone or become a link.
 */
export async function postToSlack(storeId: string, text: string): Promise<Outcome> {
  const integration = await getIntegration(storeId, "slack");
  if (!integration?.enabled) return { ok: false, status: null, error: "Slack is not connected under Integrations." };
  const body = escapeSlack(text.slice(0, 2000));
  const payload = { text: body, blocks: [{ type: "section", text: { type: "mrkdwn", text: body } }], unfurl_links: false, unfurl_media: false };
  const [row] = await db().execute<Row>(sql`
    with made as (
      insert into commerce.integration_deliveries (store_id, provider, event, payload, next_attempt_at)
      values (${storeId}::uuid, 'slack', 'assistant.message', ${JSON.stringify(payload)}::jsonb, now() + interval '5 minutes')
      returning *
    )
    select ${claimedColumns}
    from made d join commerce.stores s on s.id = d.store_id
    left join commerce.store_integrations i on i.store_id = d.store_id and i.provider = d.provider
    left join commerce.webhook_endpoints e on e.id = d.endpoint_id
  `);
  return attempt(toClaimed(row));
}

export type DeliveryRow = {
  id: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
  subjectId: string | null;
};

/** The latest deliveries to a service, newest first. */
export async function listDeliveries(storeId: string, provider: Provider, limit = 25): Promise<DeliveryRow[]> {
  const rows = await db().execute<Row>(sql`
    select id, event, status, attempts, last_status, last_error, created_at, delivered_at, next_attempt_at, subject_id
    from commerce.integration_deliveries
    where store_id = ${storeId}::uuid and provider = ${provider}
    order by created_at desc limit ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    event: String(row.event),
    status: row.status as DeliveryStatus,
    attempts: Number(row.attempts),
    lastStatus: row.last_status === null ? null : Number(row.last_status),
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
    nextAttemptAt: new Date(String(row.next_attempt_at)).toISOString(),
    subjectId: row.subject_id ? String(row.subject_id) : null,
  }));
}
