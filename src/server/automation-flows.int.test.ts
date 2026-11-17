import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const au = await import("./automations");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * Flows of several emails and products chosen per reader (D4 of `docs/100-day-challenge.md`, D653): a cross-sell email shows what other orders
 * had with the order's products and never what the reader bought, and goes not at all without any; a restock email goes only for an order with a
 * product customers buy again, and shows it; a follow-up goes its days after the email before, once, and not to a reader who ordered since the
 * first; a follow-up is added only after the first email is saved, at most two, and the third moves up when the second goes.
 */

const run = Date.now().toString(36);
const DAY = 86_400_000;
let storeId: string;
let owner: string;
let n = 0;
let products: { product: string; variant: string; handle: string }[];

const words = (subject: string): BroadcastContent => ({
  "nb-NO": { subject, preview: "", blocks: [{ type: "paragraph", text: `${subject}: hei` }, { type: "button", text: "Se", url: "/" }] },
});

async function store() {
  const s = await storeById(storeId);
  if (!s) throw new Error("no store");
  return s;
}

async function subscriber(email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${storeId}::uuid, ${email}, 'nb-NO', 'NO', 'subscribed', 'account', 'Yes please', now() - interval '60 days', ${randomBytes(32).toString("base64url")})
    returning id
  `);
  return String(row.id);
}

/** A paid order of these products (indexes into `products`), placed and maybe delivered at the times given. */
async function order(email: string, items: number[], at: Date, delivered?: Date): Promise<string> {
  n += 1;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, delivered_at, delivered_source)
    values (${storeId}::uuid, ${`fl${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid'::commerce.order_status, 10000, 0, 0, 2000, 10000,
      '{}'::jsonb, '{"name":"Ola"}'::jsonb, ${at.toISOString()}::timestamptz, ${delivered ? delivered.toISOString() : null}::timestamptz, ${delivered ? "staff" : null})
    returning id
  `);
  const id = String(row.id);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${storeId}::uuid, ${id}::uuid, 'stripe', ${`cs_fl${run}_${n}`}, 10000, 'NOK', 'captured')
  `);
  for (const i of items) {
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${storeId}::uuid, ${id}::uuid, ${products[i].variant}::uuid, ${`SKU-${i}`}, 'Thing', 1, 10000, 10000, 2000, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
    `);
  }
  return id;
}

async function switchOn(kind: "cross_sell" | "replenish", delayDays: number) {
  const saved = await au.saveAutomation(await store(), owner, kind, { delayDays, content: words(kind) });
  if (!saved.ok) throw new Error(saved.problem);
  const switched = await au.switchAutomation(await store(), owner, kind, true);
  if (!switched.ok) throw new Error(switched.problem);
}

const sends = (kind: string) =>
  db().execute<Row>(sql`
    select x.key, x.step, x.outcome, m.email from commerce.automation_sends x join commerce.marketing_subscribers m on m.store_id = x.store_id and m.id = x.subscriber_id
    where x.store_id = ${storeId}::uuid and x.kind = ${kind} order by x.created_at, x.key
  `);

const htmlOf = async (key: string) => {
  const [row] = await db().execute<Row>(sql`select html from commerce.email_messages where idempotency_key = ${`automation:${storeId}:${key}`}`);
  return String(row?.html ?? "");
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`fl-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`fl-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO', 'en-GB'] where id = ${storeId}::uuid`);
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  // Four goods on sale, one variant each, put in stock.
  const rows = await db().execute<Row>(sql`
    select distinct on (p.id) p.id as product, v.id as variant, p.handle from commerce.products p
    join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id and v.active and v.delivery = 'physical'
    where p.store_id = ${storeId}::uuid and p.status = 'active' and p.kind = 'goods' and p.audience = 'all' and not p.subscription_only
      and exists (select 1 from commerce.inventory_levels l where l.store_id = v.store_id and l.variant_id = v.id)
    order by p.id, v.id limit 4
  `);
  products = rows.map((r) => ({ product: String(r.product), variant: String(r.variant), handle: String(r.handle) }));
  if (products.length < 4) throw new Error("the demo store needs four goods");
  for (const p of products) await db().execute(sql`update commerce.inventory_levels set on_hand = 50 where store_id = ${storeId}::uuid and variant_id = ${p.variant}::uuid`);
  delete process.env.RESEND_API_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("follow-ups", () => {
  it("are added only after the first email is saved, at most two, and the third moves up when the second goes", async () => {
    expect(await au.saveFollowUp(await store(), owner, "cross_sell", null, { delayDays: 3, content: words("2") })).toEqual({
      ok: false,
      problem: "Save the first email before adding a second.",
    });
    await switchOn("cross_sell", 2);
    expect((await au.saveFollowUp(await store(), owner, "cross_sell", null, { delayDays: 0, content: words("2") })).ok).toBe(false);
    expect(await au.saveFollowUp(await store(), owner, "cross_sell", null, { delayDays: 3, content: words("second") })).toEqual({ ok: true, position: 2 });
    expect(await au.saveFollowUp(await store(), owner, "cross_sell", null, { delayDays: 5, content: words("third") })).toEqual({ ok: true, position: 3 });
    expect((await au.saveFollowUp(await store(), owner, "cross_sell", null, { delayDays: 5, content: words("fourth") })).ok).toBe(false);
    expect((await au.deleteFollowUp(await store(), owner, "cross_sell", 2)).ok).toBe(true);
    const [only] = (await au.getAutomation(await store(), "cross_sell")).followUps;
    expect(only).toMatchObject({ position: 2, delayDays: 5 });
    expect(only.content["nb-NO"]?.subject).toBe("third");
    expect(await au.saveFollowUp(await store(), owner, "cross_sell", 2, { delayDays: 3, content: words("second") })).toEqual({ ok: true, position: 2 });
  });
});

