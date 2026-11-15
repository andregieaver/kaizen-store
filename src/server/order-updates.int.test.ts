import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const ownerTools = await import("./owner-tools");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * Telling a customer how their order stands (`docs/100-day-challenge.md` C, D635) on a real store: a paid order with goods to send is told it is
 * taking longer once, in the store's fixed words in its language; a held order, an order with nothing left to send and a parcel whose tracking
 * says otherwise are refused before anything is kept for a yes; a parcel the carrier could not deliver is told so with its tracking.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const ctx = () => ({ account: store.member.account, store: store.member.store, holder: { role: "owner" as const }, invalidate: () => {} });
const run = (name: string, input: unknown) => ownerTools.runOwnerTool(ctx(), name, input) as Promise<Record<string, unknown>>;
const refusal = (p: Promise<unknown>) => p.then(() => "no refusal", (error: Error) => error.message);
const SKU = "DEMO-MUG-WHITE";

/** A paid order of the store with one mug to send. */
async function order(status = "paid"): Promise<{ id: string; number: string }> {
  const number = `U-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${SKU}`);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at)
    values (${store.storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', ${status}::commerce.order_status, 19900, 0, 0, 3980, 19900, '{}'::jsonb,
      '{}'::jsonb, now() - interval '3 days')
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor,
      tax_rate, tax_code, delivery)
    values (${store.storeId}::uuid, ${String(row.id)}::uuid, ${String(variant.id)}::uuid, ${SKU}, 'Mug', 1, 19900, 6000, 0, 19900, 3980, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  return { id: String(row.id), number };
}

const emailsOf = (orderId: string) =>
  db().execute<Row>(sql`select kind, subject, text from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = ${orderId}::uuid and kind = 'order.update'`);

beforeAll(async () => {
  store = await newStore("order-updates");
});

afterAll(closeDb);

describe("tell_customer_about_order (D635)", () => {
  it("tells a late order's customer once, in the store's own words and their language", async () => {
    const late = await order();
    await ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: late.number, about: "delayed" });
    const done = await run("tell_customer_about_order", { order: late.number, about: "delayed" });
    expect(String(done.done)).toContain("taking longer than planned");
    const [email] = await emailsOf(late.id);
    expect(String(email.subject)).toContain(`Ordre ${late.number}`);
    expect(String(email.text)).toContain("Vi har ikke fått sendt ordre");
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: late.number, about: "delayed" }))).toMatch(/already been told/);
    expect(await emailsOf(late.id)).toHaveLength(1);
    const [audited] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'order.customer_updated'`);
    expect(audited).toBeTruthy();
  });

  it("refuses what the store's records do not bear out", async () => {
    const held = await order();
    await db().execute(sql`update commerce.orders set held_at = now(), held_reason = 'Risk' where store_id = ${store.storeId}::uuid and id = ${held.id}::uuid`);
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: held.number, about: "delayed" }))).toMatch(/is held/);
    const unpaid = await order("pending_payment");
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: unpaid.number, about: "delayed" }))).toMatch(/nothing left to send/);
    const fine = await order();
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: fine.number, about: "parcel_attempted" }))).toMatch(/No parcel/);
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: "nope", about: "delayed" }))).toMatch(/No order nope/);
  });

  it("tells a parcel's customer what the carrier says, with its tracking, only while the tracking says so", async () => {
    const sent = await order();
    await run("mark_order_sent", { order: sent.number, carrier: "bring", tracking_number: "70712345678", notify: false });
    const [parcel] = await db().execute<Row>(sql`select id from commerce.shipments where store_id = ${store.storeId}::uuid and order_id = ${sent.id}::uuid`);
    await db().execute(sql`
      insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase, checked_at)
      values (${store.storeId}::uuid, ${String(parcel.id)}::uuid, ${sent.id}::uuid, 'bring', 'attempted', now())
      on conflict (store_id, shipment_id) do update set phase = excluded.phase, checked_at = excluded.checked_at
    `);
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: sent.number, about: "parcel_returning" }))).toMatch(/No parcel/);
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "tell_customer_about_order", { order: sent.number, about: "delayed" }))).toMatch(/nothing left to send/);
    await run("tell_customer_about_order", { order: sent.number, about: "parcel_attempted" });
    const [email] = await emailsOf(sent.id);
    expect(String(email.text)).toContain("Transportøren prøvde å levere pakken");
    expect(String(email.text)).toContain("70712345678");
  });
});
