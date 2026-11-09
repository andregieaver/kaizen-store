import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { checkWebhookUrl, webhookHint, type Provider } from "@/lib/integrations";
import { minorUnitDigits } from "@/lib/money";
import { storeSiteUrl } from "@/lib/paths";
import {
  DEFAULT_PLATFORM_EVENTS,
  isPlatformEvent,
  PLATFORM_DELIVERY_KEEP_DAYS,
  platformSlackMessage,
  type PlatformEvent,
} from "@/lib/platform-integrations";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { audit, type Account } from "./auth";
import { postSigned, postToService, RETRY_SECONDS, type DeliveryStatus, type Outcome } from "./integrations";
import { log } from "./log";
import { keepPlatformEndpointHealth } from "./platform-endpoints";
import { encryptionKey } from "./settings";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Kaizena Flow's own integrations (D465, `docs/platform-parity.md`): what a store has under Integrations (D41, D101), for the platform.
 * A platform admin connects Zapier, Make or a Slack channel with the service's own webhook address (checked and kept encrypted as a
 * store's is) and chooses which platform events it gets; the database queues each as it happens (`commerce.queue_platform_event()`), and
 * `deliverPlatformDue()` builds and sends them every minute beside the stores', with the same tries and the same 30 days in the log.
 * Written only here.
 */

export type PlatformIntegration = {
  provider: Provider;
  enabled: boolean;
  hint: string;
  events: PlatformEvent[];
  updatedAt: string;
};

export type PlatformIntegrationStatus = PlatformIntegration & {
  lastDelivery: { status: DeliveryStatus; at: string } | null;
  /** Deliveries that gave up in the last 7 days. */
  recentFailures: number;
};

const integrationRow = z.object({
  provider: z.enum(["zapier", "make", "slack"]),
  enabled: col.bool,
  webhook_hint: col.text,
  events: z.array(z.string()),
  updated_at: col.timestamp,
});

const toIntegration = (row: z.output<typeof integrationRow>): PlatformIntegration => ({
  provider: row.provider,
  enabled: row.enabled,
  hint: row.webhook_hint,
  events: row.events.filter(isPlatformEvent),
  updatedAt: row.updated_at,
});

/** The platform's connected services, each with how its last delivery went. */
export async function listPlatformIntegrations(): Promise<PlatformIntegrationStatus[]> {
  const rows = await typedRows(
    integrationRow.extend({
      last_status: z.enum(["pending", "delivered", "failed"]).nullable(),
      last_at: col.timestampOrNull,
      recent_failures: col.int,
    }),
    sql`
      select i.provider, i.enabled, i.webhook_hint, i.events, i.updated_at, last.status as last_status, last.created_at as last_at,
        (select count(*)::int from commerce.platform_integration_deliveries d
          where d.provider = i.provider and d.status = 'failed' and d.created_at > now() - interval '7 days') as recent_failures
      from commerce.platform_integrations i
      left join lateral (
        select status, created_at from commerce.platform_integration_deliveries d
        where d.provider = i.provider order by created_at desc limit 1
      ) last on true
      order by i.provider
    `,
  );
  return rows.map((row) => ({
    ...toIntegration(row),
    lastDelivery: row.last_status && row.last_at ? { status: row.last_status, at: row.last_at } : null,
    recentFailures: row.recent_failures,
  }));
}

export async function getPlatformIntegration(provider: Provider): Promise<PlatformIntegration | null> {
  const row = await typedRow(
    integrationRow,
    sql`select provider, enabled, webhook_hint, events, updated_at from commerce.platform_integrations where provider = ${provider}`,
  );
  return row ? toIntegration(row) : null;
}

/** The problems a save can answer, by key: the page shows each in the admin's language (`platform.integrations.answers`). */
export type PlatformSaveProblem = "address" | "zapier" | "make" | "slack" | "key" | "events";
export type PlatformSaveResult = { ok: true } | { ok: false; problem: PlatformSaveProblem };

