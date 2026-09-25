import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

/** The services, faked: every POST is kept, and answers with the next status queued (200 by default). */
const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
const answers: number[] = [];
vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  const status = answers.shift() ?? 200;
  return new Response(status === 200 ? "ok" : "nope", { status });
});

const integrations = await import("./integrations");

const run = Date.now().toString(36);
const ZAP = "https://hooks.zapier.com/hooks/catch/1234567/abcdefg/";
let storeId: string;
let member: Membership;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`int-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`int-${run}`}, 'Integrasjon', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`int-${run}@example.com`}`);
  member = { account: { id: String(account.id) }, store: { id: storeId, slug: `int-${run}`, name: "Integrasjon" } } as unknown as Membership;
});

beforeEach(() => {
  sent.length = 0;
  answers.length = 0;
});

afterAll(async () => {
  await closeDb();
});

const pending = async () =>
  db().execute<Row>(sql`
    select event, status from commerce.integration_deliveries where store_id = ${storeId}::uuid and status = 'pending' order by created_at
  `);

/** An order waiting for payment, with one line. */
async function order(number: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
      subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${`kari-${run}@example.com`}, 'pending_payment',
      39800, 9900, 9940, 49700, ${JSON.stringify({ name: "Kari Nordmann" })}, ${JSON.stringify({ name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" })})
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${storeId}::uuid, ${String(row.id)}::uuid, 'DEMO-TOTE', 'Handlenett', 2, 19900, 39800, 7960, 0.25, 'txcd_99999999')
  `);
  return String(row.id);
}

describe("connecting a service (D41)", () => {
  it("takes only the service's own address, keeps it encrypted and shows a hint", async () => {
    expect(await integrations.saveIntegration(member, "zapier", { url: "https://example.com/hook", events: ["order.paid"], enabled: true })).toEqual({
      ok: false,
      problems: ["That is not a Zapier webhook address. It starts with https://hooks.zapier.com/hooks/."],
    });
    expect(await integrations.saveIntegration(member, "zapier", { url: ZAP, events: [], enabled: true })).toEqual({
      ok: false,
      problems: ["Choose at least one event to send."],
    });
    expect(
      await integrations.saveIntegration(member, "zapier", { url: ZAP, events: ["order.paid", "order.sent", "customer.created", "nonsense"], enabled: true }),
    ).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select * from commerce.store_integrations where store_id = ${storeId}::uuid`);
    expect(String(row.webhook_url_encrypted)).not.toContain("hooks.zapier.com");
    expect(await integrations.getIntegration(storeId, "zapier")).toMatchObject({
      enabled: true,
      hint: "hooks.zapier.com/hooks/catch/…defg",
      events: ["order.paid", "order.sent", "customer.created"],
    });
  });
});

describe("events (D41)", () => {
  it("are queued as they happen, only those asked for, and sent with the order's details", async () => {
    const orderId = await order(`I1-${run}`);
    expect(await pending()).toEqual([]); // waiting for payment is no event
    await db().execute(sql`update commerce.orders set status = 'paid' where id = ${orderId}::uuid`);
    await db().execute(sql`
      insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values (${storeId}::uuid, ${orderId}::uuid, 'Posten', 'TRACK1')
    `);
    await db().execute(sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${`ola-${run}@example.com`}, 'Ola')`);
    // Cancelled is not asked for.
    await db().execute(sql`update commerce.orders set status = 'cancelled' where id = ${orderId}::uuid`);
    expect((await pending()).map((r) => r.event)).toEqual(["order.paid", "order.sent", "customer.created"]);

    expect(await integrations.deliverDue()).toMatchObject({ delivered: 3 });
    expect(sent.map((s) => [s.url, s.headers["X-Kaizen-Event"]])).toEqual([
      [ZAP, "order.paid"],
      [ZAP, "order.sent"],
      [ZAP, "customer.created"],
    ]);
    expect(sent[0].body).toMatchObject({
      event: "order.paid",
      store: { slug: `int-${run}`, name: "Integrasjon" },
      order: {
        number: `I1-${run}`,
        currency: "NOK",
        total: 497,
        vat: 99.4,
        email: `kari-${run}@example.com`,
        customer_name: "Kari Nordmann",
        shipping_address: { city: "Oslo", postal_code: "0155" },
        lines: [{ sku: "DEMO-TOTE", quantity: 2, unit_price: 199, total: 398 }],
      },
    });
    expect(sent[1].body).toMatchObject({ order: { shipment: { carrier: "Posten", tracking_number: "TRACK1" } } });
    expect(sent[2].body).toMatchObject({ customer: { email: `ola-${run}@example.com`, name: "Ola" } });
    expect(await pending()).toEqual([]);
  });

  it("are tried again later when the service does not take them, sending the same content", async () => {
    await db().execute(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`per-${run}@example.com`})`);
    answers.push(500);
    expect(await integrations.deliverDue()).toMatchObject({ delivered: 0, retrying: 1 });
    const [waiting] = await db().execute<Row>(sql`
      select id, attempts, last_status, next_attempt_at > now() + interval '50 seconds' as later
      from commerce.integration_deliveries where store_id = ${storeId}::uuid and status = 'pending'
    `);
    expect(waiting).toMatchObject({ attempts: 1, last_status: 500, later: true });

    // Not due yet; once due, it goes through with the same content.
    expect(await integrations.deliverDue()).toMatchObject({ delivered: 0 });
    await db().execute(sql`update commerce.integration_deliveries set next_attempt_at = now() where id = ${String(waiting.id)}::uuid`);
    expect(await integrations.deliverDue()).toMatchObject({ delivered: 1 });
    expect(sent[1].body).toEqual(sent[0].body);
  });

  it("stop when the service is switched off, and waiting ones are dropped when it is disconnected", async () => {
    await integrations.saveIntegration(member, "zapier", { url: "", events: ["customer.created"], enabled: false });
    await db().execute(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`av-${run}@example.com`})`);
    expect(await pending()).toEqual([]);

    await integrations.saveIntegration(member, "zapier", { url: "", events: ["customer.created"], enabled: true });
    await db().execute(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`fra-${run}@example.com`})`);
    expect(await pending()).toHaveLength(1);
    expect(await integrations.removeIntegration(member, "zapier")).toBe(true);
    expect(await pending()).toEqual([]);
    expect(await integrations.getIntegration(storeId, "zapier")).toBeNull();
  });
});

describe("a test (D41)", () => {
  it("sends the latest order, or a sample, even before the service is switched on, and says how it went", async () => {
    expect(await integrations.sendTest(member, "make")).toEqual({ ok: false, status: null, error: "Save the webhook address first." });
    await integrations.saveIntegration(member, "make", { url: "https://hook.eu2.make.com/abc123", events: ["order.paid"], enabled: false });
    expect(await integrations.sendTest(member, "make")).toEqual({ ok: true, status: 200, error: null });
    expect(sent[0]).toMatchObject({ url: "https://hook.eu2.make.com/abc123", body: { event: "test", test: true, order: { currency: "NOK" } } });

    answers.push(410);
    expect(await integrations.sendTest(member, "make")).toMatchObject({ ok: false, status: 410 });
    const log = await integrations.listDeliveries(storeId, "make");
    expect(log.map((d) => [d.event, d.status])).toEqual([
      ["test", "failed"],
      ["test", "delivered"],
    ]);
  });
});
