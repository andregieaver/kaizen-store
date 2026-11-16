import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const ownerTools = await import("./owner-tools");
const { newStore } = await import("./inventory-test-support");
const { orderProfitFor } = await import("./order-profit");
const { replacementAutopilotProblem } = await import("./replacement-tools");
const { getOrderAdmin } = await import("./order-admin");

type Row = Record<string, unknown>;

/**
 * A lost parcel's replacement (B3, D679) on a real store: a parcel the carrier reports in trouble is sent again as an order at 0 of the same goods,
 * paid at once so its stock is drawn, with no invoice and no payment; the two orders name each other, a second replacement is refused, and a missed
 * delivery is never sent again. The lost order's profit counts the goods sent again at cost; the challenge's cap decides whether it waits.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const ctx = () => ({ account: store.member.account, store: store.member.store, holder: { role: "owner" as const }, invalidate: () => {} });
const run = (name: string, input: unknown) => ownerTools.runOwnerTool(ctx(), name, input) as Promise<Record<string, unknown>>;
const refusal = (p: Promise<unknown>) => p.then(() => "no refusal", (error: Error) => error.message);
const SKU = "DEMO-MUG-WHITE";

/** A paid order of the store with two mugs, sent in one parcel whose tracking says `phase`. */
async function sentOrder(phase: string): Promise<{ id: string; number: string }> {
  const number = `L-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${SKU}`);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at)
    values (${store.storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', 'paid'::commerce.order_status, 39800, 0, 0, 7960, 39800, '{}'::jsonb,
      ${JSON.stringify({ name: "Kari", line1: "Gate 1", postalCode: "0150", city: "Oslo", country: "NO" })}::jsonb, now() - interval '5 days')
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor,
      tax_rate, tax_code, delivery)
    values (${store.storeId}::uuid, ${String(row.id)}::uuid, ${String(variant.id)}::uuid, ${SKU}, 'Mug', 2, 19900, 6000, 0, 39800, 7960, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status)
    values (${store.storeId}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_${number}`}, 39800, 0, 'NOK', 'captured')
  `);
  await run("mark_order_sent", { order: number, carrier: "bring", tracking_number: "70712345678", notify: false });
  const [parcel] = await db().execute<Row>(sql`select id from commerce.shipments where store_id = ${store.storeId}::uuid and order_id = ${String(row.id)}::uuid`);
  await db().execute(sql`
    insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase, checked_at)
    values (${store.storeId}::uuid, ${String(parcel.id)}::uuid, ${String(row.id)}::uuid, 'bring', ${phase}, now())
    on conflict (store_id, shipment_id) do update set phase = excluded.phase, checked_at = excluded.checked_at
  `);
  return { id: String(row.id), number };
}

const onHand = async () =>
  Number(
    (
      await db().execute<Row>(sql`
        select coalesce(sum(l.on_hand), 0) as n from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id
        where v.store_id = ${store.storeId}::uuid and v.sku = ${SKU}
      `)
    )[0].n,
  );

beforeAll(async () => {
  store = await newStore("replacements");
  await db().execute(sql`
    update commerce.inventory_levels l set on_hand = 40 from commerce.product_variants v
    where v.id = l.variant_id and v.store_id = ${store.storeId}::uuid and v.sku = ${SKU}
  `);
});

afterAll(closeDb);

