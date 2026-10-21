import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const rv = await import("./reviews");
const { eraseSubject } = await import("./privacy-erasure");
const { exportCustomerData } = await import("./privacy-export");

type Row = Record<string, unknown>;

/**
 * Product reviews (wave 5 unit G1, D301, `docs/wave-5-marketing.md` 9.8): a delivered line can be reviewed and an undelivered one cannot; a download
 * at payment; a booking after it ended, never a no-show; a copied order never; another customer's order never; with `after_check` a review waits and
 * with `at_once` it is published; an edit goes back to the queue; staff cannot change the words; the person's reviews are exported and erased.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherId: string;
let n = 0;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', features = array['shop', 'reviews'] where id = ${id}::uuid`);
  return id;
}

async function customer(store: string, email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${store}::uuid, ${email}, 'Kari Nordmann') returning id`);
  return String(row.id);
}

/** A product of its own with one variant, delivered as said. */
async function product(store: string, delivery: "physical" | "digital" | "service" = "physical"): Promise<{ productId: string; variantId: string }> {
  n += 1;
  const [p] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, kind) values (${store}::uuid, ${`rv-${run}-${n}`}, 'txcd_99999999', ${delivery === "service" ? "appointment" : "goods"}) returning id
  `);
  const [v] = await db().execute<Row>(sql`
    insert into commerce.product_variants (store_id, product_id, sku, delivery) values (${store}::uuid, ${String(p.id)}::uuid, ${`RV-${run}-${n}`}, ${delivery}) returning id
  `);
  return { productId: String(p.id), variantId: String(v.id) };
}

type Bought = { orderId: string; lineId: string };

/** A paid order of the customer's for the variant, delivered or not, copied or not. */
async function order(store: string, who: string, variantId: string, o: { delivered?: boolean; copied?: boolean; delivery?: string } = {}): Promise<Bought> {
  n += 1;
  return db().transaction(async (tx) => {
    if (o.copied) await tx.execute(sql`set local session_replication_role = replica`);
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from, delivered_at, delivered_source)
      values (${store}::uuid, ${`${o.copied ? "C-" : ""}rv${run}-${n}`}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', ${who}::uuid, 'paid'::commerce.order_status,
        10000, 0, 0, 2000, 10000, '{}'::jsonb, '{"name":"Kari"}'::jsonb, ${o.copied ? sql`gen_random_uuid()` : sql`null`},
        ${o.delivered ? sql`now() - interval '2 days'` : sql`null`}, ${o.delivered ? "staff" : null})
      returning id
    `);
    const orderId = String(row.id);
    const [line] = await tx.execute<Row>(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store}::uuid, ${orderId}::uuid, ${variantId}::uuid, 'RV', 'Shirt, M', 1, 10000, 10000, 2000, 0.25, 'txcd_99999999', ${o.delivery ?? "physical"})
      returning id
    `);
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store}::uuid, ${orderId}::uuid, 'stripe', ${`cs_rv${run}_${n}`}, 10000, 'NOK', 'captured')
    `);
    return { orderId, lineId: String(line.id) };
  });
}

const words = { rating: 4, title: "Good", body: "Fits well.", name: "Kari N." };
const status = async (id: string) => String((await db().execute<Row>(sql`select status from commerce.product_reviews where id = ${id}::uuid`))[0]?.status);

beforeAll(async () => {
  storeId = await makeStore("rv-a");
  otherId = await makeStore("rv-b");
});

afterAll(async () => {
  await closeDb();
});

describe("what can be reviewed", () => {
  it("is a delivered line of the customer's own sold order, never one not yet delivered, copied or another's", async () => {
    const kari = await customer(storeId, `kari-${run}@example.com`);
    const ola = await customer(storeId, `ola-${run}@example.com`);
    const shirt = await product(storeId);
    const coat = await product(storeId);
    const scarf = await product(storeId);
    const delivered = await order(storeId, kari, shirt.variantId, { delivered: true });
    await order(storeId, kari, coat.variantId, { delivered: false });
    await order(storeId, kari, scarf.variantId, { delivered: true, copied: true });
    await order(storeId, ola, coat.variantId, { delivered: true });
    const lines = await rv.reviewableLines(storeId, kari);
    expect(lines.map((l) => l.lineId)).toEqual([delivered.lineId]);
    expect(await rv.writeReview(storeId, ola, delivered.lineId, words, "nb-NO")).toEqual({ ok: false, problem: "not_reviewable" });
    // Another store never sees this one's lines.
    expect(await rv.reviewableLines(otherId, kari)).toEqual([]);
  });

  it("is a download once paid, and a booking once it ended, never a no-show", async () => {
    const kari = await customer(storeId, `kari2-${run}@example.com`);
    const file = await product(storeId, "digital");
    const session = await product(storeId, "service");
    const missed = await product(storeId, "service");
    const download = await order(storeId, kari, file.variantId, { delivery: "digital" });
    const booked = await order(storeId, kari, session.variantId, { delivery: "service" });
    const noShow = await order(storeId, kari, missed.variantId, { delivery: "service" });
    const [resource] = await db().execute<Row>(sql`insert into commerce.booking_resources (store_id, name, hours) values (${storeId}::uuid, 'Room', '{}'::jsonb) returning id`);
    for (const [b, p, show] of [[booked, session, true], [noShow, missed, false]] as const) {
      await db().execute(sql`
        insert into commerce.bookings (store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from, blocked_to, status, order_id, order_line_id, no_show_at)
        values (${storeId}::uuid, ${p.productId}::uuid, ${p.variantId}::uuid, ${String(resource.id)}::uuid, now() - interval '3 hours', now() - interval '2 hours',
          now() - interval '3 hours', now() - interval '2 hours', 'confirmed', ${b.orderId}::uuid, ${b.lineId}::uuid, ${show ? null : sql`now()`})
      `);
    }
    const ids = (await rv.reviewableLines(storeId, kari)).map((l) => l.lineId).sort();
    expect(ids).toEqual([download.lineId, booked.lineId].sort());
  });
});