/** Connects the service, or changes what it gets. A new webhook address replaces the old one; left empty, the old one stays. */
export async function savePlatformIntegration(
  admin: Account,
  provider: Provider,
  input: { url: string; events: string[]; enabled: boolean },
): Promise<PlatformSaveResult> {
  const events = [...new Set(input.events.filter(isPlatformEvent))];
  const existing = await getPlatformIntegration(provider);
  let encrypted = "";
  let hint = "";
  if (input.url.trim()) {
    const checked = checkWebhookUrl(provider, input.url);
    if (!checked.ok) return { ok: false, problem: provider };
    const key = encryptionKey();
    if (!key) return { ok: false, problem: "key" };
    encrypted = encryptSecret(checked.url, key);
    hint = webhookHint(checked.url);
  } else if (!existing) {
    return { ok: false, problem: "address" };
  }
  if (events.length === 0) return { ok: false, problem: "events" };
  await db().execute(sql`
    insert into commerce.platform_integrations (provider, enabled, webhook_url_encrypted, webhook_hint, events, updated_by)
    values (${provider}, ${input.enabled}, ${encrypted}, ${hint},
      array[${sql.join(events.map((event) => sql`${event}`), sql`, `)}]::text[], ${admin.id}::uuid)
    on conflict (provider) do update set
      enabled = excluded.enabled,
      webhook_url_encrypted = coalesce(nullif(excluded.webhook_url_encrypted, ''), platform_integrations.webhook_url_encrypted),
      webhook_hint = coalesce(nullif(excluded.webhook_hint, ''), platform_integrations.webhook_hint),
      events = excluded.events, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(admin.id, null, "platform.integration_saved", { provider, enabled: input.enabled, events, newAddress: Boolean(encrypted) });
  return { ok: true };
}

/** What a service gets until a platform admin chooses. */
export const platformDefaultEvents = (): PlatformEvent[] => [...DEFAULT_PLATFORM_EVENTS];

/**
 * *Add to Slack* for the platform (C4, D515): the channel a platform owner picked in Slack, through Kaizena Flow's own Slack app (D101), kept
 * as a pasted webhook is, switched on, with the events it had or the defaults.
 */
export async function connectPlatformSlack(admin: Account, webhook: { url: string; channel: string; team: string }): Promise<PlatformSaveResult> {
  const checked = checkWebhookUrl("slack", webhook.url);
  if (!checked.ok) return { ok: false, problem: "slack" };
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "key" };
  const existing = await getPlatformIntegration("slack");
  const events = existing?.events.length ? existing.events : platformDefaultEvents();
  const channel = webhook.channel.trim() || "a channel";
  const hint = (webhook.team.trim() ? `${channel} in ${webhook.team.trim()}` : channel).slice(0, 120);
  await db().execute(sql`
    insert into commerce.platform_integrations (provider, enabled, webhook_url_encrypted, webhook_hint, events, updated_by)
    values ('slack', true, ${encryptSecret(checked.url, key)}, ${hint}, array[${sql.join(events.map((event) => sql`${event}`), sql`, `)}]::text[], ${admin.id}::uuid)
    on conflict (provider) do update set
      enabled = true, webhook_url_encrypted = excluded.webhook_url_encrypted, webhook_hint = excluded.webhook_hint,
      events = excluded.events, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(admin.id, null, "platform.integration_saved", { provider: "slack", enabled: true, events, newAddress: true, addToSlack: true });
  return { ok: true };
}

/** Disconnects the service: its address and settings go; deliveries waiting are dropped. */
export async function removePlatformIntegration(admin: Account, provider: Provider): Promise<boolean> {
  const rows = await db().execute(sql`delete from commerce.platform_integrations where provider = ${provider} returning provider`);
  await db().execute(sql`
    update commerce.platform_integration_deliveries set status = 'failed', last_error = 'Disconnected'
    where provider = ${provider} and status = 'pending'
  `);
  if (rows.length > 0) await audit(admin.id, null, "platform.integration_removed", { provider });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// What is sent
// ---------------------------------------------------------------------------

const PLATFORM = () => ({ name: "Kaizena Flow", url: siteUrl() });
const adminUrl = (path: string) => `${siteUrl()}/admin/platform${path}`;
const whole = (minor: number, currency: string) => minor / 10 ** minorUnitDigits(currency);

const storeRow = z.object({
  id: col.uuid,
  slug: col.text,
  name: col.text,
  country: col.textOrNull,
  created_at: col.timestamp,
  setup_completed_at: col.timestampOrNull,
});

type StoreData = {
  id: string;
  slug: string;
  name: string;
  url: string;
  admin_url: string;
  country: string | null;
  created_at: string;
  opened_at: string | null;
};

const storeData = (row: z.output<typeof storeRow>): StoreData => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  url: storeSiteUrl(row.slug),
  admin_url: adminUrl(`/stores/${row.slug}`),
  country: row.country,
  created_at: row.created_at,
  opened_at: row.setup_completed_at,
});

