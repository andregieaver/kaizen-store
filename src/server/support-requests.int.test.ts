import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

/** Stripe, scripted: a cancellation's refund succeeds. */
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { closeDb, db } = await import("@/db/client");
const ownerTools = await import("./owner-tools");
const { detectEvents } = await import("./autopilot-events");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * A customer's requests to staff carried out by code (`docs/100-day-challenge.md` B3, D640) on a real store: the order's own signed-in
 * customer's address change is done with the address they gave, the request marked done and a line in the conversation; a visitor who is
 * not signed in, an order already sent and a request without a full address are refused before anything is kept for a yes; only the
 * requests code may carry out become events; and cancelling an order closes its customer's cancellation request.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const ctx = () => ({ account: store.member.account, store: store.member.store, holder: { role: "owner" as const }, invalidate: () => {} });
const run = (name: string, input: unknown) => ownerTools.runOwnerTool(ctx(), name, input) as Promise<Record<string, unknown>>;
const refusal = (p: Promise<unknown>) => p.then(() => "no refusal", (error: Error) => error.message);
const tag = Date.now().toString(36);
let serial = 0;
let ana = "";
const ADDRESS = { name: "Ana Berg", line1: "Nygata 5", postalCode: "0150", city: "Oslo" };

/** A paid order of a customer's with one teapot to send. */
async function order(customerId: string | null, email: string): Promise<{ id: string; number: string }> {
  serial += 1;
  const number = `B3-${tag}-${serial}`;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, customer_id)
    values (${store.storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', 5000, 0, 0, 1000, 5000, '{}'::jsonb,
      '{"name": "Ana Berg", "line1": "Storgata 1", "postalCode": "0155", "city": "Oslo"}'::jsonb, now() - interval '1 day', ${customerId}::uuid)
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${store.storeId}::uuid, ${String(o.id)}::uuid, ${`B3-${serial}`}, 'Teapot', 1, 5000, 0, 5000, 1000, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${store.storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`pi_b3_${tag}_${serial}`}, ${store.account}, 5000, 'NOK', 'captured')
  `);
  return { id: String(o.id), number };
}

/** A request to staff in a conversation of the customer's (or a visitor's, not signed in). */
async function request(customerId: string | null, kind: "change_address" | "cancel_order", args: Record<string, unknown>): Promise<{ id: string; conversation: string }> {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, customer_id)
    values (${store.storeId}::uuid, 'site', 'ai', ${`b3-${Math.random()}`}, 'nb-NO', ${customerId}::uuid) returning id
  `);
  const [a] = await db().execute<Row>(sql`
    insert into commerce.support_actions (conversation_id, store_id, kind, confirmer, args, summary, details)
    values (${String(c.id)}::uuid, ${store.storeId}::uuid, ${kind}, 'staff', ${JSON.stringify(args)}::jsonb, 'A request', 'The customer asks.')
    returning id
  `);
  return { id: String(a.id), conversation: String(c.id) };
}

const statusOf = async (id: string) => String((await db().execute<Row>(sql`select status from commerce.support_actions where id = ${id}::uuid`))[0].status);

beforeAll(async () => {
  store = await newStore("support-requests");
  const [c] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, email_verified_at, name) values (${store.storeId}::uuid, ${`ana-${tag}@example.com`}, now(), 'Ana') returning id
  `);
  ana = String(c.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.autopilot_events where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.storeId}::uuid`);
  await closeDb();
});

describe("carry_out_address_change (B3, D640)", () => {
  it("changes the address of the signed-in customer's own unsent order to the one they gave, and marks the request done", async () => {
    const o = await order(ana, `ana-${tag}@example.com`);
    const r = await request(ana, "change_address", { orderNumber: o.number, address: ADDRESS });
    await ownerTools.preflightOwnerTool(ctx(), "carry_out_address_change", { request: r.id });
    const done = await run("carry_out_address_change", { request: r.id });
    expect(String(done.done)).toContain("Nygata 5, 0150 Oslo");
    const [row] = await db().execute<Row>(sql`select shipping_address, email from commerce.orders where id = ${o.id}::uuid`);
    expect(row.shipping_address).toMatchObject({ name: "Ana Berg", line1: "Nygata 5", postalCode: "0150", city: "Oslo" });
    expect(row.email).toBe(`ana-${tag}@example.com`);
    expect(await statusOf(r.id)).toBe("done");
    const lines = await db().execute<Row>(sql`select kind from commerce.support_messages where conversation_id = ${r.conversation}::uuid`);
    expect(lines.map((l) => l.kind)).toContain("request_done");
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "carry_out_address_change", { request: r.id }))).toMatch(/decided already/);
  });

  it("refuses a visitor who is not signed in, an order already sent, and a request without a full address", async () => {
    const o = await order(ana, `ana-${tag}@example.com`);
    const anonymous = await request(null, "change_address", { orderNumber: o.number, address: ADDRESS });
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "carry_out_address_change", { request: anonymous.id }))).toMatch(/not signed in as the order's customer/);
    const bare = await request(ana, "change_address", { orderNumber: o.number });
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "carry_out_address_change", { request: bare.id }))).toMatch(/no full new address/);
    const sent = await order(ana, `ana-${tag}@example.com`);
    await db().execute(sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number, legacy) values (${store.storeId}::uuid, ${sent.id}::uuid, 'Bring', 'B3SENT', true)`);
    const late = await request(ana, "change_address", { orderNumber: sent.number, address: ADDRESS });
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "carry_out_address_change", { request: late.id }))).toMatch(/sent already/);
    const someoneElse = await order(null, "other@example.com");
    const notTheirs = await request(ana, "change_address", { orderNumber: someoneElse.number, address: ADDRESS });
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "carry_out_address_change", { request: notTheirs.id }))).toMatch(/not signed in as the order's customer/);
  });
});

describe("the staff_request event and a cancellation (B3, D640)", () => {
  it("makes events only of the requests code may carry out, and closes a cancellation request when the order is cancelled", async () => {
    await db().execute(sql`
      insert into commerce.autopilot_settings (store_id, planning, updated_at) values (${store.storeId}::uuid, '{"reacts": true}'::jsonb, now())
      on conflict (store_id) do update set planning = excluded.planning
    `);
    const mine = await order(ana, `ana-${tag}@example.com`);
    const cancel = await request(ana, "cancel_order", { orderNumber: mine.number });
    const visitors = await order(ana, `ana-${tag}@example.com`);
    const visitor = await request(null, "cancel_order", { orderNumber: visitors.number });
    await detectEvents({ stockoutCheck: false });
    const events = await db().execute<Row>(sql`select ref, facts from commerce.autopilot_events where store_id = ${store.storeId}::uuid and kind = 'staff_request'`);
    const refs = events.map((e) => String(e.ref));
    expect(refs).toContain(cancel.id);
    expect(refs).not.toContain(visitor.id);
    expect(events.find((e) => e.ref === cancel.id)?.facts).toMatchObject({ kind: "staff_request", ask: "cancel_order", order: mine.number });

    await run("cancel_order", { order: mine.number, reason: "The customer asked to cancel in support.", notify: false });
    expect(await statusOf(cancel.id)).toBe("done");
    expect(await statusOf(visitor.id)).toBe("proposed");
  });
});