describe("cross-sell", () => {
  it("shows what other orders had with the order's products, never what the reader bought; none, it does not go; then its follow-up", async () => {
    // Others bought 0 with 1 (twice) and 0 with 2 (once); the reader bought 0 and, earlier, 2.
    await order(`o1-${run}@example.com`, [0, 1], new Date(Date.now() - 40 * DAY));
    await order(`o2-${run}@example.com`, [0, 1], new Date(Date.now() - 35 * DAY));
    await order(`o3-${run}@example.com`, [0, 2], new Date(Date.now() - 30 * DAY));
    const reader = `reader-${run}@example.com`;
    await subscriber(reader);
    await order(reader, [2], new Date(Date.now() - 50 * DAY));
    const soon = new Date(Date.now() + 1000);
    const bought = await order(reader, [0], new Date(Date.now() - DAY), soon);
    // Nothing was ever bought with 3: no products for this one, so its email never goes.
    const lonely = `lonely-${run}@example.com`;
    await subscriber(lonely);
    const alone = await order(lonely, [3], new Date(Date.now() - DAY), soon);

    expect(await au.picksFor(storeId, "cross_sell", bought, reader)).toEqual([{ id: products[1].product, handle: products[1].handle }]);

    // Two days after delivery (the first email's days); the database stamps the send with its own time.
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 2 * DAY + 60_000) });
    const first = await sends("cross_sell");
    expect(first.map((r) => [r.key, r.step, r.outcome])).toEqual(
      expect.arrayContaining([
        [`cross_sell:${bought}`, 1, "logged"],
        [`cross_sell:${alone}`, 1, "suppressed"],
      ]),
    );
    const html = await htmlOf(`cross_sell:${bought}`);
    expect(html).toContain(`/p/${products[1].handle}`);
    expect(html).not.toContain(`/p/${products[2].handle}`);

    expect(first.filter((r) => r.step === 2)).toHaveLength(0);
    // The follow-up (3 days after the first email was sent) goes once, to the one who got the first.
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 2.5 * DAY) });
    expect((await sends("cross_sell")).filter((r) => r.step === 2)).toHaveLength(0);
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 3.5 * DAY) });
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 3.6 * DAY) });
    const second = (await sends("cross_sell")).filter((r) => r.step === 2);
    expect(second.map((r) => [r.key, r.email])).toEqual([[`cross_sell:${bought}#2`, reader]]);
  });
});

describe("restock", () => {
  it("goes only for an order with a product customers buy again, shows it, and its follow-up stops after a new order", async () => {
    await switchOn("replenish", 7);
    // Product 3 is bought again by one address; product 2 never twice by the same one.
    const regular = `regular-${run}@example.com`;
    await order(regular, [3], new Date(Date.now() - 200 * DAY));
    await order(regular, [3], new Date(Date.now() - 100 * DAY));
    const a = `restock-a-${run}@example.com`;
    const b = `restock-b-${run}@example.com`;
    await subscriber(a);
    await subscriber(b);
    const soon = new Date(Date.now() + 1000);
    const withRegular = await order(a, [3, 1], new Date(Date.now() - 2 * DAY), soon);
    const without = await order(b, [2], new Date(Date.now() - 2 * DAY), soon);

    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 8 * DAY) });
    const keys = (await sends("replenish")).map((r) => r.key);
    expect(keys).toContain(`replenish:${withRegular}`);
    expect(keys).not.toContain(`replenish:${without}`);
    const html = await htmlOf(`replenish:${withRegular}`);
    expect(html).toContain(`/p/${products[3].handle}`);
    expect(html).not.toContain(`/p/${products[1].handle}`);

    // Its follow-up, two days after the first; a new order since the first email means none.
    expect((await au.saveFollowUp(await store(), owner, "replenish", null, { delayDays: 2, content: words("again") })).ok).toBe(true);
    await order(a, [0], new Date(Date.now() + DAY));
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 2.5 * DAY) });
    expect((await sends("replenish")).filter((r) => r.step === 2 && r.email === a)).toEqual([]);
  });
});
