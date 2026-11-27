import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { seedProducts } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { sellableQuantity } = await import("./cart");

type Row = Record<string, unknown>;

/**
 * A purchase option for one variant (D911) through the editor's own save and the cart: monthly and yearly as two variants with their
 * own prices, each option saved on its variant by SKU and read back so, never widened to every variant, and a cart that takes each
 * variant with its own option only.
 */

let fx: Fixture;
let product: { id: string; handle: string; skus: string[] };

beforeAll(async () => {
  fx = await makeStore("pov");
  [product] = await seedProducts(fx, 1, { prefix: "POV", variants: 2 });
  await db().execute(sql`
    update commerce.stores set features = array_append(features, 'subscriptions')
    where id = ${fx.storeId}::uuid and not ('subscriptions' = any(features))
  `);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const editorOf = async () => {
  const store = (await getStore(fx.slug))!;
  return { store, editor: await getEditorContext(store) };
};

const plan = (variantSku: string | null, interval: "month" | "year") => ({
  id: null,
  variantSku,
  interval,
  intervalCount: 1,
  discountPercent: 0,
  trialDays: 0,
  signupFee: {} as Record<string, string>,
  minCycles: 0,
});

describe("purchase options for one variant (D911)", () => {
  it("saves each option on its variant, reads it back, and refuses one for a variant the product does not have", async () => {
    const { store, editor } = await editorOf();
    const input = (await getProductForEdit(store, editor, product.id))!;
    const [monthlySku, yearlySku] = product.skus;
    const saved = await saveProduct(store, editor, product.id, {
      ...input,
      plans: [plan(monthlySku, "month"), plan(yearlySku, "year")],
      subscriptionOnly: true,
    });
    if (!saved.ok) throw new Error(saved.problems.join(" "));

    const read = (await getProductForEdit(store, editor, product.id))!;
    expect(read.plans.map((p) => [p.variantSku, p.interval])).toEqual([
      [monthlySku, "month"],
      [yearlySku, "year"],
    ]);
    const stored = await db().execute<Row>(sql`
      select v.sku, sp.interval::text as interval from commerce.selling_plans sp
      join commerce.product_variants v on v.id = sp.variant_id
      where sp.product_id = ${product.id}::uuid and sp.active order by sp.position
    `);
    expect(stored.map((r) => [r.sku, r.interval])).toEqual([
      [monthlySku, "month"],
      [yearlySku, "year"],
    ]);

    const gone = await saveProduct(store, editor, product.id, { ...read, plans: [read.plans[0], plan("POV-NO-SUCH", "year")] });
    expect(gone.ok).toBe(false);
    // The two options it had are untouched.
    const kept = await db().execute<Row>(sql`select count(*)::int as n from commerce.selling_plans where product_id = ${product.id}::uuid and active and variant_id is not null`);
    expect(kept[0].n).toBe(2);
  });

  it("puts each variant in a cart with its own option only", async () => {
    const store = (await getStore(fx.slug))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    const rows = await db().execute<Row>(sql`
      select sp.id as plan_id, sp.variant_id from commerce.selling_plans sp
      where sp.product_id = ${product.id}::uuid and sp.active order by sp.position
    `);
    const [monthly, yearly] = rows.map((r) => ({ plan: String(r.plan_id), variant: String(r.variant_id) }));
    const sellable = (variant: string, sellingPlan: string) =>
      db().transaction((tx) => sellableQuantity(tx, { storeId: fx.storeId, market } as never, variant, sellingPlan, null, 1));
    expect(await sellable(monthly.variant, monthly.plan)).not.toBeNull();
    expect(await sellable(yearly.variant, yearly.plan)).not.toBeNull();
    // The yearly variant every month (or the monthly every year) is never sold.
    expect(await sellable(yearly.variant, monthly.plan)).toBeNull();
    expect(await sellable(monthly.variant, yearly.plan)).toBeNull();
  });
});
