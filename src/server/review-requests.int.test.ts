import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const rr = await import("./review-requests");
const rv = await import("./reviews");
const admin = await import("./reviews-admin");
const { eraseSubject } = await import("./privacy-erasure");

type Row = Record<string, unknown>;

/**
 * Review requests (wave 5 unit G3, D301, `docs/wave-5-marketing.md` 9.6): a request goes once per sold order, some days after receipt, only to a
 * subscribed address and only for orders received after the requests were switched on, never for a copy; its link writes reviews for that order
 * only, as a guest's key when the order has no account; another store's or a wrong token opens nothing; erasure takes the request away.
 */

const run = Date.now().toString(36);
const DAY = 86_400_000;
let storeId: string;
let otherId: string;
let accountId: string;
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

async function subscribe(store: string, email: string, status: "subscribed" | "unsubscribed" = "subscribed"): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${store}::uuid, ${email}, 'nb-NO', 'NO', 'subscribed', 'account', 'Yes please', now() - interval '60 days', ${randomBytes(32).toString("base64url")})
    returning id
  `);
  if (status === "unsubscribed") {
    await db().execute(sql`update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'link' where id = ${String(row.id)}::uuid`);
  }
}

async function variant(store: string): Promise<string> {
  n += 1;
  const [p] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, kind) values (${store}::uuid, ${`rr-${run}-${n}`}, 'txcd_99999999', 'goods') returning id
  `);
  const [v] = await db().execute<Row>(sql`
    insert into commerce.product_variants (store_id, product_id, sku, delivery) values (${store}::uuid, ${String(p.id)}::uuid, ${`RR-${run}-${n}`}, 'physical') returning id
  `);
  return String(v.id);
}

/** A paid guest order delivered `daysAgo` days ago (or not delivered), copied or not. */
async function order(store: string, email: string, o: { daysAgo: number | null; copied?: boolean; customerId?: string }): Promise<{ orderId: string; lineId: string }> {
  n += 1;
  const variantId = await variant(store);
  return db().transaction(async (tx) => {
    if (o.copied) await tx.execute(sql`set local session_replication_role = replica`);
    const delivered = o.daysAgo === null ? null : new Date(Date.now() - o.daysAgo * DAY).toISOString();
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from, delivered_at, delivered_source)
      values (${store}::uuid, ${`${o.copied ? "C-" : ""}rr${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, ${o.customerId ?? null}::uuid, 'paid'::commerce.order_status,
        10000, 0, 0, 2000, 10000, '{}'::jsonb, '{"name":"Kari Nordmann"}'::jsonb, ${o.copied ? sql`gen_random_uuid()` : sql`null`},
        ${delivered}::timestamptz, ${delivered ? "staff" : null})
      returning id
    `);
    const orderId = String(row.id);
    const [line] = await tx.execute<Row>(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store}::uuid, ${orderId}::uuid, ${variantId}::uuid, 'RR', ${`Lamp ${n}`}, 1, 10000, 10000, 2000, 0.25, 'txcd_99999999', 'physical')
      returning id
    `);
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store}::uuid, ${orderId}::uuid, 'stripe', ${`cs_rr${run}_${n}`}, 10000, 'NOK', 'captured')
    `);
    return { orderId, lineId: String(line.id) };
  });
}

const requested = async (store: string) =>
  (await db().execute<Row>(sql`select order_id from commerce.review_requests where store_id = ${store}::uuid`)).map((r) => String(r.order_id));

/** The token the request email for the order carries (the email's button). */
async function tokenOf(store: string, orderId: string): Promise<string> {
  const [email] = await db().execute<Row>(sql`select html from commerce.email_messages where idempotency_key = ${`review_request:${store}:${orderId}`}`);
  const match = /\/account\/review\/([A-Za-z0-9_-]{43})/.exec(String(email?.html ?? ""));
  if (!match) throw new Error("no link in the request email");
  return match[1];
}

beforeAll(async () => {
  storeId = await makeStore("rr-a");
  otherId = await makeStore("rr-b");
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  accountId = String(owner.account_id);
});

afterAll(async () => {
  await closeDb();
});

