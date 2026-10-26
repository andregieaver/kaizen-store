import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { changeLine, getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { createHandoffCart } = await import("./cart-handoff");
const { placeOrder } = await import("./checkout");
const { getStore } = await import("./stores");
const { quoteCart } = await import("./wordpress-shop");
const { cartOf, mainLocation, newStore, no, setLevel, variantId } = await import("./inventory-test-support");

/**
 * Quantity rules (wave 6 unit E1, D323, `docs/wave-6-catalogue.md` E.1): adding puts in the minimum and then whole steps, the cart refuses and
 * explains a quantity that breaks the rule, checkout refuses it, and the WordPress hand-over fits a line to it.
 */
let storeId: string;
let slug: string;
let main: string;
const MUG = "DEMO-MUG-WHITE";
const shop = () => ({ storeId, market: no });
const rule = (min: number, max: number | null, step: number) =>
  db().execute(sql`
    update commerce.product_variants set min_quantity = ${min}, max_quantity = ${max}, quantity_step = ${step}
    where store_id = ${storeId}::uuid and sku = ${MUG}
  `);

beforeAll(async () => {
  const made = await newStore("quantity-rules");
  storeId = made.storeId;
  slug = made.slug;
  main = await mainLocation(storeId);
  await setLevel(storeId, MUG, main, 100);
});

afterAll(async () => {
  await closeDb();
});

describe("a variant sold so many at a time (D323)", () => {
  it("is added by its minimum and then whole steps, and never past its maximum", async () => {
    jar.clear();
    await rule(12, 48, 6);
    const mug = await variantId(storeId, MUG);
    expect(await changeLine(shop(), mug, 1, "add")).toEqual({ outcome: "added", quantity: 12 });
    expect(await changeLine(shop(), mug, 1, "add")).toEqual({ outcome: "added", quantity: 18 });
    expect(await changeLine(shop(), mug, 60, "set")).toEqual({ outcome: "capped", quantity: 48 });
    expect(await changeLine(shop(), mug, 24, "set")).toEqual({ outcome: "added", quantity: 24 });
  });

  it("refuses a quantity below the minimum or between steps, keeping the line, and says the rule", async () => {
    const mug = await variantId(storeId, MUG);
    expect(await changeLine(shop(), mug, 15, "set")).toEqual({ outcome: "quantity", quantity: 24 });
    expect(await changeLine(shop(), mug, 6, "set")).toEqual({ outcome: "quantity", quantity: 24 });
    const cart = await getCart(shop());
    expect(cart.lines[0]).toMatchObject({ quantity: 24, status: "ok", rule: { min: 12, max: 48, step: 6 } });
  });

  it("blocks checkout for a line the rule no longer allows, and checkout refuses it", async () => {
    await rule(10, null, 5);
    const cart = await getCart(shop());
    expect(cart.lines[0]).toMatchObject({ quantity: 24, status: "quantity", rule: { min: 10, max: null, step: 5 } });
    expect((await cartSummary(shop(), cart)).blocked).toBe(true);
    const placed = await placeOrder(shop(), await cartOf(storeId, [[MUG, 24]]));
    expect(placed).toEqual({ ok: false, problem: "quantity" });
    // Adding puts the line right: the next whole step.
    expect(await changeLine(shop(), await variantId(storeId, MUG), 1, "add")).toEqual({ outcome: "added", quantity: 25 });
    expect((await getCart(shop())).lines[0].status).toBe("ok");
  });

  it("is not put in at all when the stock does not reach the minimum", async () => {
    jar.clear();
    await rule(12, null, 6);
    await setLevel(storeId, MUG, main, 8);
    expect(await changeLine(shop(), await variantId(storeId, MUG), 1, "add")).toEqual({ outcome: "unavailable", quantity: 0 });
    await setLevel(storeId, MUG, main, 100);
  });

  it("is fitted to the rule when a cart is handed over from WordPress", async () => {
    await rule(6, 24, 6);
    const made = await createHandoffCart(shop(), [{ variantId: await variantId(storeId, MUG), quantity: 7 }], "cart");
    expect(made.ok && made.lines[0]).toMatchObject({ quantity: 12, outcome: "added" });
    const capped = await createHandoffCart(shop(), [{ variantId: await variantId(storeId, MUG), quantity: 100 }], "cart");
    expect(capped.ok && capped.lines[0]).toMatchObject({ quantity: 24, outcome: "capped" });
    // The quote counts the same fitted quantity and says why, so the site's cart can show it.
    const quote = await quoteCart((await getStore(slug))!, null, [{ variantId: await variantId(storeId, MUG), quantity: 7 }]);
    expect(quote?.lines[0]).toMatchObject({ quantity: 7, fitted: 12, status: "quantity", quantity_rule: { min: 6, max: 24, step: 6 } });
    expect(quote?.lines[0].quantity_rule.text).toBeTruthy();
    expect(quote?.count).toBe(12);
    await rule(1, null, 1);
  });

  it("leaves a variant without a rule at one at a time, up to 20", async () => {
    jar.clear();
    expect(await changeLine(shop(), await variantId(storeId, MUG), 25, "add")).toEqual({ outcome: "capped", quantity: 20 });
  });
});
