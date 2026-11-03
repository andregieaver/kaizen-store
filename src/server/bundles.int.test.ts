import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { onRequestInBundlesProblem } = await import("./bundles");
const { getStore } = await import("./stores");
const { changeLine, getCart } = await import("./cart");
const { placeOrder } = await import("./checkout");
const support = await import("./inventory-test-support");

type Row = Record<string, unknown>;
type TestStore = Awaited<ReturnType<typeof support.newStore>>;

/**
 * A product priced on request in bundles (D433), against a real database: it may be a part of a bundle with a price of its own, never of one
 * priced from its products' prices (whose price would be its list price). The editor's save says why and how to put it right, the database
 * refuses the same at commit, and a bundle with a price of its own holding such a part is bought as any bundle (the cart and checkout read only
 * the line's own product). Every store is copied from the template, whose demo bundle (`demo-kaffepakke`) is priced from the white mug and the
 * tote at 10 % off.
 */

afterAll(async () => {
  await closeDb();
});

beforeEach(() => jar.clear());

async function bundleStore(label: string): Promise<TestStore> {
  const store = await support.newStore(label);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${store.storeId}::uuid`);
  return store;
}

const productIdOf = async (store: TestStore, handle: string) =>
  String((await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.storeId}::uuid and handle = ${handle}`))[0].id);

const onRequest = (store: TestStore, handle: string) =>
  db().execute(sql`update commerce.products set price_on_request = true where store_id = ${store.storeId}::uuid and handle = ${handle}`);

/** The database's refusal of a write, as its message and detail (the driver's error is the cause of drizzle's); null when it was written. */
const refusal = (write: Promise<unknown>) =>
  write.then(
    () => null,
    (error: Error & { cause?: Error & { detail?: string } }) => ({ message: String(error.cause?.message ?? error.message), detail: error.cause?.detail }),
  );

const flagOf = async (store: TestStore, handle: string) =>
  Boolean((await db().execute<Row>(sql`select price_on_request from commerce.products where store_id = ${store.storeId}::uuid and handle = ${handle}`))[0].price_on_request);

/** The editor of a product as it opens: the live store, its context and the product as the editor holds it. */
async function editorOf(store: TestStore, handle: string) {
  const live = (await getStore(store.slug))!;
  const context = await getEditorContext(live);
  const id = await productIdOf(store, handle);
  const product = (await getProductForEdit(live, context, id))!;
  const { archived, ...input } = product;
  void archived;
  return { live, context, id, input };
}

