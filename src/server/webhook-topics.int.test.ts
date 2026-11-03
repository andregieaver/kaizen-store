import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { EVENTS } from "@/lib/integrations";
import { PAYLOAD_VERSION } from "@/lib/webhook-signature";
import { WEBHOOK_TEST_DATA, WEBHOOK_TOPICS, webhookEnvelope } from "@/lib/webhook-topics";
import { z } from "zod";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const logged: { event: string; fields: Record<string, unknown> }[] = [];
vi.mock("./log", () => ({ log: (_level: string, event: string, fields: Record<string, unknown> = {}) => logged.push({ event, fields }) }));

const integrations = await import("./integrations");
const { markSent } = await import("./order-admin");
const { setArchived } = await import("./products");
const { newStore, pay, place, variantId } = await import("./inventory-test-support");

/**
 * The webhook topics' contracts (D438) against a real database: every topic's subject is made in a store (an order paid and sent, a
 * customer, a subscription, a return, a confirmed withdrawal, a product, a low stock crossing, a discount code, support waiting), its
 * payload built as an endpoint would be sent it, and parsed with the topic's schema; a test delivery's sample order too. No payload of
 * another shape is logged on the way.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const subjects: Partial<Record<string, string | null>> = {};
const SKU = "DEMO-MUG-WHITE";

beforeAll(async () => {
  store = await newStore("topics");
  const order = await place(store.storeId, [[SKU, 2]]);
  await pay(store.storeId, order, store.account);
  const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${order.orderId}::uuid order by id limit 1`);
  const sent = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "TOPIC1", trackingUrl: null }, store.accountId, null, { lines: null });
  if (!sent.ok) throw new Error(sent.reason);
  subjects.order = order.orderId;
  // D440: the parcel (fulfilment.*), a refund of the order (refund.created) and a draft order (quote.requested, draft.sent).
  subjects.fulfilment = sent.shipment.id;
  const [refund] = await db().execute<Row>(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, kind)
    select p.store_id, p.id, 1000, 'Goodwill', ${`re_topics_${Date.now()}`}, 'succeeded', 'money' from commerce.payments p
    where p.store_id = ${store.storeId}::uuid and p.order_id = ${order.orderId}::uuid and p.status = 'captured' limit 1
    returning id
  `);
  subjects.refund = String(refund.id);
  const { createDraft } = await import("./draft-orders");
  const draft = await createDraft(store.storeId, { accountId: store.accountId, kind: "staff" });
  if (!draft.ok) throw new Error(draft.problem);
  subjects.draft = draft.draft.id;

  const [customer] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${`topics-${Date.now()}@example.com`}, 'Kari') returning id
  `);
  subjects.customer = String(customer.id);

  const run = Date.now().toString(36);
  const [subscription] = await db().execute<Row>(sql`
    insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, customer_id,
      interval, interval_count, subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, manage_token, current_period_end)
    values (${store.storeId}::uuid, ${`S-${run}`}, 'active', 'NO', 'NOK', 'nb-NO', 'kari@example.com', ${subjects.customer}::uuid,
      'month', 1, 19900, 0, 19900, 3980, ${order.orderId}::uuid, ${`manage-${run}`}, now() + interval '1 month')
    returning id
  `);
  subjects.subscription = String(subscription.id);

  // A confirmed withdrawal as the database would hold it, written with the triggers off (its lines and steps are the withdrawals' own tests').
  subjects.withdrawal = await db().transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    const [made] = await tx.execute<Row>(sql`
      insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, locale, market_code, status, submitted_at, confirmed_at)
      values (${store.storeId}::uuid, ${order.orderId}::uuid, 'Kari', 'kari@example.com', 'web', 'nb-NO', 'NO', 'confirmed', now(), now())
      returning id
    `);
    return String(made.id);
  });

  // A return the shopper asked for, with its line (its refund is worked out later: none yet).
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, kind, number, status)
    values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', ${`${order.number}-R1`}, 'requested')
    returning id
  `);
  await db().execute(sql`
    insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${store.storeId}::uuid, ${String(ret.id)}::uuid, ${String(line.id)}::uuid, 1)
  `);
  subjects.return = String(ret.id);

  const variant = await variantId(store.storeId, SKU);
  const [product] = await db().execute<Row>(sql`select product_id from commerce.product_variants where id = ${variant}::uuid`);
  subjects.product = String(product.product_id);
  // A level set at or above the stock is a crossing at once (D370): the variant's stock alert.
  await db().execute(sql`update commerce.product_variants set low_stock_threshold = 100000 where id = ${variant}::uuid`);
  subjects.stock = variant;

  const [discount] = await db().execute<Row>(sql`
    insert into commerce.discount_codes (store_id, code, kind, amounts, starts_at) values (${store.storeId}::uuid, ${`TOPIC${run.toUpperCase()}`}, 'fixed', '{"NO": 5000}', now())
    returning id
  `);
  subjects.discount = String(discount.id);

  // Support waiting is about no one: only how many wait now.
  subjects.support = null;

  // D440: a variant's stock (inventory.updated) is about the variant.
  subjects.inventory = variant;
}, 180_000);

afterAll(async () => {
  await closeDb();
});

const storeRef = () => ({ id: store.storeId, slug: store.slug, name: "Topics" });

describe("every webhook topic's payload (D438)", () => {
  it("is built in its topic's shape, under the envelope an endpoint gets", async () => {
    expect(WEBHOOK_TOPICS.map((t) => t.id)).toEqual(EVENTS.map((e) => e.id));
    for (const topic of WEBHOOK_TOPICS) {
      const subjectId = subjects[topic.subject];
      expect(subjectId, `${topic.id}: no ${topic.subject} was made`).not.toBeUndefined();
      const payload = await integrations.endpointPayload(storeRef(), { id: "00000000-0000-4000-8000-000000000001", event: topic.id, subjectId: subjectId ?? null, createdAt: new Date().toISOString() });
      expect(payload, topic.id).not.toBeNull();
      const checked = webhookEnvelope(z.literal(topic.id), topic.data).safeParse(payload);
      if (!checked.success) throw new Error(`${topic.id}: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      expect(checked.data.version).toBe(PAYLOAD_VERSION);
    }
    expect(logged.filter((l) => l.event === "webhooks.payload_shape")).toEqual([]);
  });

  it("holds what was made: the parcel, the return's line, the stock crossing", async () => {
    const order = (await integrations.subjectData(storeRef(), "order.sent", subjects.order!))!.order as Row;
    expect(order.shipment).toMatchObject({ carrier: "Posten", tracking_number: "TOPIC1" });
    const ret = (await integrations.subjectData(storeRef(), "return.requested", subjects.return!))!.return as { lines: Row[] };
    expect(ret.lines).toEqual([expect.objectContaining({ sku: SKU, quantity: 1 })]);
    const stock = (await integrations.subjectData(storeRef(), "stock.low", subjects.stock!))!.stock as Row;
    expect(stock).toMatchObject({ sku: SKU, product_id: subjects.product });
  });

  it("sends a test with the latest paid order, or a sample with every field a real order has", async () => {
    const latest = await integrations.endpointPayload(storeRef(), { id: "00000000-0000-4000-8000-000000000002", event: "test", subjectId: null, createdAt: new Date().toISOString() });
    expect(WEBHOOK_TEST_DATA.safeParse(latest?.data).success).toBe(true);
    const empty = await newStore("topics-empty");
    const sample = await integrations.endpointPayload({ id: empty.storeId, slug: empty.slug, name: "Empty" }, { id: "00000000-0000-4000-8000-000000000003", event: "test", subjectId: null, createdAt: new Date().toISOString() });
    const checked = WEBHOOK_TEST_DATA.safeParse(sample?.data);
    if (!checked.success) throw new Error(checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    expect(checked.data.order.number).toBe("1001");
  });

  it("queues the catalogue's topics where they happen: a variant's stock once a minute, an archived product (D440)", async () => {
    const [endpoint] = await db().execute<Row>(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics)
      values (${store.storeId}::uuid, 'Stock', 'x', 'example.com', 'x', array['inventory.updated', 'product.archived'])
      returning id
    `);
    const queued = async (event: string) =>
      db().execute<Row>(sql`
        select subject_id, next_attempt_at > now() as later, next_attempt_at = date_trunc('minute', next_attempt_at) as on_the_minute
        from commerce.integration_deliveries where endpoint_id = ${String(endpoint.id)}::uuid and event = ${event}
      `);
    const variant = subjects.inventory!;
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 1 where store_id = ${store.storeId}::uuid and variant_id = ${variant}::uuid`);
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 2 where store_id = ${store.storeId}::uuid and variant_id = ${variant}::uuid`);
    // Two moves within the minute: one delivery, waiting for the next whole minute, built then with the stock as it is.
    expect(await queued("inventory.updated")).toEqual([{ subject_id: variant, later: true, on_the_minute: true }]);
    const data = (await integrations.subjectData(storeRef(), "inventory.updated", variant))!.inventory as { on_hand: number; locations: { on_hand: number }[] };
    expect(data.on_hand).toBe(data.locations.reduce((sum, l) => sum + l.on_hand, 0));
    const store2 = (await import("./stores")).getStore;
    const shop = await store2(store.slug);
    expect(await setArchived(shop!, subjects.product!, true)).toBe(true);
    expect((await queued("product.archived")).map((r) => r.subject_id)).toEqual([subjects.product]);
    // Back on the site as it was (bringing it back makes a draft).
    await db().execute(sql`update commerce.products set status = 'active' where id = ${subjects.product!}::uuid`);
    await db().execute(sql`delete from commerce.webhook_endpoints where id = ${String(endpoint.id)}::uuid`);
  });

  it("queues the orders' topics where they happen (D440 C2)", async () => {
    const topics = ["order.created", "order.updated", "fulfilment.created", "fulfilment.updated", "refund.created", "return.updated", "quote.requested", "draft.sent"];
    const [endpoint] = await db().execute<Row>(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics)
      values (${store.storeId}::uuid, 'Orders', 'x', 'example.com', 'x', ${`{${topics.join(",")}}`}::text[])
      returning id
    `);
    const queued = async () =>
      (await db().execute<Row>(sql`select event, subject_id from commerce.integration_deliveries where endpoint_id = ${String(endpoint.id)}::uuid order by created_at, event`)).map(
        (r) => `${String(r.event)} ${String(r.subject_id)}`,
      );
    const order = await place(store.storeId, [[SKU, 1]]);
    await pay(store.storeId, order, store.account);
    const sent = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "C2-1", trackingUrl: null }, store.accountId, null, { lines: null });
    if (!sent.ok) throw new Error(sent.reason);
    // The carrier's tracking of the parcel moves on (D238).
    await db().execute(sql`
      insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase) values (${store.storeId}::uuid, ${sent.shipment.id}::uuid, ${order.orderId}::uuid, 'posten', 'in_transit')
    `);
    const [refund] = await db().execute<Row>(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, kind)
      select p.store_id, p.id, 500, 'Goodwill', ${`re_c2_${Date.now()}`}, 'succeeded', 'money' from commerce.payments p
      where p.store_id = ${store.storeId}::uuid and p.order_id = ${order.orderId}::uuid and p.status = 'captured' limit 1
      returning id
    `);
    // An edit applied (D174) sets the order's edited_at inside its own context.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.order_edit', ${order.orderId}, true)`);
      await tx.execute(sql`update commerce.orders set edited_at = now() where id = ${order.orderId}::uuid`);
    });
    await db().execute(sql`update commerce.returns set status = 'approved' where id = ${subjects.return!}::uuid`);
    const [quote] = await db().execute<Row>(sql`
      insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, source, email)
      values (${store.storeId}::uuid, commerce.next_draft_number(${store.storeId}::uuid), 'NO', 'no', 'NOK', 'nb-NO', 'quote', 'asker@example.com')
      returning id
    `);
    // Sent: as `sendDraft()` leaves it, naming its order (the drafts' own tests send one through Stripe's test mode).
    await db().execute(sql`
      update commerce.draft_orders set status = 'sent', order_id = ${order.orderId}::uuid, sent_at = now(), expires_at = now() + interval '7 days' where id = ${String(quote.id)}::uuid
    `);
    expect(await queued()).toEqual(
      expect.arrayContaining([
        `order.created ${order.orderId}`,
        `order.updated ${order.orderId}`,
        `fulfilment.created ${sent.shipment.id}`,
        `fulfilment.updated ${sent.shipment.id}`,
        `refund.created ${String(refund.id)}`,
        `return.updated ${subjects.return}`,
        `quote.requested ${String(quote.id)}`,
        `draft.sent ${String(quote.id)}`,
      ]),
    );
    expect((await queued()).filter((q) => q.startsWith("order.created")).length).toBe(1);
    // Ended, so no other test's run of the expiry job finds a link of ours to expire.
    await db().execute(sql`update commerce.draft_orders set status = 'cancelled' where id = ${String(quote.id)}::uuid`);
    await db().execute(sql`delete from commerce.webhook_endpoints where id = ${String(endpoint.id)}::uuid`);
  });

  it("logs a payload that is not its topic's shape, by where it differs and never a value", async () => {
    logged.length = 0;
    // A withdrawal that is not confirmed is no subject: nothing is built and nothing logged.
    expect(await integrations.subjectData(storeRef(), "withdrawal.received", "00000000-0000-4000-8000-000000000009")).toBeNull();
    await db().execute(sql`update commerce.discount_codes set amounts = '{"NO": "lots"}' where id = ${subjects.discount!}::uuid`);
    const drifted = await integrations.subjectData(storeRef(), "discount.created", subjects.discount!);
    expect(drifted).not.toBeNull();
    expect(logged).toEqual([{ event: "webhooks.payload_shape", fields: { storeId: store.storeId, topic: "discount.created", at: "discount.amounts.NO" } }]);
    expect(JSON.stringify(logged)).not.toContain("lots");
  });
});
