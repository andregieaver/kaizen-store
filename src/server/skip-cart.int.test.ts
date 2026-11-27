import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { checkoutConsents } from "@/lib/checkout-consents";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

import { seedProducts } from "./data-test-support";
import { makeStore, no, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
// A shopper's cookies, kept between calls as a browser keeps them, so the cart is the same cart.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
/** Kaizena Flow's platform Stripe client, faked: the payment pages opened, recorded. */
const fake = vi.hoisted(() => {
  const created: Record<string, unknown>[] = [];
  let next = 0;
  const client = {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          const id = `cs_skip_${++next}`;
          created.push(params);
          return { id, url: `https://checkout.stripe.test/${id}`, client_secret: `${id}_secret_test`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, status: "open", payment_status: "unpaid" }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client, created };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_skip", platformModes: () => ["test"] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_skip", platformSecretKey: () => "sk_test_x" }));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { changeLine, choosePlan, readCartId } = await import("./cart");
const { cartSkips, saveSkipCart, storeSkipsCart } = await import("./skip-cart");
const { startDirect } = await import("./direct-start");
const { createTerm, listTerms, updateTerm } = await import("./taxonomy");

type Row = Record<string, unknown>;

/**
 * Buy now past the cart page (D915), through the editor's own save, the basket's rule and the press itself: a product's choice is saved and read
 * back (and so is its price of nothing, D913, which the editor lost before); a basket goes past the cart only when every product in it does; and
 * the press opens the payment page only when the button said every sentence the basket asks (`checkoutConsents()`), else the cart is shown.
 */

const origin = "http://localhost:3000";
const PAYMENT_PAGE = /^(https:\/\/checkout\.stripe\.test\/|http:\/\/localhost:3000\/s\/[^/]+\/[^/]+\/checkout)/;
const m = t(no.lang);
const money = (minor: number) => formatMoney(minor, no.currency, no.locale, no.priceStyle);
let fx: Fixture;
let download: string;
let needsCart: string;
let planVariant: string;
let planOption: string;

