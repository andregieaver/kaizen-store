import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret } from "@/lib/secret-box";
import { ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, TOPIC_HEADER, verifyWebhook } from "@/lib/webhook-signature";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
// The endpoint below is a server on this machine: the address guard lets tests reach it only with this switch (ignored on Vercel).
process.env.REPLICATE_ALLOW_PRIVATE = "1";
// The services' own sends (Zapier, Make, Slack) never leave this machine.
vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));

const endpoints = await import("./platform-endpoints");
const platform = await import("./platform-integrations");

/**
 * Kaizena Flow's own endpoints (C4, D515) against a real database: added with a secret shown once, queued by the database for the events
 * chosen, sent signed as a store's are, tested, sent again with the same id, not sent while off, switched off after three days of failures,
 * and removed with their log.
 */

type Received = { headers: http.IncomingHttpHeaders; body: string };
const received: Received[] = [];
const answers: number[] = [];
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    received.push({ headers: request.headers, body });
    response.statusCode = answers.shift() ?? 200;
    response.end("ok");
  });
});

const run = Date.now().toString(36);
let localUrl: string;
let admin: Account;
let storeId: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  localUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/platform`;
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`hooks-${run}@example.com`}, 'Hanne', true) returning id`);
  admin = { id: String(account.id), email: "x", name: null, platformAdmin: true } as Account;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`hooks-owner-${run}@example.com`}, 'O', 'Kroken') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`kroken-${run}`}, 'Kroken', null)`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${`kroken-${run}`}`);
  storeId = String(store.id);
}, 120_000);

beforeEach(() => {
  received.length = 0;
  answers.length = 0;
});

afterAll(async () => {
  server.close();
  await db().execute(sql`delete from commerce.platform_webhook_endpoints where created_by = ${admin.id}::uuid`);
  await closeDb();
});

/** Points an endpoint at the local server (an address the guard itself would refuse: http and an IP). */
async function pointHere(id: string) {
  const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
  await db().execute(sql`update commerce.platform_webhook_endpoints set url_encrypted = ${encryptSecret(localUrl, key)} where id = ${id}::uuid`);
}

const deliveriesOf = (id: string) =>
  db().execute<Row>(sql`select id, event, status, last_error, payload from commerce.platform_integration_deliveries where endpoint_id = ${id}::uuid order by created_at`);

const signedBy = (secret: string, r: Received) =>
  verifyWebhook({ secret, signature: String(r.headers[SIGNATURE_HEADER.toLowerCase()]), timestamp: String(r.headers[TIMESTAMP_HEADER.toLowerCase()]), body: r.body });

