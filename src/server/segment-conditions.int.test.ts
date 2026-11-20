import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { Condition, SegmentRules } from "@/lib/segments";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const seg = await import("./segments");
const { segmentsOfPerson } = await import("./segment-membership");
const { ensurePipeline } = await import("./deals");
const { mainLocation, newStore, pay, place, setLevel } = await import("./inventory-test-support");

/**
 * Segments' newer conditions (ecosystem plan E3.6, D718), read by `segmentPeople()` from the store's own rows: what each person bought (a
 * product, a category's products with the categories below it, ever or in the last days, or not), their own deals while Deals is on, their
 * support conversations (by account or the address they gave) and a bad rating, the reviews they wrote while Product reviews is on, the
 * subscriptions running now and their consent to texts. Another store's rows for the same addresses count for nothing here.
 */

type Row = Record<string, unknown>;
type Store = Awaited<ReturnType<typeof newStore>>;
const run = Date.now().toString(36);
const mail = (name: string) => `${name}-${run}@example.com`;
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const MUG = "DEMO-MUG-WHITE";
const TOTE = "DEMO-TOTE";

let store: Store;
let other: Store;
let anna: string;
let mugProduct: string;
let toteProduct: string;
let kitchen: string;
let annaMugOrder: string;

async function productOf(storeId: string, sku: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}`);
  return String(row.product_id);
}

async function paidOrder(target: Store, sku: string, email: string, customerId: string | null, placedAt: string): Promise<string> {
  await setLevel(target.storeId, sku, await mainLocation(target.storeId), 5);
  const order = await place(target.storeId, [[sku, 1]]);
  await pay(target.storeId, order, target.account);
  await db().execute(sql`update commerce.orders set email = ${email}, customer_id = ${customerId}::uuid, placed_at = ${placedAt}::timestamptz where id = ${order.orderId}::uuid`);
  return order.orderId;
}

async function customer(storeId: string, email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${email}, 'Test') returning id`);
  return String(row.id);
}

async function conversation(storeId: string, who: { customerId?: string; email?: string }, lastAt: string, rating: "good" | "bad" | null) {
  await db().execute(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, customer_id, contact_email, last_message_at, rating)
    values (${storeId}::uuid, 'site', 'ai', ${`h-${randomBytes(8).toString("hex")}`}, 'nb-NO', ${who.customerId ?? null}::uuid, ${who.email ?? null},
      ${lastAt}::timestamptz, ${rating})
  `);
}

async function smsNumber(storeId: string, phone: string, status: "pending" | "subscribed" | "unsubscribed", who: { customerId?: string; email?: string }) {
  await db().execute(sql`
    insert into commerce.sms_subscribers (store_id, phone, country, locale, status, source, consent_text, consented_at, token, customer_id, email)
    values (${storeId}::uuid, ${phone}, 'NO', 'nb-NO', ${status}, 'checkout', 'Ja takk', now(), ${randomBytes(16).toString("base64url")},
      ${who.customerId ?? null}::uuid, ${who.email ?? null})
  `);
}

async function deal(storeId: string, customerId: string, status: "open" | "won") {
  const [pipeline] = await ensurePipeline(storeId, { name: "Sales", stages: [{ name: "New" }] });
  await db().execute(sql`
    insert into commerce.deals (store_id, title, pipeline_id, stage_id, currency, customer_id, status, closed_at, closed_via)
    values (${storeId}::uuid, 'Fair order', ${pipeline.id}::uuid, ${pipeline.stages[0].id}::uuid, 'NOK', ${customerId}::uuid, ${status},
      ${status === "open" ? null : NOW.toISOString()}::timestamptz, ${status === "open" ? null : "person"})
  `);
}

async function subscription(storeId: string, firstOrder: string, email: string, customerId: string | null, status: "active" | "cancelled") {
  await db().execute(sql`
    insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, customer_id,
      interval, interval_count, subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, manage_token)
    values (${storeId}::uuid, ${`S-${randomBytes(4).toString("hex")}`}, ${status}::commerce.subscription_status, 'NO', 'NOK', 'nb-NO', ${email}, ${customerId}::uuid,
      'month', 1, 20000, 0, 20000, 4000, ${firstOrder}::uuid, ${`manage-${randomBytes(8).toString("hex")}`})
  `);
}

/** A buyer's review of an order's line, written as its author (the table's own rule, D301). */
async function review(orderId: string, customerId: string, rating: number) {
  await db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('kaizen.review_writer', 'author', true)`);
    await tx.execute(sql`
      insert into commerce.product_reviews (store_id, product_id, variant_id, source, order_id, order_line_id, buyer_key, customer_id, author_name, rating, title, body, locale)
      select ol.store_id, v.product_id, ol.variant_id, 'buyer', ol.order_id, ol.id, ${`c:${customerId}`}, ${customerId}::uuid, 'Anna', ${rating}, 'Hm', 'Chipped.', 'nb-NO'
      from commerce.order_lines ol join commerce.product_variants v on v.id = ol.variant_id
      where ol.order_id = ${orderId}::uuid order by ol.id limit 1
    `);
  });
}

