import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  checkWebhookUrl,
  isEvent,
  webhookHint,
  type IntegrationEvent,
  type Provider,
} from "@/lib/integrations";
import { minorUnitDigits } from "@/lib/money";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { audit, type Membership } from "./auth";
import { getOrder, type Address } from "./orders";
import { encryptionKey } from "./settings";

type Row = Record<string, unknown>;

/**
 * Integrations (decision D41): a store connects Zapier or Make by giving
 * the webhook address the service made for it, and chooses which events
 * to send. The database queues each event as it happens (see the rules
 * migration); a job every minute builds its content and sends it, trying
 * again later when the service does not take it. Deliveries are kept 30
 * days, for the log and retries.
 */

/** When to try again after each failed try; after the last, the delivery has failed. */
const RETRY_SECONDS = [60, 300, 1800, 7200, 21600];
const TIMEOUT_MS = 10_000;
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
  const events = [...new Set(input.events.filter(isEvent))];
  const existing = await getIntegration(store.id, provider);
  let encrypted: string | null = null;
  let hint: string | null = null;
  if (input.url.trim()) {
    const checked = checkWebhookUrl(provider, input.url);
    if (!checked.ok) return { ok: false, problems: [checked.problem] };
    const key = encryptionKey();
    if (!key) return { ok: false, problems: ["Kaizen cannot keep the address safe right now, so it was not saved. Try again later."] };
    encrypted = encryptSecret(checked.url, key);
    hint = webhookHint(checked.url);
  } else if (!existing) {
    return { ok: false, problems: ["Paste the webhook address from the service."] };
  }
  if (events.length === 0) return { ok: false, problems: ["Choose at least one event to send."] };

  await db().execute(sql`
    insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events, updated_by)
    values (${store.id}::uuid, ${provider}, ${input.enabled}, ${encrypted ?? ""}, ${hint ?? ""},
      array[${sql.join(events.map((event) => sql`${event}`), sql`, `)}]::text[], ${account.id}::uuid)
    on conflict (store_id, provider) do update set
      enabled = excluded.enabled,
      webhook_url_encrypted = coalesce(nullif(excluded.webhook_url_encrypted, ''), store_integrations.webhook_url_encrypted),
      webhook_hint = coalesce(nullif(excluded.webhook_hint, ''), store_integrations.webhook_hint),
      events = excluded.events, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(account.id, store.id, "integration.saved", { provider, enabled: input.enabled, events, newAddress: Boolean(encrypted) });
  return { ok: true };
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

async function orderData(storeId: string, storeSlug: string, orderId: string) {
  const order = await getOrder(storeId, orderId);
  if (!order) return null;
  const [extra] = await db().execute<Row>(sql`
    select
      (select json_build_object('carrier', s.carrier, 'tracking_number', s.tracking_number, 'tracking_url', s.tracking_url)
         from commerce.shipments s where s.store_id = ${storeId}::uuid and s.order_id = ${orderId}::uuid
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
    discount: money(order.discountMinor),
    discount_code: order.discountCode ?? "",
    vat: money(order.taxMinor),
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
    shipment: (extra?.shipment as Record<string, string> | null) ?? null,
    subscription_id: order.subscriptionId,
    admin_url: `${siteUrl()}/admin/${storeSlug}/orders/${order.id}`,
  };
}

