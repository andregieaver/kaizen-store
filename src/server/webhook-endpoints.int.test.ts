import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret } from "@/lib/secret-box";
import { ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, TOPIC_HEADER, verifyWebhook } from "@/lib/webhook-signature";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
// The endpoint below is a server on this machine: the address guard lets tests reach it only with this switch (ignored on Vercel).
process.env.REPLICATE_ALLOW_PRIVATE = "1";
// The services' own sends (Zapier, Make, Slack) of other tests' stores never leave this machine.
vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));

const endpoints = await import("./webhook-endpoints");
const integrations = await import("./integrations");
const { newStore } = await import("./inventory-test-support");

/**
 * Events to an owner's own endpoints (wave 9 unit A, D354): queued by the database for the topics chosen, sent signed through the address
 * guard, the payload versioned and built when sent, an endpoint switched off after three days of failures with its owners told, a delivery
 * sent again with the same id, and the services left as they were.
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

let store: Awaited<ReturnType<typeof newStore>>;
let localUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  localUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/kaizena`;
  store = await newStore("hooks");
}, 120_000);

beforeEach(() => {
  received.length = 0;
  answers.length = 0;
});

afterAll(async () => {
  server.close();
  await closeDb();
});

/** Points an endpoint at the local server (an address `addEndpoint()` itself would refuse: http and an IP). */
async function pointHere(id: string) {
  const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
  await db().execute(sql`update commerce.webhook_endpoints set url_encrypted = ${encryptSecret(localUrl, key)} where id = ${id}::uuid`);
}

const deliveriesOf = (id: string) =>
  db().execute<Row>(sql`select id, event, status, subject_id, payload from commerce.integration_deliveries where endpoint_id = ${id}::uuid order by created_at`);

