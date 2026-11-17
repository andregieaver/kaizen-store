import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const ownerTools = await import("./owner-tools");
const { purchaseAutopilotProblem } = await import("./supply-tools");
const { detectEvents } = await import("./autopilot-events");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * The order and stock tools and events (`docs/100-day-challenge.md` C2, C3, C5, C6) on a real store: a purchase order made, placed and emailed
 * to a known supplier, measured against the purchasing budget; a supplier's refused order listed and sent again; an order that cannot be
 * cancelled refused before it is kept for a yes; and the order events found once each.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const ctx = () => ({ account: store.member.account, store: store.member.store, holder: { role: "owner" as const }, invalidate: () => {} });
const run = (name: string, input: unknown) => ownerTools.runOwnerTool(ctx(), name, input) as Promise<Record<string, unknown>>;
const refusal = (p: Promise<unknown>) => p.then(() => "no refusal", (error: Error) => error.message);
const SKU = "DEMO-MUG-WHITE";

/** An order of the store in a state, placed some hours ago, with one shipped line. */
async function order(status: string, hoursAgo: number): Promise<{ id: string; number: string }> {
  const number = `S-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${SKU}`);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at)
    values (${store.storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', ${status}::commerce.order_status, 19900, 0, 0, 3980, 19900, '{}'::jsonb,
      '{}'::jsonb, now() - make_interval(hours => ${hoursAgo}))
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor,
      tax_rate, tax_code, delivery)
    values (${store.storeId}::uuid, ${String(row.id)}::uuid, ${String(variant.id)}::uuid, ${SKU}, 'Mug', 1, 19900, 6000, 0, 19900, 3980, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  return { id: String(row.id), number };
}

