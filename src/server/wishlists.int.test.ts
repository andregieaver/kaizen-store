import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const { startSession } = await import("./customers");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
const product: Record<string, string> = {};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`wish-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`wish-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const rows = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid`);
  for (const row of rows) product[String(row.handle)] = String(row.id);
});

beforeEach(() => jar.clear());

afterAll(async () => {
  await closeDb();
});

/** This browser's cart, as its cookie names it. */
const cartLines = async () =>
  db().execute<Row>(sql`
    select v.sku, cl.quantity from commerce.cart_lines cl join commerce.product_variants v on v.id = cl.variant_id
    where cl.cart_id = ${jar.get(`cart_${storeId}_${no.slug}`) ?? "00000000-0000-0000-0000-000000000000"}::uuid
    order by v.sku
  `);

describe("the heart (D34)", () => {
  it("saves a product in the shopper's first list, made on the first save, and takes it out of every list", async () => {
    expect(await wishlists.savedProductIds(storeId)).toEqual([]);
    const saved = await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste");
    expect(saved).toEqual({ saved: true, products: [product["demo-handlenett"]] });
    // The browser keeps the lists by a cookie holding a token, stored only as a hash.
    const token = jar.get(`wishlist_${storeId}`);
    expect(token).toBeTruthy();
    const [list] = await db().execute<Row>(sql`select name, browser_token_hash from commerce.wishlists where store_id = ${storeId}::uuid`);
    expect(list.name).toBe("Ønskeliste");
    expect(list.browser_token_hash).not.toBe(token);

    // A product with one variant is saved with it; one with several waits for the choice.
    await wishlists.toggleSavedProduct(storeId, product["demo-notatbok"], "Ønskeliste");
    const [lists] = [await wishlists.listWishlists(storeId)];
    const items = await wishlists.getWishlistItems(storeId, lists[0].id);
    expect(items.find((i) => i.handle === "demo-handlenett")?.variantId).not.toBeNull();
    expect(items.find((i) => i.handle === "demo-notatbok")?.variantId).toBeNull();

    expect(await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste")).toEqual({
      saved: false,
      products: [product["demo-notatbok"]],
    });
  });

  it("shows another browser nothing", async () => {
    await wishlists.toggleSavedProduct(storeId, product["demo-bordlampe"], "Ønskeliste");
    jar.clear();
    expect(await wishlists.savedProductIds(storeId)).toEqual([]);
    expect(await wishlists.listWishlists(storeId)).toEqual([]);
  });
});

describe("several lists (D34)", () => {
  it("are made, renamed and deleted, and items move between them without doubling", async () => {
    await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste");
    await wishlists.toggleSavedProduct(storeId, product["demo-bordlampe"], "Ønskeliste");
    const gifts = await wishlists.createWishlist(storeId, "  Gaver   til jul ");
    expect(gifts).toMatchObject({ ok: true });
    expect(await wishlists.createWishlist(storeId, "   ")).toEqual({ ok: false, problem: "name" });
    const [first, second] = await wishlists.listWishlists(storeId);
    expect(second).toMatchObject({ name: "Gaver til jul", items: 0, keepAfterCart: true });

    const items = await wishlists.getWishlistItems(storeId, first.id);
    expect(await wishlists.moveWishlistItems(storeId, items.map((i) => i.id), second.id)).toBe(2);
    // Saving again puts it in the first list; moving that copy leaves one in the second.
    await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste");
    expect((await wishlists.getWishlistItems(storeId, second.id)).map((i) => i.handle).sort()).toEqual(["demo-bordlampe"]);
    await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste");
    await wishlists.moveWishlistItems(storeId, (await wishlists.getWishlistItems(storeId, first.id)).map((i) => i.id), second.id);
    expect((await wishlists.getWishlistItems(storeId, second.id)).map((i) => i.handle).sort()).toEqual(["demo-bordlampe", "demo-handlenett"]);

    expect(await wishlists.updateWishlist(storeId, second.id, { name: "Jul" })).toEqual({ ok: true });
    expect(await wishlists.deleteWishlist(storeId, first.id)).toBe(true);
    expect((await wishlists.listWishlists(storeId)).map((l) => l.name)).toEqual(["Jul"]);

    // Another browser can touch none of it.
    jar.clear();
    expect(await wishlists.deleteWishlist(storeId, second.id)).toBe(false);
    expect(await wishlists.updateWishlist(storeId, second.id, { name: "Mine" })).toEqual({ ok: false, problem: "unknown" });
  });
});

describe("to the cart (D34)", () => {
  it("adds all or chosen items with their variant and quantity, and the list keeps them or not", async () => {
    await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste");
    await wishlists.toggleSavedProduct(storeId, product["demo-notatbok"], "Ønskeliste");
    const [list] = await wishlists.listWishlists(storeId);
    const items = await wishlists.getWishlistItems(storeId, list.id);
    const tote = items.find((i) => i.handle === "demo-handlenett")!;
    const notebook = items.find((i) => i.handle === "demo-notatbok")!;
    expect(await wishlists.setWishlistItem(storeId, tote.id, { quantity: 3 })).toBe(true);

    // The notebook needs its variant chosen; the tote goes, and the list keeps it.
    const first = await wishlists.addWishlistToCart(storeId, no, list.id, null);
    expect(first.outcomes).toEqual({ [tote.id]: "added", [notebook.id]: "needs_variant" });
    expect(await wishlists.getWishlistItems(storeId, list.id)).toHaveLength(2);

    // A variant of another product is refused; the notebook's own is taken.
    const [otherVariant] = await db().execute<Row>(sql`
      select id from commerce.product_variants where store_id = ${storeId}::uuid and product_id = ${product["demo-bordlampe"]}::uuid
    `);
    expect(await wishlists.setWishlistItem(storeId, notebook.id, { variantId: String(otherVariant.id) })).toBe(false);
    const [lined] = await db().execute<Row>(sql`
      select v.id from commerce.product_variants v
      join commerce.available_stock s on s.variant_id = v.id and s.available > 0
      where v.store_id = ${storeId}::uuid and v.product_id = ${product["demo-notatbok"]}::uuid limit 1
    `);
    expect(await wishlists.setWishlistItem(storeId, notebook.id, { variantId: String(lined.id) })).toBe(true);

    // This time the list lets go of what went to the cart.
    await wishlists.updateWishlist(storeId, list.id, { keepAfterCart: false });
    const second = await wishlists.addWishlistToCart(storeId, no, list.id, [notebook.id]);
    expect(second.outcomes).toEqual({ [notebook.id]: "added" });
    expect((await wishlists.getWishlistItems(storeId, list.id)).map((i) => i.id)).toEqual([tote.id]);

    const lines = await cartLines();
    expect(lines.find((l) => String(l.sku) === "DEMO-TOTE")?.quantity).toBe(3);
    expect(lines).toHaveLength(2);
  });
});

describe("signing in (D34)", () => {
  it("brings this browser's lists into the account, merging a list with the same name", async () => {
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, email_verified_at) values (${storeId}::uuid, ${`kari-${run}@example.com`}, now())
      returning id
    `);
    const customerId = String(customer.id);
    const [accountList] = await db().execute<Row>(sql`
      insert into commerce.wishlists (store_id, customer_id, name) values (${storeId}::uuid, ${customerId}::uuid, 'ønskeliste')
      returning id
    `);
    await db().execute(sql`
      insert into commerce.wishlist_items (store_id, wishlist_id, product_id)
      values (${storeId}::uuid, ${String(accountList.id)}::uuid, ${product["demo-bordlampe"]}::uuid)
    `);

    await wishlists.toggleSavedProduct(storeId, product["demo-bordlampe"], "Ønskeliste");
    await wishlists.toggleSavedProduct(storeId, product["demo-handlenett"], "Ønskeliste");
    await wishlists.createWishlist(storeId, "Hytta");

    await startSession(storeId, customerId);
    expect(jar.has(`wishlist_${storeId}`)).toBe(false);
    const lists = await wishlists.listWishlists(storeId);
    expect(lists.map((l) => [l.name, l.items])).toEqual([
      ["ønskeliste", 2],
      ["Hytta", 0],
    ]);
  });
});
