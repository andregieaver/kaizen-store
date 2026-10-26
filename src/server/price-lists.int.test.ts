import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const lists = await import("./price-lists");

/**
 * Price lists (wave 6 unit C1, D321, `docs/wave-6-catalogue.md` C.1): the admin's writers keep to the store's own groups, companies, products,
 * categories and variants and to its markets' currencies; fixed prices are typed in the market's way and an empty one takes the price away; the
 * product page's reader gives a signed-in buyer their lowest list price below the market and nothing for a guest or another store's buyer.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherId: string;
const member = (id: string) => ({ account: { id: null, adminLocale: "en" }, store: { id } }) as unknown as Membership;

async function newStore(tag: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${tag}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${tag}-${run}`}, 'Test', null) as id`);
  return String(store.id);
}

const variantOf = async (store: string, sku: string) =>
  String((await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store}::uuid and sku = ${sku}`))[0].id);
const marketPrice = async (variant: string) =>
  Number((await db().execute<Row>(sql`select amount_minor from commerce.current_prices where variant_id = ${variant}::uuid and market_code = 'NO'`))[0].amount_minor);

beforeAll(async () => {
  storeId = await newStore("pl");
  otherId = await newStore("pl-other");
});

afterAll(async () => {
  await closeDb();
});

describe("price lists (D321)", () => {
  it("makes, renames and refuses a second list of the same name or a percentage out of range", async () => {
    const made = await lists.savePriceList(member(storeId), null, { name: "Retail", percent: 20, active: true });
    expect(made.ok).toBe(true);
    const again = await lists.savePriceList(member(storeId), null, { name: "retail", percent: null, active: true });
    expect(again).toEqual({ ok: false, problems: ["The store already has a price list called retail."] });
    const tooMuch = await lists.savePriceList(member(storeId), null, { name: "Big", percent: 100, active: true });
    expect(tooMuch.ok).toBe(false);
    // Another store may use the same name.
    expect((await lists.savePriceList(member(otherId), null, { name: "Retail", percent: 5, active: true })).ok).toBe(true);
    const id = made.ok ? made.id! : "";
    expect((await lists.savePriceList(member(storeId), id, { name: "Retailers", percent: 25, active: false })).ok).toBe(true);
    expect(await lists.getPriceList(storeId, id)).toMatchObject({ name: "Retailers", percent: 25, active: false });
    // Another store cannot change it.
    expect((await lists.savePriceList(member(otherId), id, { name: "Mine", percent: 1, active: true })).ok).toBe(false);
  });

  it("assigns and scopes only with the store's own rows, and prices a buyer through their group", async () => {
    const made = await lists.savePriceList(member(storeId), null, { name: `Group ${run}`, percent: 10, active: true });
    const id = made.ok ? made.id! : "";
    const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Wholesale', 5) returning id`);
    const [foreignTier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${otherId}::uuid, 'Wholesale', 5) returning id`);
    expect(await lists.setAssignments(member(storeId), id, { tierIds: [String(foreignTier.id)], companyIds: [] })).toEqual({
      ok: false,
      problems: ["Choose only the store's own groups, companies, products and categories."],
    });
    expect((await lists.setAssignments(member(storeId), id, { tierIds: [String(tier.id)], companyIds: [] })).ok).toBe(true);
    expect((await lists.listTargets(storeId, id)).tierIds).toEqual([String(tier.id)]);

    const mug = await variantOf(storeId, "DEMO-MUG-WHITE");
    const [{ id: customer }] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, tier_id) values (${storeId}::uuid, ${`buyer-${run}@example.com`}, ${String(tier.id)}::uuid) returning id
    `);
    const base = await marketPrice(mug);
    const priced = await lists.listPricesFor(storeId, String(customer), [mug], "NO");
    expect(priced.get(mug)).toEqual({ amountMinor: Math.floor((base * 90 + 50) / 100), listId: id });
    // A guest has none, and another store's reader finds nothing for this store's variant.
    expect((await lists.listPricesFor(storeId, null, [mug], "NO")).size).toBe(0);
    expect((await lists.listPricesFor(otherId, String(customer), [mug], "NO")).size).toBe(0);

    // A scope of another product leaves the mug at the market price.
    const [notebook] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-NOTEBOOK-LINED'`);
    const [foreignProduct] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${otherId}::uuid limit 1`);
    expect((await lists.setScope(member(storeId), id, { productIds: [String(foreignProduct.id)], termIds: [] })).ok).toBe(false);
    expect((await lists.setScope(member(storeId), id, { productIds: [String(notebook.product_id)], termIds: [] })).ok).toBe(true);
    expect((await lists.listPricesFor(storeId, String(customer), [mug], "NO")).size).toBe(0);

    // A fixed price wins where it is lower, typed the market's way; an empty amount takes it away.
    expect(await lists.setPrices(member(storeId), id, [{ variantId: mug, currency: "USD", amount: "10" }])).toEqual({
      ok: false,
      problems: ["USD is not the currency of any of the store's countries."],
    });
    expect((await lists.setPrices(member(storeId), id, [{ variantId: mug, currency: "NOK", amount: "abc" }])).ok).toBe(false);
    const foreignMug = await variantOf(otherId, "DEMO-MUG-WHITE");
    expect(await lists.setPrices(member(storeId), id, [{ variantId: foreignMug, currency: "NOK", amount: "10" }])).toEqual({
      ok: false,
      problems: ["A variant is not the store's own."],
    });
    expect((await lists.setPrices(member(storeId), id, [{ variantId: mug, currency: "NOK", amount: "99,50" }])).ok).toBe(true);
    expect(await lists.listPrices(storeId, id, "nb-NO")).toMatchObject([{ variantId: mug, currency: "NOK", amount: "99,50" }]);
    expect((await lists.listPricesFor(storeId, String(customer), [mug], "NO")).get(mug)).toEqual({ amountMinor: 9950, listId: id });
    // A fixed price above the market price gives nothing.
    expect((await lists.setPrices(member(storeId), id, [{ variantId: mug, currency: "NOK", amount: String(base / 100 + 1) }])).ok).toBe(true);
    expect((await lists.listPricesFor(storeId, String(customer), [mug], "NO")).size).toBe(0);
    expect((await lists.setPrices(member(storeId), id, [{ variantId: mug, currency: "NOK", amount: "" }])).ok).toBe(true);
    expect(await lists.listPrices(storeId, id, "nb-NO")).toEqual([]);

    // The AI manager's tool names who it is for, never a buyer's price.
    const told = await lists.listPriceListsTool({ store: { id: storeId, slug: "pl" } });
    expect(told.price_lists.find((l) => l.id === id)).toMatchObject({ percent_off: 10, customer_groups: ["Wholesale"], companies: [], fixed_prices: 0 });

    // Deleting takes its prices and assignments with it.
    expect((await lists.deletePriceList(member(storeId), id)).ok).toBe(true);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.price_list_assignments where list_id = ${id}::uuid`);
    expect(n).toBe(0);
  });
});

describe("a price list's prices by quantity and rules (D323 E3)", () => {
  it("writes breaks and rules as typed, refuses what does not fit, and reads them back", async () => {
    const made = await lists.savePriceList(member(storeId), null, { name: `Volume ${run}`, percent: null, active: true });
    const listId = made.ok ? made.id! : "";
    const mug = await variantOf(storeId, "DEMO-MUG-WHITE");
    const foreign = await variantOf(otherId, "DEMO-MUG-WHITE");
    expect(
      await lists.setListBreaks(member(storeId), listId, [
        { variantId: mug, from: 10, percent: 20, prices: {} },
        { variantId: mug, from: 50, percent: null, prices: { NOK: "70,00" } },
      ]),
    ).toEqual({ ok: true });
    expect((await lists.listBreaks(storeId, listId, "nb-NO")).map((b) => ({ from: b.from, percent: b.percent, prices: b.prices }))).toEqual([
      { from: 10, percent: 20, prices: {} },
      { from: 50, percent: null, prices: { NOK: "70,00" } },
    ]);
    // Refused whole: no price, both kinds, twice at one quantity, another store's variant, a currency the store has not.
    for (const rows of [
      [{ variantId: mug, from: 10, percent: null, prices: {} }],
      [{ variantId: mug, from: 10, percent: 10, prices: { NOK: "1,00" } }],
      [{ variantId: mug, from: 10, percent: 10, prices: {} }, { variantId: mug, from: 10, percent: 5, prices: {} }],
      [{ variantId: foreign, from: 10, percent: 10, prices: {} }],
      [{ variantId: mug, from: 10, percent: null, prices: { JPY: "100" } }],
    ]) {
      expect((await lists.setListBreaks(member(storeId), listId, rows)).ok).toBe(false);
    }
    expect(await lists.listBreaks(storeId, listId, "nb-NO")).toHaveLength(2);

    expect(await lists.setListRules(member(storeId), listId, [{ variantId: mug, min: null, max: 120, step: 12 }])).toEqual({ ok: true });
    expect((await lists.listRules(storeId, listId, "nb-NO"))[0].rule).toEqual({ min: 12, max: 120, step: 12 });
    expect((await lists.setListRules(member(storeId), listId, [{ variantId: mug, min: 10, max: null, step: 12 }])).ok).toBe(false);
    expect(await lists.setListRules(member(storeId), listId, [{ variantId: mug, min: null, max: null, step: null }])).toEqual({ ok: true });
    expect(await lists.listRules(storeId, listId, "nb-NO")).toEqual([]);
    expect((await lists.deletePriceList(member(storeId), listId)).ok).toBe(true);
  });
});