describe("send_replacement (B3, D679)", () => {
  it("sends a lost parcel's goods again as an order at 0, once, with its stock drawn and no invoice", async () => {
    const lost = await sentOrder("problem");
    const before = await onHand();
    await ownerTools.preflightOwnerTool(ctx(), "send_replacement", { order: lost.number });
    const done = await run("send_replacement", { order: lost.number });
    expect(String(done.done)).toMatch(/sends 2 units of order L-/);

    const [made] = await db().execute<Row>(sql`
      select id, number, status::text as status, source, total_minor, tax_minor, discount_minor, subtotal_minor, made_by, shipping_address
      from commerce.orders where store_id = ${store.storeId}::uuid and replaces_order_id = ${lost.id}::uuid
    `);
    expect(made).toMatchObject({ status: "paid", source: "replacement", made_by: store.member.account.id });
    expect([Number(made.total_minor), Number(made.tax_minor), Number(made.subtotal_minor), Number(made.discount_minor)]).toEqual([0, 0, 39800, 39800]);
    expect((made.shipping_address as Record<string, unknown>).city).toBe("Oslo");
    const lines = await db().execute<Row>(sql`select quantity, total_minor, unit_cost_minor from commerce.order_lines where order_id = ${String(made.id)}::uuid`);
    expect(lines.map((l) => [Number(l.quantity), Number(l.total_minor)])).toEqual([[2, 0]]);
    expect(await onHand()).toBe(before - 2);
    const invoices = await db().execute<Row>(sql`select id from commerce.invoices where store_id = ${store.storeId}::uuid and order_id = ${String(made.id)}::uuid`);
    expect(invoices).toHaveLength(0);
    const [eligible] = await db().execute<Row>(sql`select commerce.invoice_eligibility(${String(made.id)}::uuid) as e`);
    expect(eligible.e).toBe("zero_total");
    const payments = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${String(made.id)}::uuid`);
    expect(payments).toHaveLength(0);
    const [event] = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${lost.id}::uuid and type = 'order.replacement_sent'`);
    expect((event.data as Record<string, unknown>).order).toBe(made.number);

    // The two orders name each other on their pages.
    expect((await getOrderAdmin(store.storeId, String(made.id)))?.replaces).toEqual({ id: lost.id, number: lost.number });
    expect((await getOrderAdmin(store.storeId, lost.id))?.replacedBy).toEqual({ id: String(made.id), number: String(made.number) });

    // Once per order: the tool refuses, and so does the database.
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "send_replacement", { order: lost.number }))).toMatch(/already sent again as order/);
    const again = await db()
      .execute(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
          billing_address, shipping_address, source, made_by, replaces_order_id)
        values (${store.storeId}::uuid, 'R-dup', 'NO', 'NOK', 'nb-NO', '', 'paid', 0, 0, 0, 0, 0, '{}', '{}', 'replacement', ${store.member.account.id}::uuid, ${lost.id}::uuid)
      `)
      .then(
        () => "inserted",
        (error: Error) => String((error as { cause?: { message?: string } }).cause?.message ?? error.message),
      );
    expect(again).toMatch(/orders_replacement_live_key|duplicate key/);

    // The lost order's profit counts the two mugs sent again at cost and a parcel at the store's estimate.
    const profit = await orderProfitFor(store.member.store, lost.id);
    const line = profit?.lines.find((l) => l.key === "replacement");
    expect(line?.amountMinor).not.toBeNull();
    expect(line!.amountMinor!).toBeLessThanOrEqual(-12000);
  });

  it("sends back goods again too, never a missed delivery, and refuses what is not its to send", async () => {
    const back = await sentOrder("returned_to_sender");
    await ownerTools.preflightOwnerTool(ctx(), "send_replacement", { order: back.number });
    const missed = await sentOrder("attempted");
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "send_replacement", { order: missed.number }))).toMatch(/A missed delivery is tried again/);
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "send_replacement", { order: "nope" }))).toMatch(/No order nope/);
  });

  it("in challenge mode sends it itself only within the cap on its value", async () => {
    const lost = await sentOrder("problem");
    expect(await replacementAutopilotProblem(store.member.store, lost.number, null)).toMatch(/No cap/);
    expect(await replacementAutopilotProblem(store.member.store, lost.number, 300)).toMatch(/more than the/);
    expect(await replacementAutopilotProblem(store.member.store, lost.number, 500)).toBeNull();
    const missed = await sentOrder("attempted");
    expect(await replacementAutopilotProblem(store.member.store, missed.number, 500)).toMatch(/No parcel/);
  });
});