async function customerData(storeId: string, storeSlug: string, customerId: string) {
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

async function subscriptionData(storeId: string, storeSlug: string, subscriptionId: string) {
  const [row] = await db().execute<Row>(sql`
    select id, number, status, email, currency, total_minor, interval, interval_count, current_period_end, created_at
    from commerce.subscriptions where store_id = ${storeId}::uuid and id = ${subscriptionId}::uuid
  `);
  if (!row) return null;
  const currency = String(row.currency);
  return {
    id: String(row.id),
    number: String(row.number),
    status: String(row.status),
    email: String(row.email),
    currency,
    total_per_renewal: amount(Number(row.total_minor), currency),
    every: `${Number(row.interval_count)} ${String(row.interval)}`,
    renews_at: row.current_period_end ? new Date(String(row.current_period_end)).toISOString() : null,
    started_at: new Date(String(row.created_at)).toISOString(),
    admin_url: `${siteUrl()}/admin/${storeSlug}/subscriptions/${String(row.id)}`,
  };
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
  if (delivery.event === "test") {
    const [latest] = await db().execute<Row>(sql`
      select id from commerce.orders where store_id = ${store.id}::uuid and status in ('paid', 'fulfilled', 'closed')
      order by placed_at desc limit 1
    `);
    const order = latest ? await orderData(store.id, store.slug, String(latest.id)) : null;
    return { ...head, test: true, order: order ?? SAMPLE_ORDER };
  }
  if (!delivery.subjectId) return null;
  if (delivery.event.startsWith("order.")) {
    const order = await orderData(store.id, store.slug, delivery.subjectId);
    return order && { ...head, order };
  }
  if (delivery.event === "customer.created") {
    const customer = await customerData(store.id, store.slug, delivery.subjectId);
    return customer && { ...head, customer };
  }
  if (delivery.event.startsWith("subscription.")) {
    const subscription = await subscriptionData(store.id, store.slug, delivery.subjectId);
    return subscription && { ...head, subscription };
  }
  return null;
}

/** What a test sends when the store has no orders yet: the fields a real order has. */
const SAMPLE_ORDER = {
  id: "00000000-0000-4000-8000-000000000000",
  number: "1001",
  status: "paid",
  placed_at: "2026-01-01T12:00:00.000Z",
  market: "NO",
  currency: "NOK",
  email: "kari.nordmann@example.com",
  customer_name: "Kari Nordmann",
  subtotal: 398,
  shipping: 99,
  discount: 0,
  discount_code: "",
  vat: 99.4,
  total: 497,
  refunded: 0,
  shipping_address: { name: "Kari Nordmann", line1: "Storgata 1", line2: "", postal_code: "0155", city: "Oslo", country: "NO", phone: "" },
  billing_address: { name: "Kari Nordmann", line1: "Storgata 1", line2: "", postal_code: "0155", city: "Oslo", country: "NO", phone: "" },
  lines: [{ sku: "SAMPLE-1", title: "Sample product", quantity: 2, unit_price: 199, total: 398, delivery: "physical" }],
  shipment: null,
  subscription_id: null,
  admin_url: "",
};

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type DeliveryStatus = "pending" | "delivered" | "failed";

type Outcome = { ok: boolean; status: number | null; error: string | null };

async function post(url: string, deliveryId: string, event: string, payload: Record<string, unknown>): Promise<Outcome> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Kaizen-Webhooks/1.0",
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
    return { ok: false, status: response.status, error: text || response.statusText || "Not accepted" };
  } catch (error) {
    const name = (error as Error).name;
    return { ok: false, status: null, error: name === "TimeoutError" ? "No answer within 10 seconds" : "Could not reach the service" };
  }
}

type Claimed = {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  provider: Provider;
  event: string;
  subjectId: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
  createdAt: string;
  encryptedUrl: string | null;
  enabled: boolean;
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
  if (!delivery.enabled && delivery.event !== "test") return fail("Switched off");
  if (!key) return fail("Kaizen could not read the address");
  if (!payload) {
    payload = await buildPayload(
      { id: delivery.storeId, slug: delivery.storeSlug, name: delivery.storeName },
      { id: delivery.id, event: delivery.event, subjectId: delivery.subjectId, createdAt: delivery.createdAt },
    );
    if (!payload) return fail("What it was about no longer exists");
    await db().execute(sql`
      update commerce.integration_deliveries set payload = ${JSON.stringify(payload)}::jsonb where id = ${delivery.id}::uuid
    `);
  }
  let url: string;
  try {
    url = decryptSecret(delivery.encryptedUrl, key);
  } catch {
    return fail("Kaizen could not read the address");
  }
  const outcome = await post(url, delivery.id, delivery.event, payload);
  const tries = delivery.attempts + 1;
  const wait = RETRY_SECONDS[tries - 1];
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
  return outcome;
}

const claimedColumns = sql`
  d.id, d.store_id, s.slug, s.name, d.provider, d.event, d.subject_id, d.payload, d.attempts, d.created_at,
  i.webhook_url_encrypted, coalesce(i.enabled, false) as enabled
`;

function toClaimed(row: Row): Claimed {
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    storeSlug: String(row.slug),
    storeName: String(row.name),
    provider: row.provider as Provider,
    event: String(row.event),
    subjectId: row.subject_id ? String(row.subject_id) : null,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    attempts: Number(row.attempts),
    createdAt: new Date(String(row.created_at)).toISOString(),
    encryptedUrl: row.webhook_url_encrypted ? String(row.webhook_url_encrypted) : null,
    enabled: Boolean(row.enabled),
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
          where d.id in (${sql.join(ids.map((r) => sql`${String(r.id)}::uuid`), sql`, `)})
          order by d.created_at
        `);
  const counts = { delivered: 0, retrying: 0, failed: 0 };
  for (const row of claimed) {
    const delivery = toClaimed(row);
    const outcome = await attempt(delivery);
    if (outcome.ok) counts.delivered++;
    else if (RETRY_SECONDS[delivery.attempts] !== undefined && delivery.encryptedUrl && delivery.enabled) counts.retrying++;
    else counts.failed++;
  }
  await db().execute(sql`delete from commerce.integration_deliveries where created_at < now() - make_interval(days => ${KEEP_DAYS})`);
  return counts;
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
  `);
  await audit(account.id, store.id, "integration.test_sent", { provider });
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
