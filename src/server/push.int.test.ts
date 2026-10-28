import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import webpush from "web-push";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

const push = await import("./push");
const { passMembership } = await import("./auth");
const { fxStore, paidOrder } = await import("./fulfilment-test-fixture");

/**
 * Push to staff devices (D361) against a real database: a device is kept only for a member who reads the store's orders and only on a push
 * service's address; a paid order rings each device once, its number and total only, in the person's language; a device the push service
 * says is gone is removed, as is one whose person no longer reads the orders.
 */

type Row = Record<string, unknown>;
type Sent = { endpoint: string; payload: Record<string, unknown>; options: Record<string, unknown> };

const device = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}-${Date.now().toString(36)}`,
  keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  device: `Phone ${n}`,
});

let store: Awaited<ReturnType<typeof fxStore>>;

beforeAll(async () => {
  store = await fxStore("push");
});

afterAll(async () => {
  await closeDb();
});

describe("push to staff devices (D361)", () => {
  it("keeps a device only for a member who reads the orders, on a push service's address", async () => {
    const owner = (await passMembership(store.slug, store.accountId))!;
    expect(await push.savePushSubscription(owner, { ...device(0), endpoint: "https://example.com/push" })).toEqual({ ok: false, problem: "invalid" });
    const noOrders = { ...owner, role: "admin", permissions: ["products:read"] } as typeof owner;
    expect(await push.savePushSubscription(noOrders, device(0))).toEqual({ ok: false, problem: "access" });
    expect(await push.savePushSubscription(owner, device(1))).toEqual({ ok: true });
    const devices = await push.pushDevicesOf(store.accountId);
    expect(devices.map((d) => d.device)).toContain("Phone 1");
  });

  it("rings each device once for a paid order with its number and total only, and removes a device that is gone", async () => {
    const owner = (await passMembership(store.slug, store.accountId))!;
    const gone = device(2);
    await push.savePushSubscription(owner, gone);
    await db().execute(sql`update commerce.accounts set admin_locale = 'nb-NO' where id = ${store.accountId}::uuid`);
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const sent: Sent[] = [];
    const count = await push.sendOrderPush(store.storeId, order.orderId, async (subscription, payload, options) => {
      if (subscription.endpoint === gone.endpoint) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options: options as Record<string, unknown> });
      return { statusCode: 201 };
    });
    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: `Ny ordre ${order.number}`, tag: `order-${order.number}` });
    expect(String(sent[0].payload.body)).toContain("Fx");
    expect(JSON.stringify(sent[0].payload)).not.toContain(order.email);
    expect(sent[0].options).toMatchObject({ TTL: 21600, vapidDetails: { publicKey: keys.publicKey } });
    const left = await db().execute<Row>(sql`select endpoint from commerce.push_subscriptions where store_id = ${store.storeId}::uuid`);
    expect(left.map((r) => r.endpoint)).not.toContain(gone.endpoint);
  });

  it("removes a device whose person no longer reads the store's orders", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.accounts set disabled_at = now() where id = ${store.accountId}::uuid`);
    let calls = 0;
    expect(await push.sendOrderPush(store.storeId, order.orderId, async () => ((calls += 1), { statusCode: 201 }))).toBe(0);
    expect(calls).toBe(0);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.push_subscriptions where store_id = ${store.storeId}::uuid`);
    expect(n).toBe(0);
  });
});