async function someProduct(): Promise<string> {
  const [row] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.storeId}::uuid and status = 'active' order by created_at limit 1`);
  return String(row.id);
}

describe("adding an endpoint", () => {
  it("refuses an address that is not https on a host name, no topics and no name, and keeps the secret only encrypted", async () => {
    expect(await endpoints.addEndpoint(store.member, { name: "Warehouse", url: "http://hooks.example.com/x", topics: ["order.paid"] })).toMatchObject({ ok: false, problem: "url" });
    expect(await endpoints.addEndpoint(store.member, { name: "Warehouse", url: "https://hooks.example.com/x", topics: ["nonsense"] })).toMatchObject({ ok: false, problem: "topics" });
    expect(await endpoints.addEndpoint(store.member, { name: "  ", url: "https://hooks.example.com/x", topics: ["order.paid"] })).toMatchObject({ ok: false, problem: "name" });
    const added = await endpoints.addEndpoint(store.member, { name: "Warehouse", url: "https://hooks.example.com/orders?key=1", topics: ["product.updated", "discount.created"] });
    if (!added.ok) throw new Error(added.problem);
    expect(added.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const [row] = await db().execute<Row>(sql`select hint, url_encrypted, secret_encrypted from commerce.webhook_endpoints where id = ${added.id}::uuid`);
    expect(row.hint).toBe("hooks.example.com/…");
    expect(String(row.secret_encrypted)).not.toContain(added.secret!);
    expect(String(row.url_encrypted)).not.toContain("hooks.example.com");
    const [listed] = await endpoints.listEndpoints(store.storeId);
    expect(listed).toMatchObject({ name: "Warehouse", enabled: true, topics: ["product.updated", "discount.created"] });
    await endpoints.removeEndpoint(store.member, added.id);
  });
});

describe("sending", () => {
  it("queues only the topics chosen, once while unsent, and sends them signed with a versioned payload", async () => {
    const added = await endpoints.addEndpoint(store.member, { name: "Sync", url: "https://hooks.example.com/sync", topics: ["product.updated"] });
    if (!added.ok) throw new Error(added.problem);
    await pointHere(added.id);
    const product = await someProduct();
    // Saved twice before the job runs: one delivery, which carries the product as it is when sent.
    await db().execute(sql`update commerce.products set updated_at = now() + interval '1 second' where id = ${product}::uuid`);
    await db().execute(sql`update commerce.products set updated_at = now() + interval '2 seconds' where id = ${product}::uuid`);
    await db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent) values (${store.storeId}::uuid, ${`HOOK${Date.now()}`}, 'percent', 10)`);
    const queued = await deliveriesOf(added.id);
    expect(queued.map((d) => d.event)).toEqual(["product.updated"]);

    await integrations.deliverDue(500);
    const mine = received.filter((r) => r.headers[TOPIC_HEADER.toLowerCase()] === "product.updated");
    expect(mine).toHaveLength(1);
    const [delivery] = mine;
    const body = JSON.parse(delivery.body) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body).toMatchObject({ id: String(queued[0].id), topic: "product.updated", version: 1, store: { slug: store.slug } });
    expect(body.data.product.id).toBe(product);
    expect(delivery.headers[ID_HEADER.toLowerCase()]).toBe(String(queued[0].id));
    expect(
      verifyWebhook({
        secret: added.secret!,
        signature: String(delivery.headers[SIGNATURE_HEADER.toLowerCase()]),
        timestamp: String(delivery.headers[TIMESTAMP_HEADER.toLowerCase()]),
        body: delivery.body,
      }),
    ).toBe(true);
    expect(verifyWebhook({ secret: "whsec_wrong", signature: String(delivery.headers[SIGNATURE_HEADER.toLowerCase()]), timestamp: String(delivery.headers[TIMESTAMP_HEADER.toLowerCase()]), body: delivery.body })).toBe(false);
    expect((await deliveriesOf(added.id))[0].status).toBe("delivered");

    // A test is signed too, and sent even while the endpoint is off.
    const tested = await integrations.sendEndpointTest(store.member, added.id);
    expect(tested?.ok).toBe(true);
    expect(JSON.parse(received.at(-1)!.body)).toMatchObject({ topic: "test", version: 1, data: { test: true } });
    await endpoints.removeEndpoint(store.member, added.id);
  });

  it("sends a delivery again with the same payload id, only while the endpoint is on", async () => {
    const added = await endpoints.addEndpoint(store.member, { name: "Again", url: "https://hooks.example.com/again", topics: ["discount.created"] });
    if (!added.ok) throw new Error(added.problem);
    await pointHere(added.id);
    await db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent) values (${store.storeId}::uuid, ${`AGAIN${Date.now()}`}, 'percent', 15)`);
    await integrations.deliverDue(500);
    const [first] = await deliveriesOf(added.id);
    expect(first.status).toBe("delivered");
    await endpoints.switchEndpoint(store.member, added.id, false);
    expect(await endpoints.resendDelivery(store.member, String(first.id))).toBe("off");
    await endpoints.switchEndpoint(store.member, added.id, true);
    expect(await endpoints.resendDelivery(store.member, String(first.id))).toBe("queued");
    received.length = 0;
    await integrations.deliverDue(500);
    const again = received.find((r) => r.headers[TOPIC_HEADER.toLowerCase()] === "discount.created");
    expect(JSON.parse(again!.body).id).toBe(String(first.id));
    expect(again!.headers[ID_HEADER.toLowerCase()]).not.toBe(String(first.id));
    await endpoints.removeEndpoint(store.member, added.id);
  });

  it("switches an endpoint off after three days of failures, fails what it has queued and tells its owners once", async () => {
    const added = await endpoints.addEndpoint(store.member, { name: "Broken", url: "https://hooks.example.com/broken", topics: ["product.updated"] });
    if (!added.ok) throw new Error(added.problem);
    await pointHere(added.id);
    const product = await someProduct();
    answers.push(500);
    await db().execute(sql`update commerce.products set updated_at = now() + interval '3 seconds' where id = ${product}::uuid`);
    await integrations.deliverDue(500);
    const [after] = await db().execute<Row>(sql`select enabled, failing_since from commerce.webhook_endpoints where id = ${added.id}::uuid`);
    expect(after).toMatchObject({ enabled: true });
    expect(after.failing_since).not.toBeNull();

    // Three days on, the next failure switches it off.
    await db().execute(sql`update commerce.webhook_endpoints set failing_since = now() - interval '4 days' where id = ${added.id}::uuid`);
    await db().execute(sql`update commerce.integration_deliveries set next_attempt_at = now() where endpoint_id = ${added.id}::uuid and status = 'pending'`);
    answers.push(500, 500);
    await integrations.deliverDue(500);
    const [off] = await db().execute<Row>(sql`select enabled, disabled_reason from commerce.webhook_endpoints where id = ${added.id}::uuid`);
    expect(off).toMatchObject({ enabled: false, disabled_reason: "failing" });
    expect((await deliveriesOf(added.id)).every((d) => d.status !== "pending")).toBe(true);
    const emails = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'integration.endpoint_off'`);
    expect(emails[0].n).toBe(1);
    // An endpoint that is off gets nothing queued.
    await db().execute(sql`update commerce.products set updated_at = now() + interval '4 seconds' where id = ${product}::uuid`);
    expect((await deliveriesOf(added.id)).filter((d) => d.status === "pending")).toHaveLength(0);
    await endpoints.removeEndpoint(store.member, added.id);
  });

  it("renews a secret, and a removed endpoint takes its log with it", async () => {
    const added = await endpoints.addEndpoint(store.member, { name: "Renew", url: "https://hooks.example.com/renew", topics: ["discount.created"] });
    if (!added.ok) throw new Error(added.problem);
    const renewed = await endpoints.renewSecret(store.member, added.id);
    expect(renewed.ok && renewed.secret !== added.secret).toBe(true);
    await db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent) values (${store.storeId}::uuid, ${`GONE${Date.now()}`}, 'percent', 5)`);
    expect(await deliveriesOf(added.id)).toHaveLength(1);
    expect(await endpoints.removeEndpoint(store.member, added.id)).toBe(true);
    expect(await deliveriesOf(added.id)).toHaveLength(0);
  });
});

describe("the services", () => {
  it("are never sent the endpoints' own events", async () => {
    expect(await integrations.saveIntegration(store.member, "zapier", { url: "https://hooks.zapier.com/hooks/catch/1234567/abcdefg/", events: ["product.updated"], enabled: true })).toEqual({
      ok: false,
      problems: ["Choose at least one event to send."],
    });
  });
});