describe("a product priced on request in a bundle", () => {
  it("is refused in a bundle priced from its products' prices, with words that say how to put it right, and kept in one with a price of its own", async () => {
    const store = await bundleStore("bundle-por");
    await onRequest(store, "demo-bordlampe");
    const lamp = await support.variantId(store.storeId, "DEMO-LAMP");
    const { live, context, id, input } = await editorOf(store, "demo-kaffepakke");
    expect(input.bundle?.pricing).toBe("computed");
    const withLamp = { ...input, bundle: { ...input.bundle!, components: [...input.bundle!.components, { variantId: lamp, quantity: 1 }] } };

    const refused = await saveProduct(live, context, id, withLamp);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.problems).toHaveLength(1);
    expect(refused.problems[0]).toMatch(/is priced on request, so the bundle cannot take its price from it: give the bundle a price of its own, or untick Price on request on .+ to show its price\.$/);
    const parts = async () =>
      (
        await db().execute<Row>(sql`
          select v.sku from commerce.bundle_components bc join commerce.product_variants v on v.id = bc.component_variant_id
          where bc.store_id = ${store.storeId}::uuid order by bc.position`)
      ).map((r) => String(r.sku));
    expect(await parts()).toEqual(["DEMO-MUG-WHITE", "DEMO-TOTE"]);

    // With a price of its own (the one it has, kept as typed), the lamp goes in.
    const fixed = { ...withLamp, bundle: { ...withLamp.bundle, pricing: "fixed" as const, percentOff: 0 } };
    expect(await saveProduct(live, context, id, fixed)).toEqual({ ok: true, productId: id });
    expect(await parts()).toEqual(["DEMO-MUG-WHITE", "DEMO-TOTE", "DEMO-LAMP"]);

    // Switching it back to a price from its products is refused while the lamp is in it, by the editor and by the database.
    const back = await saveProduct(live, context, id, { ...fixed, bundle: { ...fixed.bundle, pricing: "computed", percentOff: 10 } });
    expect(back.ok === false && back.problems).toEqual([expect.stringMatching(/ is priced on request, so the bundle cannot take its price from it: /)]);
    expect(await refusal(db().execute(sql`update commerce.products set bundle_pricing = 'computed', bundle_percent_off = 10 where id = ${id}::uuid`))).toMatchObject({
      message: expect.stringMatching(/^bundle_components.price_on_request: /),
    });
    const [row] = await db().execute<Row>(sql`select bundle_pricing from commerce.products where id = ${id}::uuid`);
    expect(row.bundle_pricing).toBe("fixed");
  });

  it("cannot be ticked on a product in a bundle priced from its products' prices: the save names the bundle", async () => {
    const store = await bundleStore("bundle-por-tick");
    const tote = await editorOf(store, "demo-handlenett");
    const ticked = await saveProduct(tote.live, tote.context, tote.id, { ...tote.input, priceOnRequest: true });
    expect(ticked).toEqual({ ok: false, problems: [onRequestInBundlesProblem(["Demo: Kaffepakke"])] });
    expect(ticked.ok === false && ticked.problems[0]).toBe(
      'This product is in the bundle "Demo: Kaffepakke", priced from its products\' prices, so it cannot be priced on request: give that bundle a price of its own first, or leave Price on request unticked.',
    );
    expect(await flagOf(store, "demo-handlenett")).toBe(false);
    // The database refuses it too, whoever writes it.
    expect(await refusal(onRequest(store, "demo-handlenett"))).toEqual({
      message: expect.stringMatching(/^products.price_on_request_bundle: /),
      detail: "demo-kaffepakke",
    });

    // Once the bundle has a price of its own, the tote can be priced on request.
    const bundle = await editorOf(store, "demo-kaffepakke");
    expect(await saveProduct(bundle.live, bundle.context, bundle.id, { ...bundle.input, bundle: { ...bundle.input.bundle!, pricing: "fixed", percentOff: 0 } })).toMatchObject({
      ok: true,
    });
    expect(await saveProduct(tote.live, tote.context, tote.id, { ...tote.input, priceOnRequest: true })).toEqual({ ok: true, productId: tote.id });
    expect(await flagOf(store, "demo-handlenett")).toBe(true);
  });

  it("is sold inside a bundle with a price of its own, at the bundle's price, while it is never put in a cart on its own", async () => {
    const store = await bundleStore("bundle-por-sell");
    const bundle = await editorOf(store, "demo-kaffepakke");
    expect(await saveProduct(bundle.live, bundle.context, bundle.id, { ...bundle.input, bundle: { ...bundle.input.bundle!, pricing: "fixed", percentOff: 0 } })).toMatchObject({
      ok: true,
    });
    await onRequest(store, "demo-handlenett");
    const market = bundle.live.markets.find((m) => m.code === "NO")!;
    const shop = { storeId: store.storeId, market };
    const [price] = await db().execute<Row>(sql`select amount_minor from commerce.current_prices where variant_id = (select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-VERDIPAKKE') and market_code = 'NO'`);

    // The tote alone: never in a cart.
    expect((await changeLine(shop, await support.variantId(store.storeId, "DEMO-TOTE"), 1, "add")).outcome).toBe("unavailable");
    // The bundle holding it: in the cart at its own price, and placed as an order whose line keeps its parts.
    expect((await changeLine(shop, await support.variantId(store.storeId, "DEMO-VERDIPAKKE"), 1, "add")).outcome).toBe("added");
    const cart = await getCart(shop);
    expect(cart.lines.map((l) => [l.handle, l.status, l.unitPriceMinor])).toEqual([["demo-kaffepakke", "ok", Number(price.amount_minor)]]);
    const placed = await placeOrder(shop, await support.cartOf(store.storeId, [["DEMO-VERDIPAKKE", 2]], market));
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const lines = await db().execute<Row>(sql`
      select ol.sku, ol.quantity, ol.unit_price_minor, (select string_agg(c.sku || ' x' || c.quantity, ', ' order by c.position) from commerce.order_line_components c where c.order_line_id = ol.id) as parts
      from commerce.order_lines ol where ol.order_id = ${placed.order.orderId}::uuid and ol.variant_id is not null`);
    expect(lines.map((l) => [l.sku, Number(l.quantity), Number(l.unit_price_minor), l.parts])).toEqual([
      ["DEMO-VERDIPAKKE", 2, Number(price.amount_minor), "DEMO-MUG-WHITE x2, DEMO-TOTE x1"],
    ]);
  });
});
