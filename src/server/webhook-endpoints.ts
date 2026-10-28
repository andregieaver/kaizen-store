import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isEvent, type IntegrationEvent } from "@/lib/integrations";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { checkEndpointUrl } from "@/lib/webhook-signature";

import { audit, type Membership } from "./auth";
import { hostProblem } from "./replicate-fetch";
import { encryptionKey } from "./settings";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * An owner's own endpoints (D354): the only writer of `commerce.webhook_endpoints`. An endpoint is an HTTPS address that passes the address
 * guard (`hostProblem()`) when it is saved and again at each send (`safeFetch()`), the topics it gets, and a signing secret of 32 random bytes,
 * kept encrypted and shown once (on adding and on renewing). The database queues each event for every endpoint that is on and asks for it
 * (`commerce.queue_integration_event()`); `src/server/integrations.ts` signs and sends them. Owners only, as the services are (D41).
 */

/** Most endpoints a store keeps. */
export const ENDPOINTS_MAX = 10;
/** Days of failed deliveries, with none arriving, after which an endpoint is switched off and its owners told. */
export const FAILING_DAYS = 3;

export type Endpoint = {
  id: string;
  name: string;
  hint: string;
  topics: IntegrationEvent[];
  enabled: boolean;
  failingSince: string | null;
  disabledReason: "failing" | "owner" | null;
  lastDelivery: { status: "pending" | "delivered" | "failed"; at: string } | null;
  /** Deliveries that gave up in the last 7 days. */
  recentFailures: number;
};

const endpointRow = z.object({
  id: col.uuid,
  name: col.text,
  hint: col.text,
  topics: z.array(z.string()),
  enabled: col.bool,
  failing_since: col.timestamp.nullable(),
  disabled_reason: col.text.nullable(),
  last_status: col.text.nullable(),
  last_at: col.timestamp.nullable(),
  failures: col.int,
});

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

/** The store's endpoints, newest last, with how each is doing. */
export async function listEndpoints(storeId: string): Promise<Endpoint[]> {
  const rows = await typedRows(
    endpointRow,
    sql`
      select e.id, e.name, e.hint, e.topics, e.enabled, e.failing_since, e.disabled_reason,
        last.status as last_status, last.created_at as last_at,
        (select count(*)::int from commerce.integration_deliveries d
          where d.endpoint_id = e.id and d.status = 'failed' and d.created_at > now() - interval '7 days') as failures
      from commerce.webhook_endpoints e
      left join lateral (
        select d.status, d.created_at from commerce.integration_deliveries d where d.endpoint_id = e.id order by d.created_at desc limit 1
      ) last on true
      where e.store_id = ${storeId}::uuid
      order by e.created_at, e.id
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    hint: row.hint,
    topics: row.topics.filter(isEvent),
    enabled: row.enabled,
    failingSince: iso(row.failing_since),
    disabledReason: row.disabled_reason === "failing" || row.disabled_reason === "owner" ? row.disabled_reason : null,
    lastDelivery: row.last_status && row.last_at ? { status: row.last_status as "pending" | "delivered" | "failed", at: iso(row.last_at)! } : null,
    recentFailures: row.failures,
  }));
}

export type EndpointInput = { name: string; url?: string; topics: string[] };

/** What saving says, by problem; the screen words each in the owner's language. */
export type EndpointProblem = "name" | "topics" | "url" | "address" | "key" | "limit" | "gone";

type Checked = { name: string; topics: IntegrationEvent[]; url: { url: string; hint: string } | null };

async function check(input: EndpointInput, needUrl: boolean): Promise<{ ok: true; value: Checked } | { ok: false; problem: EndpointProblem; detail?: string }> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) return { ok: false, problem: "name" };
  const topics = [...new Set(input.topics.filter(isEvent))];
  if (topics.length === 0) return { ok: false, problem: "topics" };
  const text = (input.url ?? "").trim();
  if (!text) return needUrl ? { ok: false, problem: "url" } : { ok: true, value: { name, topics, url: null } };
  const url = checkEndpointUrl(text);
  if (!url.ok) return { ok: false, problem: "url", detail: url.problem };
  // The address guard at save (rule 4): never a private, loopback or link-local address. It is asked again at every send.
  const blocked = await hostProblem(new URL(url.url).hostname);
  if (blocked) return { ok: false, problem: "address", detail: blocked };
  return { ok: true, value: { name, topics, url: { url: url.url, hint: url.hint } } };
}

/** A new signing secret, as the receiver keeps it: `whsec_` and 32 random bytes in base64url. */
const newSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

export type SaveOutcome = { ok: true; id: string; secret?: string } | { ok: false; problem: EndpointProblem; detail?: string };

/** Adds an endpoint, on; answers its secret, which is shown once and never again. */
export async function addEndpoint({ account, store }: Membership, input: EndpointInput): Promise<SaveOutcome> {
  const checked = await check(input, true);
  if (!checked.ok) return checked;
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "key" };
  const { name, topics, url } = checked.value;
  const secret = newSecret();
  const made = await db().transaction(async (tx) => {
    // One at a time per store, so two presses cannot pass the limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('webhook_endpoints'), hashtext(${store.id}))`);
    const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.webhook_endpoints where store_id = ${store.id}::uuid`);
    if (Number(count?.n ?? 0) >= ENDPOINTS_MAX) return null;
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics, created_by)
      values (${store.id}::uuid, ${name}, ${encryptSecret(url!.url, key)}, ${url!.hint}, ${encryptSecret(secret, key)},
        ${`{${topics.join(",")}}`}::text[], ${account.id}::uuid)
      returning id
    `);
    return String(row.id);
  });
  if (!made) return { ok: false, problem: "limit" };
  await audit(account.id, store.id, "integration.endpoint_added", { topics }, { target: { type: "webhook_endpoint", id: made } });
  return { ok: true, id: made, secret };
}

