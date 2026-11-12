import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isPlatformEvent, type PlatformEvent } from "@/lib/platform-integrations";
import { encryptSecret } from "@/lib/secret-box";
import { checkEndpointUrl } from "@/lib/webhook-signature";

import { audit, type Account } from "./auth";
import { log } from "./log";
import { hostProblem } from "./replicate-fetch";
import { encryptionKey } from "./encryption-key";
import { col, typedRow, typedRows } from "./typed-rows";
import { ENDPOINTS_MAX, FAILING_DAYS, type EndpointProblem, type SaveOutcome } from "./webhook-endpoints";

/**
 * Kaizena Flow's own endpoints (C4 of `docs/platform-parity-plan.md`, D515): a store's own endpoints (D354, `webhook-endpoints.ts`) for the
 * platform's events (D465: a request, a store made or opened, a plan started, changed, cancelled or not paid, a notice of illegal content).
 * The only writer of `commerce.platform_webhook_endpoints`. An endpoint is an HTTPS address that passes the address guard when it is saved
 * and again at each send, the events it gets, and a signing secret of 32 random bytes kept encrypted and shown once. The database queues
 * each event for every endpoint that is on and asks for it (`commerce.queue_platform_event()`); `deliverPlatformDue()` signs and sends them
 * as a store's are, with the same headers. A platform owner adds and changes them (the settings area, D510); the others read.
 */

export { ENDPOINTS_MAX, FAILING_DAYS };

export type PlatformEndpoint = {
  id: string;
  name: string;
  hint: string;
  topics: PlatformEvent[];
  enabled: boolean;
  failingSince: string | null;
  disabledReason: "failing" | "owner" | null;
  lastDelivery: { status: "pending" | "delivered" | "failed"; at: string } | null;
  recentFailures: number;
};

const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

/** The platform's endpoints, oldest first, with how each is doing. */
export async function listPlatformEndpoints(): Promise<PlatformEndpoint[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      name: col.text,
      hint: col.text,
      topics: z.array(z.string()),
      enabled: col.bool,
      failing_since: col.timestampOrNull,
      disabled_reason: col.textOrNull,
      last_status: z.enum(["pending", "delivered", "failed"]).nullable(),
      last_at: col.timestampOrNull,
      failures: col.int,
    }),
    sql`
      select e.id, e.name, e.hint, e.topics, e.enabled, e.failing_since, e.disabled_reason,
        last.status as last_status, last.created_at as last_at,
        (select count(*)::int from commerce.platform_integration_deliveries d
          where d.endpoint_id = e.id and d.status = 'failed' and d.created_at > now() - interval '7 days') as failures
      from commerce.platform_webhook_endpoints e
      left join lateral (
        select d.status, d.created_at from commerce.platform_integration_deliveries d where d.endpoint_id = e.id order by d.created_at desc limit 1
      ) last on true
      order by e.created_at, e.id
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    hint: row.hint,
    topics: row.topics.filter(isPlatformEvent),
    enabled: row.enabled,
    failingSince: iso(row.failing_since),
    disabledReason: row.disabled_reason === "failing" || row.disabled_reason === "owner" ? row.disabled_reason : null,
    lastDelivery: row.last_status && row.last_at ? { status: row.last_status, at: iso(row.last_at)! } : null,
    recentFailures: row.failures,
  }));
}

export type PlatformEndpointInput = { name: string; url?: string; topics: string[] };

type Checked = { name: string; topics: PlatformEvent[]; url: { url: string; hint: string } | null };

async function check(input: PlatformEndpointInput, needUrl: boolean): Promise<{ ok: true; value: Checked } | { ok: false; problem: EndpointProblem; detail?: string }> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) return { ok: false, problem: "name" };
  const topics = [...new Set(input.topics.filter(isPlatformEvent))];
  if (topics.length === 0) return { ok: false, problem: "topics" };
  const text = (input.url ?? "").trim();
  if (!text) return needUrl ? { ok: false, problem: "url" } : { ok: true, value: { name, topics, url: null } };
  const url = checkEndpointUrl(text);
  if (!url.ok) return { ok: false, problem: "url", detail: url.problem };
  // The address guard at save: never a private, loopback or link-local address. It is asked again at every send (`safeFetch()`).
  const blocked = await hostProblem(new URL(url.url).hostname);
  if (blocked) return { ok: false, problem: "address", detail: blocked };
  return { ok: true, value: { name, topics, url: { url: url.url, hint: url.hint } } };
}

/** A new signing secret, as the receiver keeps it: `whsec_` and 32 random bytes in base64url (D354). */
const newSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

const topicArray = (topics: readonly string[]) => sql`array[${sql.join(topics.map((t) => sql`${t}`), sql`, `)}]::text[]`;

/** Adds an endpoint, on; answers its secret, which is shown once and never again. */
export async function addPlatformEndpoint(admin: Account, input: PlatformEndpointInput): Promise<SaveOutcome> {
  const checked = await check(input, true);
  if (!checked.ok) return checked;
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "key" };
  const { name, topics, url } = checked.value;
  const secret = newSecret();
  const made = await db().transaction(async (tx) => {
    // One at a time, so two presses cannot pass the limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_webhook_endpoints'))`);
    const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.platform_webhook_endpoints`);
    if (Number(count?.n ?? 0) >= ENDPOINTS_MAX) return null;
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.platform_webhook_endpoints (name, url_encrypted, hint, secret_encrypted, topics, created_by)
      values (${name}, ${encryptSecret(url!.url, key)}, ${url!.hint}, ${encryptSecret(secret, key)}, ${topicArray(topics)}, ${admin.id}::uuid)
      returning id
    `);
    return String(row.id);
  });
  if (!made) return { ok: false, problem: "limit" };
  await audit(admin.id, null, "platform.endpoint_added", { topics }, { target: { type: "platform_webhook_endpoint", id: made } });
  return { ok: true, id: made, secret };
}