async function readStore(storeId: string): Promise<StoreData | null> {
  const row = await typedRow(
    storeRow,
    sql`select id, slug, name, country, created_at, setup_completed_at from commerce.stores where id = ${storeId}::uuid`,
  );
  return row && storeData(row);
}

/** A store's plan as it is now: its name, price and state, in whole units as the services get amounts. */
async function readPlan(storeId: string) {
  const row = await typedRow(
    z.object({
      name: col.textOrNull,
      interval: col.textOrNull,
      amount_minor: col.minorOrNull,
      currency: z.string().nullable(),
      status: col.textOrNull,
      mode: col.textOrNull,
      current_period_end: col.timestampOrNull,
      cancel_at_period_end: col.bool,
    }),
    sql`
      select p.name, pp.interval, pp.amount_minor, pp.currency, b.status, b.mode::text as mode, b.current_period_end, b.cancel_at_period_end
      from commerce.store_billing b
      left join commerce.plans p on p.id = b.plan_id
      left join commerce.plan_prices pp on pp.id = b.price_id
      where b.store_id = ${storeId}::uuid
    `,
  );
  if (!row) return null;
  const currency = row.currency?.trim() || null;
  return {
    name: row.name,
    interval: row.interval,
    amount: row.amount_minor !== null && currency ? whole(row.amount_minor, currency) : null,
    currency,
    status: row.status,
    mode: row.mode,
    current_period_end: row.current_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
  };
}

/** A request for a store as Zapier and Make get it: who asked (they are the operator's own leads) and what for. Slack never shows the email. */
async function readRequest(requestId: string) {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      store_name: col.text,
      message: col.text,
      name: col.text,
      email: col.text,
      domain: col.textOrNull,
      locale: col.textOrNull,
      created_at: col.timestamp,
    }),
    sql`select id, store_name, message, name, email, domain, locale, created_at from commerce.access_requests where id = ${requestId}::uuid`,
  );
  if (!row) return null;
  return {
    id: row.id,
    store_name: row.store_name,
    sells: row.message.slice(0, 1000),
    name: row.name,
    email: row.email,
    domain: row.domain,
    language: row.locale ?? "en",
    admin_url: adminUrl("/requests"),
    created_at: row.created_at,
  };
}

/** A notice of illegal content: its category, where it points and the store, never who sent it or what they wrote (D411). */
async function readReport(reportId: string) {
  const row = await typedRow(
    z.object({
      id: col.uuid,
      category: col.text,
      source: col.text,
      url: col.text,
      created_at: col.timestamp,
      store_slug: col.textOrNull,
      store_name: col.textOrNull,
    }),
    sql`
      select r.id, r.category, r.source, r.url, r.created_at, s.slug as store_slug, s.name as store_name
      from commerce.content_reports r left join commerce.stores s on s.id = r.store_id
      where r.id = ${reportId}::uuid
    `,
  );
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    source: row.source,
    url: row.url,
    store: row.store_slug ? { slug: row.store_slug, name: row.store_name ?? row.store_slug } : null,
    admin_url: adminUrl("/reports"),
    created_at: row.created_at,
  };
}

/** What a test sends: the newest store of an owner, or a sample one when there is none yet. */
async function testStore(): Promise<StoreData> {
  const row = await typedRow(
    storeRow,
    sql`
      select id, slug, name, country, created_at, setup_completed_at from commerce.stores
      where not (is_template or starter) and not sandbox and not house and status = 'active'
      order by created_at desc limit 1
    `,
  );
  if (row) return storeData(row);
  return {
    id: "00000000-0000-4000-8000-000000000000",
    slug: "sample",
    name: "Sample store",
    url: storeSiteUrl("sample"),
    admin_url: adminUrl("/stores"),
    country: "NO",
    created_at: new Date().toISOString(),
    opened_at: null,
  };
}

/**
 * The content of a platform event, as Zapier and Make receive it: `{ id, event, created_at, platform, … }` with what it is about under its
 * own name (`request`, `store` and `plan`, `report`). Null when what it is about is gone.
 */