describe("writing", () => {
  it("waits for staff with after_check, and an edit of a shown review goes back to the queue", async () => {
    const kari = await customer(storeId, `kari3-${run}@example.com`);
    const p = await product(storeId);
    const b = await order(storeId, kari, p.variantId, { delivered: true });
    const first = await rv.writeReview(storeId, kari, b.lineId, words, "nb-NO");
    expect(first).toMatchObject({ ok: true, status: "pending", shownChanged: false });
    if (!first.ok) return;
    const [line] = await rv.reviewableLines(storeId, kari);
    expect(line.review).toMatchObject({ rating: 4, title: "Good", status: "pending", authorName: "Kari N." });
    // Staff publish (the database lets a person move the state, never the words).
    await db().execute(sql`update commerce.product_reviews set status = 'published', moderated_at = now() where id = ${first.reviewId}::uuid`);
    const refused = await db().execute(sql`update commerce.product_reviews set rating = 5 where id = ${first.reviewId}::uuid`).then(() => null, (e: Error) => String(e.cause ?? e));
    expect(refused).toMatch(/product_reviews.words/);
    const edited = await rv.writeReview(storeId, kari, b.lineId, { ...words, rating: 2, body: "Shrank." }, "nb-NO");
    expect(edited).toMatchObject({ ok: true, reviewId: first.reviewId, status: "pending", shownChanged: true });
    expect(await status(first.reviewId)).toBe("pending");
  });

  it("publishes at once with at_once, and keeps a shown review shown when edited", async () => {
    await db().execute(sql`insert into commerce.review_settings (store_id, publish) values (${otherId}::uuid, 'at_once') on conflict (store_id) do update set publish = 'at_once'`);
    const kari = await customer(otherId, `kari4-${run}@example.com`);
    const p = await product(otherId);
    const b = await order(otherId, kari, p.variantId, { delivered: true });
    const written = await rv.writeReview(otherId, kari, b.lineId, words, "nb-NO");
    expect(written).toMatchObject({ ok: true, status: "published", shownChanged: true });
    const edited = await rv.writeReview(otherId, kari, b.lineId, { ...words, rating: 5 }, "nb-NO");
    expect(edited).toMatchObject({ ok: true, status: "published" });
  });

  it("is refused while the feature is off, and deletes only the customer's own", async () => {
    const kari = await customer(storeId, `kari5-${run}@example.com`);
    const ola = await customer(storeId, `ola5-${run}@example.com`);
    const p = await product(storeId);
    const b = await order(storeId, kari, p.variantId, { delivered: true });
    await db().execute(sql`update commerce.stores set features = array['shop'] where id = ${storeId}::uuid`);
    try {
      expect(await rv.writeReview(storeId, kari, b.lineId, words, "nb-NO")).toEqual({ ok: false, problem: "closed" });
    } finally {
      await db().execute(sql`update commerce.stores set features = array['shop', 'reviews'] where id = ${storeId}::uuid`);
    }
    const written = await rv.writeReview(storeId, kari, b.lineId, words, "nb-NO");
    if (!written.ok) throw new Error("not written");
    expect(await rv.deleteOwnReview(storeId, ola, written.reviewId)).toBeNull();
    expect(await rv.deleteOwnReview(storeId, kari, written.reviewId)).toEqual({ wasShown: false });
    expect(await status(written.reviewId)).toBe("undefined");
  });
});

describe("personal data", () => {
  it("exports the person's reviews and erases them", async () => {
    const email = `kari6-${run}@example.com`;
    const kari = await customer(storeId, email);
    const p = await product(storeId);
    const b = await order(storeId, kari, p.variantId, { delivered: true });
    const written = await rv.writeReview(storeId, kari, b.lineId, words, "nb-NO");
    if (!written.ok) throw new Error("not written");
    const exported = await exportCustomerData(storeId, { customerId: kari }, { channel: "staff", accountId: null });
    expect(exported.ok && exported.file.sections.reviews).toEqual([expect.objectContaining({ rating: 4, title: "Good", name: "Kari N.", status: "pending" })]);
    const erased = await eraseSubject(storeId, { customerId: kari }, { channel: "staff", accountId: null });
    expect(erased.ok).toBe(true);
    expect(await status(written.reviewId)).toBe("undefined");
  });
});