describe("the platform's own endpoints (D515)", () => {
  it("refuses a bad address, no events or no name, and keeps the secret only encrypted", async () => {
    expect(await endpoints.addPlatformEndpoint(admin, { name: "CRM", url: "http://hooks.example.com/x", topics: ["store.opened"] })).toMatchObject({ ok: false, problem: "url" });
    expect(await endpoints.addPlatformEndpoint(admin, { name: "CRM", url: "https://hooks.example.com/x", topics: ["order.paid"] })).toMatchObject({ ok: false, problem: "topics" });
    expect(await endpoints.addPlatformEndpoint(admin, { name: " ", url: "https://hooks.example.com/x", topics: ["store.opened"] })).toMatchObject({ ok: false, problem: "name" });
    const added = await endpoints.addPlatformEndpoint(admin, { name: "CRM", url: "https://hooks.example.com/kaizena?key=1", topics: ["store.opened", "plan.started"] });
    if (!added.ok) throw new Error(added.problem);
    expect(added.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const [row] = await db().execute<Row>(sql`select hint, url_encrypted, secret_encrypted from commerce.platform_webhook_endpoints where id = ${added.id}::uuid`);
    expect(String(row.secret_encrypted)).not.toContain(added.secret!);
    expect(String(row.url_encrypted)).not.toContain("hooks.example.com");
    expect((await endpoints.listPlatformEndpoints()).find((e) => e.id === added.id)).toMatchObject({ name: "CRM", enabled: true, topics: ["store.opened", "plan.started"] });
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where account_id = ${admin.id}::uuid and action = 'platform.endpoint_added'`);
    expect(Number(audited.n)).toBe(1);
    expect(await endpoints.removePlatformEndpoint(admin, added.id)).toBe(true);
    expect(await endpoints.removePlatformEndpoint(admin, added.id)).toBe(false);
  });

  it("queues only the events chosen, sends them signed, tests, and sends a delivery again with the same id", async () => {
    const added = await endpoints.addPlatformEndpoint(admin, { name: "Sync", url: "https://hooks.example.com/sync", topics: ["store.opened"] });
    if (!added.ok) throw new Error(added.problem);
    await pointHere(added.id);
    await db().execute(sql`select commerce.queue_platform_event('store.opened', ${storeId}::uuid)`);
    await db().execute(sql`select commerce.queue_platform_event('plan.started', ${storeId}::uuid)`);
    const queued = await deliveriesOf(added.id);
    expect(queued.map((d) => d.event)).toEqual(["store.opened"]);

    await platform.deliverPlatformDue(500);
    const mine = received.filter((r) => r.headers[TOPIC_HEADER.toLowerCase()] === "store.opened");
    expect(mine).toHaveLength(1);
    const body = JSON.parse(mine[0].body) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body).toMatchObject({ id: String(queued[0].id), event: "store.opened", platform: { name: "Kaizena Flow" }, store: { id: storeId } });
    expect(mine[0].headers[ID_HEADER.toLowerCase()]).toBe(String(queued[0].id));
    expect(signedBy(added.secret!, mine[0])).toBe(true);
    expect(signedBy("whsec_wrong", mine[0])).toBe(false);
    expect((await deliveriesOf(added.id))[0].status).toBe("delivered");

    // A test: signed too.
    const tested = await platform.sendPlatformEndpointTest(admin, added.id);
    expect(tested?.ok).toBe(true);
    expect(JSON.parse(received.at(-1)!.body)).toMatchObject({ event: "test", test: true });
    expect(signedBy(added.secret!, received.at(-1)!)).toBe(true);

    // Sent again: a new delivery of the same body, its id kept.
    expect(await endpoints.resendPlatformDelivery(admin, String(queued[0].id))).toBe("queued");
    received.length = 0;
    await platform.deliverPlatformDue(500);
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body).id).toBe(String(queued[0].id));

    // A new secret signs what is sent next; the old one no longer does.
    const renewed = await endpoints.renewPlatformSecret(admin, added.id);
    if (!renewed.ok) throw new Error(renewed.problem);
    await platform.sendPlatformEndpointTest(admin, added.id);
    expect(signedBy(renewed.secret, received.at(-1)!)).toBe(true);
    expect(signedBy(added.secret!, received.at(-1)!)).toBe(false);
    await endpoints.removePlatformEndpoint(admin, added.id);
    expect(await deliveriesOf(added.id)).toEqual([]);
  });

  it("sends nothing while off, and switches an endpoint off after three days of failures", async () => {
    const added = await endpoints.addPlatformEndpoint(admin, { name: "Flaky", url: "https://hooks.example.com/flaky", topics: ["store.opened"] });
    if (!added.ok) throw new Error(added.problem);
    await pointHere(added.id);

    // Off: what was queued is not sent, and is not sent again.
    await db().execute(sql`select commerce.queue_platform_event('store.opened', ${storeId}::uuid)`);
    expect(await endpoints.switchPlatformEndpoint(admin, added.id, false)).toBe(true);
    await platform.deliverPlatformDue(500);
    const [off] = await deliveriesOf(added.id);
    expect(off).toMatchObject({ status: "failed", last_error: "Switched off" });
    expect(await endpoints.resendPlatformDelivery(admin, String(off.id))).toBe("off");
    await db().execute(sql`select commerce.queue_platform_event('store.opened', ${storeId}::uuid)`);
    expect(await deliveriesOf(added.id)).toHaveLength(1);

    // On again, failing for three days: switched off, by Kaizena Flow.
    expect(await endpoints.switchPlatformEndpoint(admin, added.id, true)).toBe(true);
    await db().execute(sql`select commerce.queue_platform_event('store.opened', ${storeId}::uuid)`);
    await db().execute(sql`update commerce.platform_webhook_endpoints set failing_since = now() - interval '4 days' where id = ${added.id}::uuid`);
    answers.push(500);
    await platform.deliverPlatformDue(500);
    const [endpoint] = await endpoints.listPlatformEndpoints().then((all) => all.filter((e) => e.id === added.id));
    expect(endpoint).toMatchObject({ enabled: false, disabledReason: "failing" });
    expect((await deliveriesOf(added.id)).at(-1)).toMatchObject({ status: "failed", last_error: "Switched off" });
    await endpoints.removePlatformEndpoint(admin, added.id);
  });
});