export async function platformPayload(delivery: { id: string; event: string; subjectId: string | null; createdAt: string }): Promise<Record<string, unknown> | null> {
  const head = { id: delivery.id, event: delivery.event, created_at: delivery.createdAt, platform: PLATFORM() };
  if (delivery.event === "test") return { ...head, test: true, store: await testStore() };
  if (!delivery.subjectId) return null;
  if (delivery.event === "request.received") {
    const request = await readRequest(delivery.subjectId);
    return request && { ...head, request };
  }
  if (delivery.event === "report.received") {
    const report = await readReport(delivery.subjectId);
    return report && { ...head, report };
  }
  const store = await readStore(delivery.subjectId);
  if (!store) return null;
  if (delivery.event.startsWith("plan.")) return { ...head, store, plan: await readPlan(delivery.subjectId) };
  return { ...head, store };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const claimedRow = z.object({
  id: col.uuid,
  /** A service, or `webhook` for one of the platform's own endpoints (D515). */
  provider: z.enum(["zapier", "make", "slack", "webhook"]),
  event: col.text,
  subject_id: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  attempts: col.int,
  created_at: col.timestamp,
  webhook_url_encrypted: col.textOrNull,
  enabled: col.bool,
  endpoint_id: col.uuid.nullable(),
  secret_encrypted: col.textOrNull,
});
type Claimed = z.output<typeof claimedRow>;

const claimedColumns = sql`
  d.id, d.provider, d.event, d.subject_id, d.payload, d.attempts, d.created_at,
  coalesce(i.webhook_url_encrypted, e.url_encrypted) as webhook_url_encrypted, coalesce(i.enabled, e.enabled, false) as enabled,
  d.endpoint_id, e.secret_encrypted
`;
const claimedJoins = sql`
  left join commerce.platform_integrations i on i.provider = d.provider and d.provider <> 'webhook'
  left join commerce.platform_webhook_endpoints e on e.id = d.endpoint_id
`;

async function attempt(delivery: Claimed): Promise<Outcome> {
  const fail = async (error: string): Promise<Outcome> => {
    await db().execute(sql`update commerce.platform_integration_deliveries set status = 'failed', last_error = ${error} where id = ${delivery.id}::uuid`);
    return { ok: false, status: null, error };
  };
  if (!delivery.webhook_url_encrypted) return fail("Disconnected");
  if (!delivery.enabled && delivery.event !== "test") return fail("Switched off");
  const key = encryptionKey();
  if (!key) return fail("Kaizena Flow could not read the address");
  let payload = delivery.payload;
  if (!payload) {
    payload = await platformPayload({ id: delivery.id, event: delivery.event, subjectId: delivery.subject_id, createdAt: delivery.created_at });
    if (!payload) return fail("What it was about no longer exists");
    if (delivery.provider === "slack") {
      payload = platformSlackMessage(payload);
      if (!payload) return fail("Slack is not sent this event");
    }
    await db().execute(sql`update commerce.platform_integration_deliveries set payload = ${JSON.stringify(payload)}::jsonb where id = ${delivery.id}::uuid`);
  }
  let url: string;
  let secret: string | null = null;
  try {
    url = decryptSecret(delivery.webhook_url_encrypted, key);
    if (delivery.provider === "webhook") secret = delivery.secret_encrypted ? decryptSecret(delivery.secret_encrypted, key) : null;
  } catch {
    return fail("Kaizena Flow could not read the address");
  }
  // One of the platform's own endpoints (D515): signed as a store's are (D354), and its health kept; a service through its own webhook.
  if (delivery.provider === "webhook" && !secret) return fail("Kaizena Flow could not read the address");
  const outcome =
    delivery.provider === "webhook"
      ? await postSigned(url, secret!, delivery.id, delivery.event, payload)
      : await postToService(delivery.provider, url, delivery.id, delivery.event, payload);
  const tries = delivery.attempts + 1;
  const wait = outcome.final ? undefined : RETRY_SECONDS[tries - 1];
  await db().execute(sql`
    update commerce.platform_integration_deliveries set
      attempts = ${tries},
      last_status = ${outcome.status}::int,
      last_error = ${outcome.error},
      status = ${outcome.ok ? "delivered" : wait === undefined || delivery.event === "test" ? "failed" : "pending"},
      delivered_at = ${outcome.ok ? sql`now()` : sql`null`},
      next_attempt_at = now() + make_interval(secs => ${wait ?? 0})
    where id = ${delivery.id}::uuid
  `);
  // An endpoint's health (D515), after the delivery is written, so one switched off leaves nothing pending.
  if (delivery.provider === "webhook" && delivery.endpoint_id && delivery.event !== "test") await keepPlatformEndpointHealth(delivery.endpoint_id, outcome.ok);
  if (!outcome.ok) log("warn", "platform_integrations.not_delivered", { provider: delivery.provider, event: delivery.event, status: outcome.status, tries });
  return outcome;
}

/**
 * Sends what is due, oldest first, as `deliverDue()` does a store's: each delivery claimed for five minutes before sending (outside any
 * transaction), so two runs never send it twice. Deliveries older than 30 days go.
 */
export async function deliverPlatformDue(limit = 25): Promise<{ delivered: number; retrying: number; failed: number }> {
  const ids = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      update commerce.platform_integration_deliveries set next_attempt_at = now() + interval '5 minutes'
      where id in (
        select id from commerce.platform_integration_deliveries
        where status = 'pending' and next_attempt_at <= now()
        order by next_attempt_at limit ${limit}
        for update skip locked
      )
      returning id
    `,
  );
  const claimed =
    ids.length === 0
      ? []
      : await typedRows(
          claimedRow,
          sql`
            select ${claimedColumns}
            from commerce.platform_integration_deliveries d
            ${claimedJoins}
            where d.id in (${sql.join(ids.map((r) => sql`${r.id}::uuid`), sql`, `)})
            order by d.created_at
          `,
        );
  const counts = { delivered: 0, retrying: 0, failed: 0 };
  for (const delivery of claimed) {
    const outcome = await attempt(delivery);
    if (outcome.ok) counts.delivered++;
    else if (!outcome.final && RETRY_SECONDS[delivery.attempts] !== undefined && delivery.webhook_url_encrypted && delivery.enabled) counts.retrying++;
    else counts.failed++;
  }
  await db().execute(sql`
    delete from commerce.platform_integration_deliveries where created_at < now() - make_interval(days => ${PLATFORM_DELIVERY_KEEP_DAYS})
  `);
  return counts;
}

/** Sends a test event now, and says how it went. */
export async function sendPlatformTest(admin: Account, provider: Provider): Promise<Outcome> {
  const integration = await getPlatformIntegration(provider);
  if (!integration) return { ok: false, status: null, error: null };
  const row = await typedRow(
    claimedRow,
    sql`
      with made as (
        insert into commerce.platform_integration_deliveries (provider, event, next_attempt_at)
        values (${provider}, 'test', now() + interval '5 minutes')
        returning *
      )
      select ${claimedColumns} from made d ${claimedJoins}
    `,
  );
  await audit(admin.id, null, "platform.integration_test_sent", { provider });
  return row ? attempt(row) : { ok: false, status: null, error: null };
}

/** Sends a test event to one of the platform's own endpoints now (D515), on or off, and says how it went; null when it is gone. */
export async function sendPlatformEndpointTest(admin: Account, endpointId: string): Promise<Outcome | null> {
  if (!/^[0-9a-f-]{36}$/i.test(endpointId)) return null;
  const row = await typedRow(
    claimedRow,
    sql`
      with made as (
        insert into commerce.platform_integration_deliveries (provider, event, endpoint_id, next_attempt_at)
        select 'webhook', 'test', e.id, now() + interval '5 minutes' from commerce.platform_webhook_endpoints e where e.id = ${endpointId}::uuid
        returning *
      )
      select ${claimedColumns} from made d ${claimedJoins}
    `,
  );
  if (!row) return null;
  await audit(admin.id, null, "platform.endpoint_test_sent", {}, { target: { type: "platform_webhook_endpoint", id: endpointId } });
  return attempt(row);
}

export type PlatformDeliveryRow = {
  id: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
};

/** The latest deliveries to a service, newest first. */
export async function listPlatformDeliveries(provider: Provider, limit = 25): Promise<PlatformDeliveryRow[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      event: col.text,
      status: z.enum(["pending", "delivered", "failed"]),
      attempts: col.int,
      last_status: col.int.nullable(),
      last_error: col.textOrNull,
      created_at: col.timestamp,
      next_attempt_at: col.timestamp,
    }),
    sql`
      select id, event, status, attempts, last_status, last_error, created_at, next_attempt_at
      from commerce.platform_integration_deliveries
      where provider = ${provider}
      order by created_at desc limit ${limit}
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    nextAttemptAt: row.next_attempt_at,
  }));
}