describe("review requests", () => {
  it("go once per sold order received the days before, only to subscribed buyers, never for a copy or before the switch", async () => {
    const asked = `asked-${run}@example.com`;
    const fresh = `fresh-${run}@example.com`;
    const gone = `gone-${run}@example.com`;
    const early = `early-${run}@example.com`;
    await subscribe(storeId, asked);
    await subscribe(storeId, fresh);
    await subscribe(storeId, early);
    await subscribe(storeId, gone, "unsubscribed");

    // Nothing while the requests are off.
    const due = await order(storeId, asked, { daysAgo: 5 });
    expect((await rr.runReviewRequests({ only: storeId })).sent).toBe(0);

    expect(await admin.saveRequestSettings(storeId, accountId, { on: true, days: 2 })).toBe(false);
    expect(await admin.saveRequestSettings(storeId, accountId, { on: true, days: 3 })).toBe(true);
    // The clock starts at the switch: move it back so orders received since count.
    await db().execute(sql`update commerce.review_settings set requests_enabled_at = now() - interval '20 days' where store_id = ${storeId}::uuid`);

    await order(storeId, fresh, { daysAgo: 1 });
    await order(storeId, gone, { daysAgo: 5 });
    await order(storeId, early, { daysAgo: 25 });
    await order(storeId, asked, { daysAgo: 5, copied: true });
    await order(storeId, asked, { daysAgo: null });

    const first = await rr.runReviewRequests({ only: storeId });
    expect(first.sent).toBe(1);
    expect(await requested(storeId)).toEqual([due.orderId]);
    const [email] = await db().execute<Row>(sql`select kind, to_address, html from commerce.email_messages where idempotency_key = ${`review_request:${storeId}:${due.orderId}`}`);
    expect(email.kind).toBe("marketing.review_request");
    expect(email.to_address).toBe(asked);
    // The subscriber's own unsubscribe link, and the product it asks about.
    expect(String(email.html)).toContain("/unsubscribe/");
    expect(String(email.html)).toMatch(/Lamp \d+/);

    // Asked once: the next run finds nothing more.
    expect((await rr.runReviewRequests({ only: storeId })).sent).toBe(0);
    // Staying on keeps the clock; switching off and on starts it again.
    const [before] = await db().execute<Row>(sql`select requests_enabled_at from commerce.review_settings where store_id = ${storeId}::uuid`);
    await admin.saveRequestSettings(storeId, accountId, { on: true, days: 4 });
    const [kept] = await db().execute<Row>(sql`select requests_enabled_at from commerce.review_settings where store_id = ${storeId}::uuid`);
    expect(String(kept.requests_enabled_at)).toBe(String(before.requests_enabled_at));
    await admin.saveRequestSettings(storeId, accountId, { on: true, days: 3 });
  });

  it("open the order's lines to review without signing in, as the guest's key, and nothing else", async () => {
    const buyer = `guest-${run}@example.com`;
    await subscribe(storeId, buyer);
    const bought = await order(storeId, buyer, { daysAgo: 6 });
    const other = await order(storeId, buyer, { daysAgo: 6 });
    await rr.runReviewRequests({ only: storeId });
    const token = await tokenOf(storeId, bought.orderId);

    const invitation = await rr.invitationOf(storeId, token);
    expect(invitation?.orderId).toBe(bought.orderId);
    expect(invitation?.customerId).toBeNull();
    expect(invitation?.buyerKey).toMatch(/^e:[0-9a-f]{64}$/);
    // The key is the one erasure finds for the address.
    expect(rv.buyerKeysOf(null, [buyer.toUpperCase()])).toContain(invitation?.buyerKey);
    expect(await rr.invitationOf(otherId, token)).toBeNull();
    expect(await rr.invitationOf(storeId, "x".repeat(43))).toBeNull();
    expect(await rr.invitationOf(storeId, "short")).toBeNull();

    const lines = await rv.reviewableLinesFor(storeId, invitation!);
    expect(lines.map((l) => l.lineId)).toEqual([bought.lineId]);
    // Another order's line is never written from this link.
    expect(await rv.writeReviewAs(storeId, invitation!, other.lineId, { rating: 5, title: null, body: null, name: "Kari N." }, "nb-NO")).toEqual({
      ok: false,
      problem: "not_reviewable",
    });
    const written = await rv.writeReviewAs(storeId, invitation!, bought.lineId, { rating: 5, title: "Fin", body: null, name: "Kari N." }, "nb-NO");
    expect(written).toMatchObject({ ok: true, status: "pending" });
    const [review] = await db().execute<Row>(sql`select buyer_key, customer_id, source from commerce.product_reviews where id = ${written.ok ? written.reviewId : null}::uuid`);
    expect(review).toMatchObject({ buyer_key: invitation!.buyerKey, customer_id: null, source: "buyer" });
    // The same link edits that review rather than adding a second.
    const again = await rv.writeReviewAs(storeId, invitation!, bought.lineId, { rating: 4, title: "Fin", body: null, name: "Kari N." }, "nb-NO");
    expect(again.ok && written.ok && again.reviewId === written.reviewId).toBe(true);

    // A spent link opens nothing.
    await db().execute(sql`update commerce.review_requests set expires_at = now() - interval '1 minute' where store_id = ${storeId}::uuid and order_id = ${bought.orderId}::uuid`);
    expect(await rr.invitationOf(storeId, token)).toBeNull();
  });

  it("are taken away with the buyer's orders on erasure", async () => {
    const [c] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${`erase-${run}@example.com`}, 'Ola Nordmann') returning id`);
    const customerId = String(c.id);
    await subscribe(storeId, `erase-${run}@example.com`);
    const bought = await order(storeId, `erase-${run}@example.com`, { daysAgo: 6, customerId });
    await rr.runReviewRequests({ only: storeId });
    expect(await requested(storeId)).toContain(bought.orderId);
    const invitation = await rr.invitationOf(storeId, await tokenOf(storeId, bought.orderId));
    // An order with an account writes as that account, so My account shows the same review.
    expect(invitation?.buyerKey).toBe(`c:${customerId}`);
    const erased = await eraseSubject(storeId, { customerId }, { channel: "staff", accountId: null });
    expect(erased.ok).toBe(true);
    expect(await requested(storeId)).not.toContain(bought.orderId);
  });
});