/** Changes an endpoint's name, events and, when one is given, its address; the secret stays. */
export async function updatePlatformEndpoint(admin: Account, id: string, input: PlatformEndpointInput): Promise<SaveOutcome> {
  if (!isUuid(id)) return { ok: false, problem: "gone" };
  const checked = await check(input, false);
  if (!checked.ok) return checked;
  const key = encryptionKey();
  const { name, topics, url } = checked.value;
  if (url && !key) return { ok: false, problem: "key" };
  const rows = await db().execute(sql`
    update commerce.platform_webhook_endpoints set name = ${name}, topics = ${topicArray(topics)},
      ${url && key ? sql`url_encrypted = ${encryptSecret(url.url, key)}, hint = ${url.hint}, failing_since = null,` : sql``}
      updated_at = now()
    where id = ${id}::uuid
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "gone" };
  await audit(admin.id, null, "platform.endpoint_changed", { topics, newAddress: Boolean(url) }, { target: { type: "platform_webhook_endpoint", id } });
  return { ok: true, id };
}

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Switches an endpoint on (its count of failures afresh) or off (what is queued is not sent: each says *Switched off*). */
export async function switchPlatformEndpoint(admin: Account, id: string, on: boolean): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db().execute(sql`
    update commerce.platform_webhook_endpoints set enabled = ${on}, disabled_reason = ${on ? null : "owner"}, failing_since = null, updated_at = now()
    where id = ${id}::uuid returning id
  `);
  if (rows.length === 0) return false;
  await audit(admin.id, null, on ? "platform.endpoint_on" : "platform.endpoint_off", {}, { target: { type: "platform_webhook_endpoint", id } });
  return true;
}

/** A new signing secret; the old one stops working at once. Answers the new one, shown once. */
export async function renewPlatformSecret(admin: Account, id: string): Promise<{ ok: true; secret: string } | { ok: false; problem: EndpointProblem }> {
  if (!isUuid(id)) return { ok: false, problem: "gone" };
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "key" };
  const secret = newSecret();
  const rows = await db().execute(sql`
    update commerce.platform_webhook_endpoints set secret_encrypted = ${encryptSecret(secret, key)}, updated_at = now() where id = ${id}::uuid returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "gone" };
  await audit(admin.id, null, "platform.endpoint_secret_renewed", {}, { target: { type: "platform_webhook_endpoint", id } });
  return { ok: true, secret };
}