async function product(handle: string, kind: string, delivery: string, price: number, skipCart: boolean | null): Promise<string> {
  return db().transaction(async (tx) => {
    const [p] = await tx.execute<Row>(sql`
      insert into commerce.products (store_id, handle, tax_code, kind, delivery, subscription_only, skip_cart)
      values (${fx.storeId}::uuid, ${handle}, 'txcd_10000000', ${kind}, ${delivery}, ${kind === "plan"}, ${skipCart}) returning id
    `);
    const [v] = await tx.execute<Row>(sql`
      insert into commerce.product_variants (store_id, product_id, sku, delivery)
      values (${fx.storeId}::uuid, ${String(p.id)}::uuid, ${handle.toUpperCase()}, ${delivery}) returning id
    `);
    await tx.execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'NO', ${price})`);
    await tx.execute(sql`insert into commerce.product_translations (store_id, product_id, locale, title) values (${fx.storeId}::uuid, ${String(p.id)}::uuid, 'nb-NO', ${handle})`);
    await tx.execute(sql`insert into commerce.product_media (store_id, product_id, url) values (${fx.storeId}::uuid, ${String(p.id)}::uuid, '/demo/lamp.webp')`);
    if (kind === "plan") {
      const [option] = await tx.execute<Row>(sql`
        insert into commerce.selling_plans (store_id, product_id, variant_id, interval, interval_count, discount_percent, trial_days)
        values (${fx.storeId}::uuid, ${String(p.id)}::uuid, ${String(v.id)}::uuid, 'month', 1, 0, 14) returning id
      `);
      planOption = String(option.id);
    }
    await tx.execute(sql`update commerce.products set status = 'active' where id = ${String(p.id)}::uuid`);
    return String(v.id);
  });
}

beforeAll(async () => {
  fx = await makeStore("skip-cart", { mode: "test" });
  await db().execute(sql`update commerce.stores set features = array_append(features, 'subscriptions') where id = ${fx.storeId}::uuid`);
  download = await product("skip-guide", "goods", "digital", 9900, null);
  needsCart = await product("skip-kept", "goods", "digital", 4900, false);
  planVariant = await product("skip-plan", "plan", "service", 14900, null);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const shop = () => ({ storeId: fx.storeId, market: no });
const emptyCart = () => jar.clear();
const press = async (shown: string[]) => startDirect((await getStore(fx.slug))!, no, origin, shown);
const cartId = async () => (await readCartId(shop()))!;

describe("Buy now past the cart page (D915)", () => {
  it("saves a product's choices in the editor and reads them back, so saving again keeps them", async () => {
    const [seeded] = await seedProducts(fx, 1, { prefix: "SKIPED" });
    const store = (await getStore(fx.slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, seeded.id))!;
    const saved = await saveProduct(store, editor, seeded.id, { ...input, zeroFree: false, skipCart: true });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const read = (await getProductForEdit(store, editor, seeded.id))!;
    expect([read.zeroFree, read.skipCart]).toEqual([false, true]);
    // Saved again as read (any other change), the choices stay.
    const again = await saveProduct(store, editor, seeded.id, read);
    if (!again.ok) throw new Error(again.problems.join(" "));
    const [row] = await db().execute<Row>(sql`select zero_free, skip_cart from commerce.products where id = ${seeded.id}::uuid`);
    expect([row.zero_free, row.skip_cart]).toEqual([false, true]);
  });

  it("saves the store's choice on Settings > Checkout, audited", async () => {
    expect(await storeSkipsCart(fx.storeId)).toBe(false);
    expect(await saveSkipCart(await ownerOf(fx), true)).toEqual({ ok: true });
    expect(await storeSkipsCart(fx.storeId)).toBe(true);
    const [audit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = 'store.skip_cart'`);
    expect(audit.n).toBe(1);
  });

  it("saves a category's choice, a product category's only, and reads it back", async () => {
    const owner = await ownerOf(fx);
    const scope = { storeId: fx.storeId, contentType: "product" as const };
    const made = await createTerm(owner.account, scope, { kind: "category", name: "Guides", slug: "skip-guides" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const saved = await updateTerm(owner.account, scope, made.id, { name: "Guides", slug: "skip-guides", parentId: null, skipCart: true });
    expect(saved.ok).toBe(true);
    expect((await listTerms(scope)).find((term) => term.id === made.id)?.skipCart).toBe(true);
    // Left out, it stays as it was.
    await updateTerm(owner.account, scope, made.id, { name: "Guider", slug: "skip-guides", parentId: null });
    expect((await listTerms(scope)).find((term) => term.id === made.id)?.skipCart).toBe(true);
  });

  it("goes past the cart only when every product in the basket does", async () => {
    emptyCart();
    await changeLine(shop(), download, 1, "add");
    expect(await cartSkips(fx.storeId, await cartId())).toBe(true);
    await changeLine(shop(), needsCart, 1, "add");
    expect(await cartSkips(fx.storeId, await cartId())).toBe(false);
  });

  it("opens the payment page only when the button said what the basket asks", async () => {
    emptyCart();
    await changeLine(shop(), download, 1, "add");
    // A download asks its withdrawal: a button that did not say it shows the cart, and no payment page is opened.
    const before = fake.created.length;
    expect(await press([])).toBeNull();
    expect(fake.created.length).toBe(before);
    const to = await press([m.digitalConsent]);
    // The payment page: Stripe's own, or the store's checkout page holding Stripe's form (D22).
    expect(to).toMatch(PAYMENT_PAGE);
    expect(fake.created.length).toBe(before + 1);
    // A product that needs the cart keeps it for the whole basket, whatever the button said.
    await changeLine(shop(), needsCart, 1, "add");
    expect(await press([m.digitalConsent])).toBeNull();
  });

  it("says a plan's renewals at the price the basket renews at", async () => {
    emptyCart();
    expect((await choosePlan(shop(), planVariant, planOption)).outcome).toBe("added");
    const said = (renewal: number) =>
      checkoutConsents(m, { digital: false, service: false, plan: { interval: "month", intervalCount: 1, trialDays: 14, minCycles: 0 }, renewal }, money).subscription!;
    expect(await press([said(9900)])).toBeNull();
    expect(await press([said(14900)])).toMatch(PAYMENT_PAGE);
  });
});