const features = (s: Store, list: string[]) => db().execute(sql`update commerce.stores set features = ${`{${list.join(",")}}`}::text[] where id = ${s.storeId}::uuid`);

/** Who of the test's people one condition finds in the store, by name. */
async function who(s: Store, ...conditions: Condition[]): Promise<string[]> {
  const rules: SegmentRules = { match: "all", conditions };
  const { people } = await seg.segmentPeople(s.member.store, NOW, { rules: [rules] });
  const { matches } = await import("@/lib/segments");
  const names = new Map([mail("anna"), mail("ola"), mail("sub")].map((email) => [email, email.split("-")[0]]));
  return people.filter((p) => names.has(p.email) && matches(rules, p, NOW)).map((p) => names.get(p.email)!).sort();
}

beforeAll(async () => {
  store = await newStore("segcond");
  other = await newStore("segcond-other");
  await features(store, ["shop", "sales", "reviews", "subscriptions"]);
  await features(other, ["shop", "sales", "reviews", "subscriptions"]);
  mugProduct = await productOf(store.storeId, MUG);
  toteProduct = await productOf(store.storeId, TOTE);

  // Anna has an account: a mug five days ago, an open deal, a conversation three days ago rated bad, a review of two stars, a subscription
  // running and a number that gets texts (kept with her account, not her address).
  anna = await customer(store.storeId, mail("anna"));
  annaMugOrder = await paidOrder(store, MUG, mail("anna"), anna, daysAgo(5));
  await deal(store.storeId, anna, "open");
  await conversation(store.storeId, { customerId: anna }, daysAgo(3), "bad");
  await review(annaMugOrder, anna, 2);
  await subscription(store.storeId, annaMugOrder, mail("anna"), anna, "active");
  await smsNumber(store.storeId, "+4791000001", "subscribed", { customerId: anna });

  // Ola is a guest: a tote forty days ago, a conversation by the address he gave twenty days ago, rated good, a number waiting for its order,
  // and a cancelled subscription.
  const olaOrder = await paidOrder(store, TOTE, mail("ola"), null, daysAgo(40));
  await conversation(store.storeId, { email: mail("ola") }, daysAgo(20), "good");
  await smsNumber(store.storeId, "+4791000002", "pending", { email: mail("ola") });
  await subscription(store.storeId, olaOrder, mail("ola"), null, "cancelled");

  // Sub is only on the list.
  await db().execute(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${store.storeId}::uuid, ${mail("sub")}, 'nb-NO', 'NO', 'subscribed', 'form', 'Ja takk', now(), ${randomBytes(32).toString("base64url").slice(0, 43)})
  `);

  // The mug is in Mugs, below Kitchen: buying it is buying from Kitchen.
  const [parent] = await db().execute<Row>(sql`
    insert into commerce.terms (store_id, content_type, kind, name, slug) values (${store.storeId}::uuid, 'product', 'category', 'Kitchen', ${`kitchen-${run}`}) returning id
  `);
  kitchen = String(parent.id);
  const [child] = await db().execute<Row>(sql`
    insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id) values (${store.storeId}::uuid, 'product', 'category', 'Mugs', ${`mugs-${run}`}, ${kitchen}::uuid) returning id
  `);
  await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${store.storeId}::uuid, ${mugProduct}::uuid, ${String(child.id)}::uuid)`);

  // Another store holds the same addresses with every fact: none of it counts here.
  const otherAnna = await customer(other.storeId, mail("anna"));
  const elsewhere = await paidOrder(other, TOTE, mail("anna"), otherAnna, daysAgo(1));
  await deal(other.storeId, otherAnna, "won");
  await review(elsewhere, otherAnna, 1);
  await conversation(other.storeId, { email: mail("ola") }, daysAgo(1), "bad");
  await smsNumber(other.storeId, "+4791000003", "subscribed", { email: mail("sub") });
  await subscription(other.storeId, elsewhere, mail("sub"), null, "active");
}, 180_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.marketing_subscribers where store_id in (${store.storeId}::uuid, ${other.storeId}::uuid)`);
  await db().execute(sql`delete from commerce.segments where store_id in (${store.storeId}::uuid, ${other.storeId}::uuid)`);
  await closeDb();
});

describe("what people bought (E3.6)", () => {
  it("finds who bought a product, ever or in the last days, and who has not", async () => {
    expect(await who(store, { kind: "bought", has: true, products: [mugProduct] })).toEqual(["anna"]);
    expect(await who(store, { kind: "bought", has: true, products: [mugProduct], days: 30 })).toEqual(["anna"]);
    expect(await who(store, { kind: "bought", has: true, products: [mugProduct], days: 5 })).toEqual([]);
    expect(await who(store, { kind: "bought", has: true, products: [toteProduct, mugProduct] })).toEqual(["anna", "ola"]);
    expect(await who(store, { kind: "bought", has: true, products: [toteProduct], days: 30 })).toEqual([]);
    expect(await who(store, { kind: "bought", has: false, products: [mugProduct] })).toEqual(["ola", "sub"]);
    // Anna bought a tote yesterday, but in another store.
    expect(await who(store, { kind: "bought", has: false, products: [toteProduct], days: 30 })).toEqual(["anna", "ola", "sub"]);
  });

  it("finds who bought from a category through the categories below it", async () => {
    expect(await who(store, { kind: "boughtCategory", has: true, categories: [kitchen] })).toEqual(["anna"]);
    expect(await who(store, { kind: "boughtCategory", has: false, categories: [kitchen], days: 3 })).toEqual(["anna", "ola", "sub"]);
  });

  it("reads one buyer alone as everyone's read finds them", async () => {
    const rules: SegmentRules = { match: "all", conditions: [{ kind: "bought", has: true, products: [mugProduct] }, { kind: "boughtCategory", has: true, categories: [kitchen] }] };
    const { people } = await seg.segmentPeople(store.member.store, NOW, { emails: [mail("anna")], rules: [rules] });
    expect(people).toHaveLength(1);
    expect(Object.keys(people[0].boughtProducts ?? {})).toEqual([mugProduct]);
    expect(Object.keys(people[0].boughtCategories ?? {})).toEqual([kitchen]);
  });
});

describe("how people deal with the store (E3.6)", () => {
  it("finds their own open deals and those won, while Deals is on", async () => {
    expect(await who(store, { kind: "deal", status: "open" })).toEqual(["anna"]);
    expect(await who(store, { kind: "deal", status: "won" })).toEqual([]);
    await features(store, ["shop", "reviews", "subscriptions"]);
    try {
      expect(await who(store, { kind: "deal", status: "open" })).toEqual([]);
    } finally {
      await features(store, ["shop", "sales", "reviews", "subscriptions"]);
    }
  });

  it("finds support conversations in the last days, by account or address, and a bad rating", async () => {
    expect(await who(store, { kind: "support", op: "within", days: 10 })).toEqual(["anna"]);
    expect(await who(store, { kind: "support", op: "within", days: 30 })).toEqual(["anna", "ola"]);
    expect(await who(store, { kind: "support", op: "ratedBad" })).toEqual(["anna"]);
  });

  it("finds who wrote a review, and one of at most some stars, while Product reviews is on", async () => {
    expect(await who(store, { kind: "review" })).toEqual(["anna"]);
    expect(await who(store, { kind: "review", maxStars: 2 })).toEqual(["anna"]);
    expect(await who(store, { kind: "review", maxStars: 1 })).toEqual([]);
    await features(store, ["shop", "sales", "subscriptions"]);
    try {
      expect(await who(store, { kind: "review" })).toEqual([]);
    } finally {
      await features(store, ["shop", "sales", "reviews", "subscriptions"]);
    }
  });

  it("finds who has a subscription running now, and who has none", async () => {
    expect(await who(store, { kind: "subscription", has: true })).toEqual(["anna"]);
    expect(await who(store, { kind: "subscription", has: false })).toEqual(["ola", "sub"]);
  });

  it("finds consent to texts by the number kept with the account or the address", async () => {
    expect(await who(store, { kind: "sms", statuses: ["subscribed"] })).toEqual(["anna"]);
    expect(await who(store, { kind: "sms", statuses: ["pending"] })).toEqual(["ola"]);
    expect(await who(store, { kind: "sms", statuses: ["none"] })).toEqual(["sub"]);
  });

  it("finds who pressed a link in the store's emails in the last days, and who has not (M2.4)", async () => {
    // Sub pressed a link in a flow's email ten days ago; another store's press for the same address counts for nothing here.
    const { saveFlow } = await import("./flows");
    const flow = await saveFlow(store.storeId, store.accountId, null, {
      name: `Clicks ${run}`,
      trigger: "subscriber.subscribed",
      steps: [{ id: "e", kind: "email", content: { "nb-NO": { subject: "Hei", preview: "", blocks: [{ type: "paragraph", text: "Hei" }] } } }],
      goals: [],
    });
    if (!flow.ok) throw new Error(flow.problem);
    await db().execute(sql`
      insert into commerce.email_clicks (store_id, subscriber_id, flow_id, step_id, link, clicked_at)
      select s.store_id, s.id, ${flow.id}::uuid, 'e', 'nb.0', ${daysAgo(10)}::timestamptz from commerce.marketing_subscribers s
       where s.store_id = ${store.storeId}::uuid and s.email = ${mail("sub")}
    `);
    expect(await who(store, { kind: "clicked", op: "within", days: 30 })).toEqual(["sub"]);
    expect(await who(store, { kind: "clicked", op: "within", days: 5 })).toEqual([]);
    expect(await who(store, { kind: "clicked", op: "never" })).toEqual(["anna", "ola"]);
  });
});

describe("saved segments on the newer conditions (E3.6)", () => {
  it("count, name their products and categories, and hold a person on their page", async () => {
    const rules: SegmentRules = { match: "all", conditions: [{ kind: "bought", has: true, products: [mugProduct] }, { kind: "support", op: "ratedBad" }] };
    const saved = await seg.saveSegment(store.storeId, store.accountId, null, { name: "Unhappy mug buyers", rules });
    expect(saved.ok).toBe(true);
    const counted = await seg.evaluateSegment(store.member.store, rules, NOW);
    expect(counted.sample.map((p) => p.email)).toEqual([mail("anna")]);
    expect((await segmentsOfPerson(store.member.store, mail("anna"), NOW)).in.map((s) => s.name)).toEqual(["Unhappy mug buyers"]);
    expect((await segmentsOfPerson(store.member.store, mail("ola"), NOW)).in).toEqual([]);
    const names = await seg.segmentNames(store.member.store, [rules, { match: "all", conditions: [{ kind: "boughtCategory", has: true, categories: [kitchen] }] }]);
    expect(names.productName?.(mugProduct)).toBeTruthy();
    expect(names.categoryName?.(kitchen)).toBe("Kitchen");
    const choices = await seg.boughtChoices(store.member.store);
    expect(choices.categories.map((c) => c.name)).toEqual(expect.arrayContaining(["Kitchen", "Kitchen › Mugs"]));
    expect(choices.products.map((p) => p.id)).toEqual(expect.arrayContaining([mugProduct, toteProduct]));
  });

  it("reads each store's own: the other store finds its own facts for the same address, and no one it does not know", async () => {
    expect(await who(other, { kind: "deal", status: "won" })).toEqual(["anna"]);
    expect(await who(other, { kind: "review", maxStars: 1 })).toEqual(["anna"]);
    expect(await who(other, { kind: "bought", has: true, products: [mugProduct] })).toEqual([]);
    // Ola only talked to the other store's support, and Sub only gave it a number: neither is one of its people.
    expect(await who(other, { kind: "support", op: "ratedBad" })).toEqual([]);
    expect(await who(other, { kind: "sms", statuses: ["subscribed"] })).toEqual([]);
  });
});
