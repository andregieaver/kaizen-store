import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/** One browser's cookies, kept between calls as a real browser would. */
const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const wishlists = await import("./wishlists");
const admin = await import("./wishlist-admin");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
const product: Record<string, string> = {};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`wadmin-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`wadmin-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const rows = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid`);
  for (const row of rows) product[String(row.handle)] = String(row.id);
});

afterAll(async () => {
  await closeDb();
});

const cartId = () => jar.get(`cart_${storeId}_${no.slug}`)!;

/** The shopper checks out: the cart becomes an order holding these lines of it, paid or not. */
async function checkout(email: string, number: string, paid: boolean, only?: string) {
  const lines = await db().execute<Row>(sql`
    select cl.variant_id, cl.quantity, v.sku from commerce.cart_lines cl
    join commerce.product_variants v on v.id = cl.variant_id
    where cl.cart_id = ${cartId()}::uuid ${only ? sql`and v.sku = ${only}` : sql``}
  `);
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, cart_id,
      subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, ${paid ? "paid" : "pending_payment"}, ${cartId()}::uuid,
      0, 0, 0, 0, '{}', ${JSON.stringify({ name: "Gro Gave" })})
    returning id
  `);
  for (const line of lines) {
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
      values (${storeId}::uuid, ${String(order.id)}::uuid, ${String(line.variant_id)}::uuid, ${String(line.sku)}, 'x',
        ${Number(line.quantity)}, 10000, ${10000 * Number(line.quantity)}, 0, 0.25, 'txcd_99999999')
    `);
  }
  await db().execute(sql`update commerce.carts set status = 'converted' where id = ${cartId()}::uuid`);
  return String(order.id);
}

describe("the store's wishlists (D36)", () => {
  it("records what goes from a list to the cart, and follows it to the order the cart became", async () => {
    await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste");
    await wishlists.toggleSavedProduct(storeId, product["demo-keramikkopp"], "Ønskeliste");
    const [list] = await wishlists.listWishlists(storeId);
    const items = await wishlists.getWishlistItems(storeId, list.id);
    const tote = items.find((i) => i.handle === "demo-handlenett")!;
    await wishlists.setWishlistItem(storeId, tote.id, { quantity: 2 });
    const mug = items.find((i) => i.handle === "demo-keramikkopp")!;
    const [white] = await db().execute<Row>(sql`
      select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'
    `);
    await wishlists.setWishlistItem(storeId, mug.id, { variantId: String(white.id) });
    await wishlists.addWishlistToCart(storeId, no, list.id, null);

    // Both are in the cart, recorded with the list's name, the title and the price as they were.
    let adds = await admin.listCartAdds(storeId);
    expect(adds).toHaveLength(2);
    expect(adds.every((a) => a.status === "in_cart" && a.wishlist.name === "Ønskeliste" && a.customer === null)).toBe(true);
    const toteAdd = adds.find((a) => a.sku === "DEMO-TOTE")!;
    expect(toteAdd).toMatchObject({ quantity: 2, currency: "NOK" });
    expect(toteAdd.unitPriceMinor).toBeGreaterThan(0);

    // The shopper takes the mug out, then buys the tote alone.
    await db().execute(sql`delete from commerce.cart_lines where cart_id = ${cartId()}::uuid and variant_id = ${String(white.id)}::uuid`);
    adds = await admin.listCartAdds(storeId);
    expect(adds.find((a) => a.sku !== "DEMO-TOTE")?.status).toBe("removed");

    const orderId = await checkout(`gro-${run}@example.com`, `W1-${run}`, false);
    expect((await admin.listCartAdds(storeId)).find((a) => a.sku === "DEMO-TOTE")?.status).toBe("awaiting_payment");
    await db().execute(sql`update commerce.orders set status = 'paid' where id = ${orderId}::uuid`);

    adds = await admin.listCartAdds(storeId);
    expect(adds.find((a) => a.sku === "DEMO-TOTE")).toMatchObject({
      status: "bought",
      order: { id: orderId, number: `W1-${run}`, boughtQuantity: 2, boughtMinor: 20000, currency: "NOK" },
      // A guest's list: the shopper is known by their order.
      customer: { key: orderId, name: "Gro Gave", email: `gro-${run}@example.com` },
    });
    expect((await admin.listCartAdds(storeId, { outcome: "bought" })).map((a) => a.sku)).toEqual(["DEMO-TOTE"]);
    expect((await admin.listCartAdds(storeId, { orderId })).map((a) => a.sku)).toEqual(["DEMO-TOTE"]);
    expect(await admin.listCartAdds(storeId, { outcome: "not_bought" })).toHaveLength(1);

    const figures = await admin.wishlistFigures(storeId);
    expect(figures).toMatchObject({ lists: 1, savedItems: 2, shoppers: 1, toCart: 2, bought: 1, boughtMinor: { NOK: 20000 } });

    const [row] = await admin.listStoreWishlists(storeId);
    expect(row).toMatchObject({ id: list.id, name: "Ønskeliste", owner: null, items: 2, toCart: 2, bought: 1 });
    expect(await admin.listStoreWishlists(storeId, { q: "nothing-like-this" })).toEqual([]);

    const detail = await admin.getStoreWishlist(storeId, list.id, { code: "NO", locale: "nb-NO" });
    expect(detail?.items).toHaveLength(2);
    expect(detail?.items.find((i) => i.variant?.sku === "DEMO-TOTE")).toMatchObject({ quantity: 2, currency: "NOK" });

    const [top] = await admin.mostWishedProducts(storeId, "nb-NO");
    expect(top).toMatchObject({ lists: 1 });
  });

  it("keeps the record when the list is deleted, and shows no other store's lists", async () => {
    const [list] = await wishlists.listWishlists(storeId);
    await wishlists.deleteWishlist(storeId, list.id);
    const adds = await admin.listCartAdds(storeId);
    expect(adds).toHaveLength(2);
    expect(adds[0].wishlist).toEqual({ id: null, name: "Ønskeliste" });
    expect(await admin.getStoreWishlist("00000000-0000-4000-8000-000000000000", list.id, null)).toBeNull();
  });

  it("belongs to the account for a signed-in shopper's list", async () => {
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name, email_verified_at)
      values (${storeId}::uuid, ${`kari-${run}@example.com`}, 'Kari', now()) returning id
    `);
    const customerId = String(customer.id);
    const [list] = await db().execute<Row>(sql`
      insert into commerce.wishlists (store_id, customer_id, name) values (${storeId}::uuid, ${customerId}::uuid, 'Hytta') returning id
    `);
    await db().execute(sql`
      insert into commerce.wishlist_items (store_id, wishlist_id, product_id)
      values (${storeId}::uuid, ${String(list.id)}::uuid, ${product["demo-notatbok"]}::uuid)
    `);
    const mine = await admin.listStoreWishlists(storeId, { customerId });
    expect(mine).toEqual([expect.objectContaining({ name: "Hytta", owner: { customerId, name: "Kari", email: `kari-${run}@example.com` } })]);
    expect((await admin.listStoreWishlists(storeId, { q: "kari" })).map((l) => l.name)).toEqual(["Hytta"]);
  });
});