beforeAll(async () => {
  store = await newStore("supply-tools");
  await db().execute(sql`update commerce.product_variants set cost_minor = 6000 where store_id = ${store.storeId}::uuid and sku = ${SKU}`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.autopilot_events where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.storeId}::uuid`);
  await closeDb();
});

describe("create_purchase_order (C3)", () => {
  it("makes and places a purchase order at the variant's cost, and says when nobody was emailed", async () => {
    const done = await run("create_purchase_order", { supplier: "Unknown Mugs", lines: [{ sku: SKU, quantity: 10 }] });
    expect(done.done).toMatch(/Placed purchase order PO-\d+ with Unknown Mugs: 10 × DEMO-MUG-WHITE/);
    expect(done.supplier_told).toContain("Not emailed");
    const [po] = await db().execute<Row>(sql`select status, ordered_at is not null as ordered from commerce.purchase_orders where store_id = ${store.storeId}::uuid and supplier = 'Unknown Mugs'`);
    expect(po).toMatchObject({ status: "ordered", ordered: true });
  });

  it("emails it to a supplier the store knows, in the supplier's language", async () => {
    await db().execute(sql`insert into commerce.suppliers (store_id, name, order_email, order_language) values (${store.storeId}::uuid, 'Nordic Mugs AS', 'orders@mugs.example', 'nb')`);
    const done = await run("create_purchase_order", { supplier: "nordic mugs as", reference: "NM-1", lines: [{ sku: SKU, quantity: 4, unit_cost: "55" }] });
    expect(done.supplier_told).toContain("Emailed");
    const [mail] = await db().execute<Row>(sql`select subject from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'supplier.purchase_order' order by created_at desc limit 1`);
    expect(String(mail.subject)).toContain("Innkjøpsordre NM-1");
  });

  it("refuses an order that cannot be made before anything is kept for a yes", async () => {
    const preflight = (input: unknown) => ownerTools.preflightOwnerTool(ctx(), "create_purchase_order", input);
    expect(await refusal(preflight({ supplier: "X", lines: [{ sku: "NO-SUCH-SKU", quantity: 1 }] }))).toContain("No variant with the SKU NO-SUCH-SKU");
    expect(await refusal(preflight({ supplier: "X", lines: [{ sku: "DEMO-TOTE", quantity: 1 }] }))).toContain("Give what one unit of DEMO-TOTE costs");
    expect(await refusal(preflight({ supplier: "X", location: "Nowhere", lines: [{ sku: SKU, quantity: 1 }] }))).toContain('No active stock location called "Nowhere"');
  });

  it("is measured against the purchasing budget per order and a month", async () => {
    const args = { supplier: "Nordic Mugs AS", lines: [{ sku: SKU, quantity: 10 }] };
    expect(await purchaseAutopilotProblem(store.member.store, args, { purchasePerOrder: null, purchaseMonthly: null })).toContain("No purchasing budget");
    expect(await purchaseAutopilotProblem(store.member.store, args, { purchasePerOrder: 500, purchaseMonthly: null })).toContain("a purchase order may cost");
    expect(await purchaseAutopilotProblem(store.member.store, args, { purchasePerOrder: 1000, purchaseMonthly: null })).toBeNull();
    // The month so far holds the two orders above (600 + 220 kr): another 600 is over a budget of 1 200 a month.
    expect(await purchaseAutopilotProblem(store.member.store, args, { purchasePerOrder: null, purchaseMonthly: 1200 })).toContain("monthly budget");
    expect(await purchaseAutopilotProblem(store.member.store, args, { purchasePerOrder: null, purchaseMonthly: 2000 })).toBeNull();
  });
});

describe("suppliers' orders (C2)", () => {
  it("lists a refused one with the supplier's reason, and sends it again", async () => {
    const paid = await order("paid", 1);
    const [supplier] = await db().execute<Row>(sql`select id from commerce.suppliers where store_id = ${store.storeId}::uuid and name = 'Nordic Mugs AS'`);
    await db().execute(sql`
      insert into commerce.supplier_orders (store_id, order_id, supplier_id, state, send_after, sent_at, problem)
      values (${store.storeId}::uuid, ${paid.id}::uuid, ${String(supplier.id)}::uuid, 'problem', now(), now(), 'Out of stock until December.')
    `);
    const listed = await run("list_supplier_orders", {});
    expect(listed.supplier_orders).toEqual([expect.objectContaining({ order: paid.number, state: "problem", suppliers_reason: "Out of stock until December." })]);
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "answer_supplier_order", { order: "9999", answer: "resend" }))).toContain("no drop-ship supplier order");
    const answered = await run("answer_supplier_order", { order: paid.number, answer: "resend" });
    expect(answered.done).toContain(`Sent order ${paid.number} to Nordic Mugs AS again`);
  });
});

describe("cancel_order (C6)", () => {
  it("refuses an order that is not paid, or is sent, before it is kept for a yes", async () => {
    const preflight = (o: string) => refusal(ownerTools.preflightOwnerTool(ctx(), "cancel_order", { order: o }));
    expect(await preflight((await order("pending_payment", 1)).number)).toContain("is not paid");
    expect(await preflight((await order("fulfilled", 1)).number)).toContain("already sent");
    expect(await preflight((await order("paid", 1)).number)).toBe("no refusal");
  });
});

describe("order events (C5)", () => {
  it("finds a paid order not sent after two days and a refused supplier order, each once", async () => {
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
    await db().execute(sql`
      insert into commerce.autopilot_settings (store_id, planning, updated_at) values (${store.storeId}::uuid, '{"reacts": true}'::jsonb, now())
      on conflict (store_id) do update set planning = excluded.planning
    `);
    const late = await order("paid", 60);
    await order("paid", 2);
    await detectEvents();
    await detectEvents();
    const events = await db().execute<Row>(sql`select kind, ref, facts from commerce.autopilot_events where store_id = ${store.storeId}::uuid order by kind, ref`);
    const unsent = events.filter((e) => e.kind === "order_unsent");
    expect(unsent.map((e) => e.ref)).toContain(late.id);
    expect(unsent.find((e) => e.ref === late.id)?.facts).toMatchObject({ order: late.number, hours: 60 });
    // The orders placed an hour or two ago are not late yet.
    expect(unsent).toHaveLength(1);
    // The supplier's order was sent again above (waiting now), so no supplier event is left to find.
    expect(events.filter((e) => e.kind === "supplier_problem")).toHaveLength(0);
  });

  it("finds a held order, a dispute to answer, a parcel in trouble and failed payments piling up", async () => {
    const held = await order("paid", 1);
    await db().execute(sql`update commerce.orders set held_at = now(), held_reason = 'Risk' where store_id = ${store.storeId}::uuid and id = ${held.id}::uuid`);
    const disputed = await order("fulfilled", 30);
    const [payment] = await db().execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${store.storeId}::uuid, ${disputed.id}::uuid, 'stripe', ${`pi_d_${disputed.number}`}, ${store.account}, 19900, 'NOK', 'captured') returning id
    `);
    await db().execute(sql`
      insert into commerce.payment_disputes (store_id, order_id, payment_id, provider, provider_reference, amount_minor, currency, reason, status, opened_at, evidence_due_by)
      values (${store.storeId}::uuid, ${disputed.id}::uuid, ${String(payment.id)}::uuid, 'stripe', ${`dp_${disputed.number}`}, 19900, 'NOK', 'fraudulent', 'needs_response', now(), now() + interval '10 days')
    `);
    const sent = await order("paid", 30);
    await run("mark_order_sent", { order: sent.number, carrier: "bring", tracking_number: "70712345678", notify: false });
    const [parcel] = await db().execute<Row>(sql`select id from commerce.shipments where store_id = ${store.storeId}::uuid and order_id = ${sent.id}::uuid`);
    await db().execute(sql`
      insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase, checked_at)
      values (${store.storeId}::uuid, ${String(parcel.id)}::uuid, ${sent.id}::uuid, 'bring', 'returned_to_sender', now())
      on conflict (store_id, shipment_id) do update set phase = excluded.phase, checked_at = excluded.checked_at
    `);
    // The parcel's new phase is logged as `fulfilment.updated` (E4.2): the autopilot reads it from the event log, not by a scan.
    for (let i = 0; i < 6; i++) {
      const tried = await order("pending_payment", 0);
      await db().execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
        values (${store.storeId}::uuid, ${tried.id}::uuid, 'stripe', ${`pi_f_${tried.number}`}, ${store.account}, 19900, 'NOK', 'failed')
      `);
    }
    await detectEvents();
    const kinds = (await db().execute<Row>(sql`select kind, facts from commerce.autopilot_events where store_id = ${store.storeId}::uuid`)).map((e) => [e.kind, e.facts as Record<string, unknown>] as const);
    expect(kinds.find(([k]) => k === "order_held")?.[1]).toMatchObject({ order: held.number, byRule: false });
    expect(kinds.find(([k]) => k === "dispute_opened")?.[1]).toMatchObject({ order: disputed.number, reason: "fraudulent" });
    expect(kinds.find(([k]) => k === "delivery_problem")?.[1]).toMatchObject({ order: sent.number, phase: "returned_to_sender" });
    expect(kinds.find(([k]) => k === "payments_failing")?.[1]).toMatchObject({ failed: 6 });
  });
});