/** Removes an endpoint; its queue and log go with it. */
export async function removePlatformEndpoint(admin: Account, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db().execute(sql`delete from commerce.platform_webhook_endpoints where id = ${id}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(admin.id, null, "platform.endpoint_removed", {}, { target: { type: "platform_webhook_endpoint", id } });
  return true;
}

/**
 * Sends a delivery again (a failed one, or one that arrived and is wanted once more): a new delivery of the same content, its payload's
 * `id` kept so the receiver can tell it is the same event. Only for an endpoint that is on, and never one about a request that was blanked.
 */
export async function resendPlatformDelivery(admin: Account, deliveryId: string): Promise<"queued" | "off" | "gone" | "erased"> {
  if (!isUuid(deliveryId)) return "gone";
  const row = await typedRow(
    z.object({ endpoint_id: col.uuid, enabled: col.bool, erased: col.bool, id: col.uuid.nullable() }),
    sql`
      with source as (
        select d.* from commerce.platform_integration_deliveries d
        where d.id = ${deliveryId}::uuid and d.provider = 'webhook' and d.status <> 'pending'
      ),
      endpoint as (
        select e.id, e.enabled from commerce.platform_webhook_endpoints e join source s on s.endpoint_id = e.id
      ),
      made as (
        insert into commerce.platform_integration_deliveries (provider, event, subject_id, endpoint_id, payload)
        select 'webhook', s.event, s.subject_id, s.endpoint_id, s.payload
        from source s join endpoint e on e.id = s.endpoint_id
        where e.enabled and s.payload is not null
        returning id
      )
      select s.endpoint_id, coalesce(e.enabled, false) as enabled, s.payload is null and s.status = 'delivered' as erased, (select id from made) as id
      from source s left join endpoint e on e.id = s.endpoint_id
    `,
  );
  if (!row) return "gone";
  if (!row.enabled) return "off";
  if (row.erased) return "erased";
  if (!row.id) return "gone";
  await audit(admin.id, null, "platform.endpoint_delivery_resent", { deliveryId }, { target: { type: "platform_webhook_endpoint", id: row.endpoint_id } });
  return "queued";
}

export type PlatformEndpointDelivery = {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
};

/** An endpoint's latest deliveries, newest first. */
export async function listPlatformEndpointDeliveries(endpointId: string, limit = 10): Promise<PlatformEndpointDelivery[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      event: col.text,
      status: z.enum(["pending", "delivered", "failed"]),
      last_status: col.int.nullable(),
      last_error: col.textOrNull,
      created_at: col.timestamp,
    }),
    sql`
      select id, event, status, last_status, last_error, created_at from commerce.platform_integration_deliveries
      where endpoint_id = ${endpointId}::uuid order by created_at desc limit ${limit}
    `,
  );
  return rows.map((r) => ({ id: r.id, event: r.event, status: r.status, lastStatus: r.last_status, lastError: r.last_error, createdAt: r.created_at }));
}

/**
 * An endpoint's failures, as a store's (D354): a delivery that arrives clears them; one that fails starts the count, and an endpoint where
 * everything has failed for `FAILING_DAYS` is switched off (`disabled_reason = 'failing'`) and what it still has queued marked failed. The
 * Integrations page says so. Tests do not count.
 */
export async function keepPlatformEndpointHealth(endpointId: string, ok: boolean): Promise<void> {
  if (ok) {
    await db().execute(sql`update commerce.platform_webhook_endpoints set failing_since = null where id = ${endpointId}::uuid and failing_since is not null`);
    return;
  }
  await db().execute(sql`update commerce.platform_webhook_endpoints set failing_since = now() where id = ${endpointId}::uuid and failing_since is null`);
  const off = await db().execute(sql`
    update commerce.platform_webhook_endpoints set enabled = false, disabled_reason = 'failing', updated_at = now()
    where id = ${endpointId}::uuid and enabled and failing_since <= now() - make_interval(days => ${FAILING_DAYS})
    returning id
  `);
  if (off.length === 0) return;
  await db().execute(sql`
    update commerce.platform_integration_deliveries set status = 'failed', last_error = 'Switched off' where endpoint_id = ${endpointId}::uuid and status = 'pending'
  `);
  log("warn", "platform_integrations.endpoint_switched_off", { endpointId });
}