/** Changes an endpoint's name, topics and, when one is given, its address; the secret stays. */
export async function updateEndpoint({ account, store }: Membership, id: string, input: EndpointInput): Promise<SaveOutcome> {
  const checked = await check(input, false);
  if (!checked.ok) return checked;
  const key = encryptionKey();
  const { name, topics, url } = checked.value;
  if (url && !key) return { ok: false, problem: "key" };
  const rows = await db().execute<{ id: string }>(sql`
    update commerce.webhook_endpoints set name = ${name}, topics = ${`{${topics.join(",")}}`}::text[],
      ${url && key ? sql`url_encrypted = ${encryptSecret(url.url, key)}, hint = ${url.hint}, failing_since = null,` : sql``}
      updated_at = now()
    where store_id = ${store.id}::uuid and id = ${id}::uuid
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "gone" };
  await audit(account.id, store.id, "integration.endpoint_changed", { topics, newAddress: Boolean(url) }, { target: { type: "webhook_endpoint", id } });
  return { ok: true, id };
}

/**
 * Switches an endpoint on or off. On again starts its count of failures afresh; off by the owner keeps what is queued from being sent
 * (each says *Switched off* in the log).
 */
export async function switchEndpoint({ account, store }: Membership, id: string, on: boolean): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.webhook_endpoints set enabled = ${on}, disabled_reason = ${on ? null : "owner"}, failing_since = null, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${id}::uuid
    returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, store.id, on ? "integration.endpoint_on" : "integration.endpoint_off", {}, { target: { type: "webhook_endpoint", id } });
  return true;
}

/** A new signing secret; the old one stops working at once. Answers the new one, shown once. */
export async function renewSecret({ account, store }: Membership, id: string): Promise<{ ok: true; secret: string } | { ok: false; problem: EndpointProblem }> {
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "key" };
  const secret = newSecret();
  const rows = await db().execute(sql`
    update commerce.webhook_endpoints set secret_encrypted = ${encryptSecret(secret, key)}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${id}::uuid
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "gone" };
  await audit(account.id, store.id, "integration.endpoint_secret_renewed", {}, { target: { type: "webhook_endpoint", id } });
  return { ok: true, secret };
}

/** Removes an endpoint; its queue and log go with it. */
export async function removeEndpoint({ account, store }: Membership, id: string): Promise<boolean> {
  const rows = await db().execute(sql`
    delete from commerce.webhook_endpoints where store_id = ${store.id}::uuid and id = ${id}::uuid returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, store.id, "integration.endpoint_removed", {}, { target: { type: "webhook_endpoint", id } });
  return true;
}

/**
 * Sends a delivery again (a failed one, or one that arrived and is wanted once more): a new delivery of the same content, the payload's `id`
 * kept so the receiver can tell it is the same event. Only for an endpoint that is on.
 */
export async function resendDelivery({ account, store }: Membership, deliveryId: string): Promise<"queued" | "off" | "gone"> {
  const row = await typedRow(
    z.object({ endpoint_id: col.uuid, enabled: col.bool, id: col.uuid.nullable() }),
    sql`
      with source as (
        select d.* from commerce.integration_deliveries d
        join commerce.webhook_endpoints e on e.id = d.endpoint_id and e.store_id = d.store_id
        where d.store_id = ${store.id}::uuid and d.id = ${deliveryId}::uuid and d.status <> 'pending'
      ),
      made as (
        insert into commerce.integration_deliveries (store_id, provider, event, subject_id, endpoint_id, payload)
        select s.store_id, s.provider, s.event, s.subject_id, s.endpoint_id, s.payload
        from source s join commerce.webhook_endpoints e on e.id = s.endpoint_id and e.enabled
        returning id
      )
      select s.endpoint_id, e.enabled, (select id from made) as id
      from source s join commerce.webhook_endpoints e on e.id = s.endpoint_id
    `,
  );
  if (!row) return "gone";
  if (!row.id) return "off";
  await audit(account.id, store.id, "integration.endpoint_resent", {}, { target: { type: "webhook_endpoint", id: row.endpoint_id } });
  return "queued";
}

export type EndpointDelivery = {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
};

/** An endpoint's latest deliveries, newest first. */
export async function listEndpointDeliveries(storeId: string, endpointId: string, limit = 25): Promise<EndpointDelivery[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      event: col.text,
      status: z.enum(["pending", "delivered", "failed"]),
      attempts: col.int,
      last_status: col.int.nullable(),
      last_error: col.text.nullable(),
      created_at: col.timestamp,
      next_attempt_at: col.timestamp,
    }),
    sql`
      select id, event, status, attempts, last_status, last_error, created_at, next_attempt_at
      from commerce.integration_deliveries
      where store_id = ${storeId}::uuid and endpoint_id = ${endpointId}::uuid
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
    createdAt: iso(row.created_at)!,
    nextAttemptAt: iso(row.next_attempt_at)!,
  }));
}

/** An endpoint's address and secret, for its delivery only (never a page). */
export function openEndpoint(encryptedUrl: string, encryptedSecret: string): { url: string; secret: string } | null {
  const key = encryptionKey();
  if (!key) return null;
  try {
    return { url: decryptSecret(encryptedUrl, key), secret: decryptSecret(encryptedSecret, key) };
  } catch {
    return null;
  }
}
