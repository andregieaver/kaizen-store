import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { seedProducts } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
// A shopper's cookies, kept between calls as a browser keeps them, so the cart is the same cart.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { getProduct, listProducts } = await import("./catalog");
const { choosePlan, readCartId } = await import("./cart");
const { getStorePlans, planPricingPath } = await import("./store-plans");

type Row = Record<string, unknown>;

/**
 * A plan (D912) through the editor's own save, the catalogue and the cart: made from a product with a variant a billing period, it is a
 * service sold only by subscription; it is in no list and has no product page; the pricing table reads it with what a subscriber pays each
 * month and each year; choosing it puts it in the cart as the cart's one plan; its old address leads to the page with the pricing table.
 */

let fx: Fixture;
let product: { id: string; handle: string; skus: string[] };

beforeAll(async () => {
  fx = await makeStore("plan");
  [product] = await seedProducts(fx, 1, { prefix: "PLAN", variants: 2 });
  await db().execute(sql`
    update commerce.stores set features = array_append(features, 'subscriptions')
    where id = ${fx.storeId}::uuid and not ('subscriptions' = any(features))
  `);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const renews = (variantSku: string, interval: "month" | "year") => ({
  id: null,
  variantSku,
  interval,
  intervalCount: 1,
  discountPercent: 0,
  trialDays: interval === "month" ? 14 : 0,
  signupFee: {} as Record<string, string>,
  minCycles: 0,
});

const shopOf = async () => {
  const store = (await getStore(fx.slug))!;
  return { store, market: store.markets.find((m) => m.code === "NO")! };
};

describe("a plan (D912)", () => {
  it("is saved by the editor as a service sold only by subscription, with what it includes as its description", async () => {
    const store = (await getStore(fx.slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, product.id))!;
    const [monthly, yearly] = product.skus;
    const saved = await saveProduct(store, editor, product.id, {
      ...input,
      kind: "plan",
      // Even unticked, a plan is sold only by subscription; its variants become services.
      subscriptionOnly: false,
      media: [],
      translations: input.translations.map((t, i) => (i === 0 ? { ...t, title: "Plus", description: "- Unlimited notes\n- AI summaries" } : t)),
      variants: input.variants.map((v, i) => ({ ...v, prices: { NO: i === 0 ? "199" : "1990" } })),
      plans: [renews(monthly, "month"), renews(yearly, "year")],
    });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const [row] = await db().execute<Row>(sql`
      select p.kind, p.subscription_only, array_agg(distinct v.delivery::text) as deliveries
      from commerce.products p join commerce.product_variants v on v.product_id = p.id
      where p.id = ${product.id}::uuid group by p.kind, p.subscription_only
    `);
    expect(row).toMatchObject({ kind: "plan", subscription_only: true, deliveries: ["service"] });

    // A plan renews every month or every year, as its pricing table shows it.
    const read = (await getProductForEdit(store, editor, product.id))!;
    const quarterly = await saveProduct(store, editor, product.id, { ...read, plans: [{ ...read.plans[0], intervalCount: 3 }, read.plans[1]] });
    expect(quarterly.ok).toBe(false);
  });

  it("keeps its variants when a save sends them without their ids, by their SKUs (D914)", async () => {
    const store = (await getStore(fx.slug))!;
    const editor = await getEditorContext(store);
    const read = (await getProductForEdit(store, editor, product.id))!;
    const ids = read.variants.map((v) => v.id);
    // An editor holding a copy made before the save, or one that made the variants again, sends them as new: never a second of each SKU.
    const saved = await saveProduct(store, editor, product.id, { ...read, variants: read.variants.map((v) => ({ ...v, id: null })) });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const after = (await getProductForEdit(store, editor, product.id))!;
    expect(after.variants.map((v) => v.id)).toEqual(ids);
    const [{ count }] = await db().execute<Row>(sql`select count(*)::int as count from commerce.product_variants where product_id = ${product.id}::uuid`);
    expect(count).toBe(ids.length);
  });

  it("is in no list and has no product page, and its pricing table has it at its monthly and yearly prices", async () => {
    const { store, market } = await shopOf();
    expect((await listProducts(store.id, market)).map((p) => p.id)).not.toContain(product.id);
    expect(await getProduct(store.id, market, product.handle)).toBeNull();
    const { plans, withVat } = await getStorePlans(store.id, market);
    expect(withVat).toBe(true);
    const plus = plans.find((p) => p.id === product.id)!;
    expect(plus.name).toBe("Plus");
    expect(plus.included).toEqual(["Unlimited notes", "AI summaries"]);
    expect(plus.prices.map((p) => [p.interval, p.amountMinor, p.currency, p.trialDays])).toEqual([
      ["month", 19900, "NOK", 14],
      ["year", 199000, "NOK", 0],
    ]);
  });

  it("carries its product categories and the ones above them, for a pricing table of one category (D914)", async () => {
    const { store, market } = await shopOf();
    const [top] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug) values (${store.id}::uuid, 'product', 'category', 'Life', 'life') returning id
    `);
    const [under] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, parent_id, name, slug)
      values (${store.id}::uuid, 'product', 'category', ${top.id}::uuid, 'Life plans', 'life-plans') returning id
    `);
    await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${store.id}::uuid, ${product.id}::uuid, ${under.id}::uuid)`);
    // The catalogue is cached in Next; here each read is fresh.
    const plus = (await getStorePlans(store.id, market)).plans.find((p) => p.id === product.id)!;
    expect([...plus.categoryIds].sort()).toEqual([String(top.id), String(under.id)].sort());
  });

  it("goes in the cart as its one plan, one of it: choosing yearly after monthly leaves yearly alone", async () => {
    const { store, market } = await shopOf();
    const shop = { storeId: store.id, market };
    const { plans } = await getStorePlans(store.id, market);
    const [month, year] = plans.find((p) => p.id === product.id)!.prices;
    expect((await choosePlan(shop, month.variantId, month.sellingPlanId)).outcome).toBe("added");
    expect((await choosePlan(shop, year.variantId, year.sellingPlanId)).outcome).toBe("added");
    // Choosing the same again is still one.
    await choosePlan(shop, year.variantId, year.sellingPlanId);
    const cartId = (await readCartId(shop))!;
    const lines = await db().execute<Row>(sql`
      select variant_id, selling_plan_id, quantity from commerce.cart_lines where store_id = ${store.id}::uuid and cart_id = ${cartId}::uuid
    `);
    expect(lines).toEqual([{ variant_id: year.variantId, selling_plan_id: year.sellingPlanId, quantity: 1 }]);
  });

  it("leads its old address to the published page with the pricing table, and nothing else there", async () => {
    const { store } = await shopOf();
    expect(await planPricingPath(store.id, product.handle)).toBeNull();
    const content = { rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "pl", type: "plans", buttonLabel: "", buttonHref: "" }] }] }] };
    await db().execute(sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${store.id}::uuid, 'page', 'pricing', ${JSON.stringify(content)}::jsonb, ${JSON.stringify(content)}::jsonb, now())
    `);
    expect(await planPricingPath(store.id, product.handle)).toBe("/pricing");
    expect(await planPricingPath(store.id, "no-such-plan")).toBeNull();
  });
});
