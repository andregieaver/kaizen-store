import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { seedProducts } from "./data-test-support";
import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { deriveForProducts, marketPriceRules, removeMarketPriceRule, saveMarketPriceRule } = await import("./market-prices");
const { preflightOwnerTool, runOwnerTool } = await import("./owner-tools");

type Row = Record<string, unknown>;

/**
 * Market price rules (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2): a country's prices worked out from another's, written through
 * `commerce.set_price` and marked as the rule's; a price typed by hand there is kept; a base price saved again derives again (the old price closed,
 * so the 30-day reference stays genuine); rules never chain; taking a rule away keeps its prices as the owner's own; and no store reaches another's.
 */

let fx: Fixture;
let other: Fixture;
let products: { id: string; handle: string; skus: string[] }[];

beforeAll(async () => {
  fx = await makeStore("price-rules");
  other = await makeStore("price-rules-other");
  // The same rate for both crowns, so a price carries over one to one and the expected figures can be written out.
  for (const f of [fx, other]) {
    await db().execute(sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${f.storeId}::uuid, 'SEK', 11.5, 1, 2)
      on conflict (store_id, currency) do update set rate = 11.5
    `);
  }
  products = await seedProducts(fx, 2, { prefix: "RULE", variants: 2 });
  await seedProducts(other, 1, { prefix: "OTHER", variants: 1 });
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const storeOf = async (f: Fixture) => (await getStore(f.slug))!;

/** The current prices of a product's variants in a market: amount and whether the rule wrote it, by SKU. */
const pricesIn = async (market: string, productId: string) =>
  Object.fromEntries(
    (
      await db().execute<Row>(sql`
        select v.sku, c.amount_minor, c.derived from commerce.kept_prices c join commerce.product_variants v on v.id = c.variant_id
        where v.product_id = ${productId}::uuid and c.market_code = ${market}
      `)
    ).map((r) => [String(r.sku), { amount: Number(r.amount_minor), derived: Boolean(r.derived) }]),
  );

/** Saves a product's prices through the editor's own save: the Norwegian ones and, where given, the Swedish ones (an empty one follows the rule). */
async function savePrices(productId: string, no: Record<string, string>, se?: Record<string, string>) {
  const store = await storeOf(fx);
  const editor = await getEditorContext(store);
  const input = (await getProductForEdit(store, editor, productId))!;
  input.variants = input.variants.map((v) => ({ ...v, prices: { ...v.prices, NO: no[v.sku] ?? v.prices.NO, ...(se && v.sku in se ? { SE: se[v.sku] } : {}) } }));
  const saved = await saveProduct(store, editor, productId, input);
  expect(saved).toMatchObject({ ok: true });
}

const rule = { market: "SE", base: "NO", percentBps: 1_000, basis: "net" as const, roundToMinor: 1_000, endingMinor: 900 };

describe("a country's prices worked out from another's", () => {
  it("writes every price there from the base price: +10 %, up to the next price ending in 9 kr in steps of 10", async () => {
    const [a, b] = products[0].skus;
    await savePrices(products[0].id, { [a]: "100,00", [b]: "150,00" });
    const store = await storeOf(fx);
    expect(await saveMarketPriceRule(store, fx.ownerId, rule)).toMatchObject({ ok: true });
    // 100 × 1.10 = 110 → 119; 150 × 1.10 = 165 → 169.
    expect(await pricesIn("SE", products[0].id)).toEqual({ [a]: { amount: 11_900, derived: true }, [b]: { amount: 16_900, derived: true } });
    expect(await marketPriceRules(fx.storeId)).toEqual([rule]);
  });

  it("derives again when the base price is saved, closing the old price so the 30-day reference stays genuine", async () => {
    const [a] = products[0].skus;
    await savePrices(products[0].id, { [a]: "200,00" });
    expect((await pricesIn("SE", products[0].id))[a]).toEqual({ amount: 22_900, derived: true });
    const [history] = await db().execute<Row>(sql`
      select count(*)::int as n, min(amount_minor)::int as lowest from commerce.prices p join commerce.product_variants v on v.id = p.variant_id
      where v.store_id = ${fx.storeId}::uuid and v.sku = ${a} and p.market_code = 'SE'
    `);
    expect(history).toMatchObject({ n: 2, lowest: 11_900 });
    const [shown] = await db().execute<Row>(sql`
      select c.prior_30d_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = ${a} and c.market_code = 'SE'
    `);
    expect(Number(shown.prior_30d_minor)).toBe(11_900);
  });

  it("keeps a price typed by hand there, through a later base change, and follows the rule again when it is emptied", async () => {
    const [a, b] = products[0].skus;
    await savePrices(products[0].id, {}, { [b]: "149,00" });
    expect((await pricesIn("SE", products[0].id))[b]).toEqual({ amount: 14_900, derived: false });
    await savePrices(products[0].id, { [b]: "300,00" });
    expect((await pricesIn("SE", products[0].id))[b]).toEqual({ amount: 14_900, derived: false });
    expect((await pricesIn("SE", products[0].id))[a]).toEqual({ amount: 22_900, derived: true });
    // 300 × 1.10 = 330 → 339.
    await savePrices(products[0].id, {}, { [b]: "" });
    expect((await pricesIn("SE", products[0].id))[b]).toEqual({ amount: 33_900, derived: true });
  });

  it("is never chained: a country with a rule is no base, and a base has no rule of its own", async () => {
    const store = await storeOf(fx);
    expect(await saveMarketPriceRule(store, fx.ownerId, { ...rule, market: "DK", base: "SE" })).toMatchObject({ ok: false });
    expect(await saveMarketPriceRule(store, fx.ownerId, { ...rule, market: "NO", base: "DK" })).toMatchObject({ ok: false });
    await expect(
      db().execute(sql`
        insert into commerce.market_price_rules (store_id, market_code, base_market, percent_bps, basis, round_to_minor)
        values (${fx.storeId}::uuid, 'DK', 'SE', 0, 'net', 1)
      `),
    ).rejects.toThrow();
  });

  it("is refused for a currency with no rate, and keeps its prices when a rate is taken away", async () => {
    const store = await storeOf(fx);
    // Danish kroner have no rate in this store: no price could be worked out, so the rule is not kept.
    expect(await saveMarketPriceRule(store, fx.ownerId, { ...rule, market: "DK" })).toEqual({ ok: false, problem: expect.stringMatching(/^DKK has no rate /) });
    const before = await pricesIn("SE", products[0].id);
    await db().execute(sql`update commerce.store_currencies set rate = null where store_id = ${fx.storeId}::uuid and currency = 'SEK'`);
    try {
      expect(await deriveForProducts(db(), fx.storeId)).toEqual({ written: 0, ended: 0 });
      expect(await pricesIn("SE", products[0].id)).toEqual(before);
    } finally {
      await db().execute(sql`update commerce.store_currencies set rate = 11.5 where store_id = ${fx.storeId}::uuid and currency = 'SEK'`);
    }
  });

  it("never reaches another store's prices", async () => {
    const [a] = products[0].skus;
    const before = await pricesIn("SE", products[0].id);
    expect(await saveMarketPriceRule(await storeOf(other), other.ownerId, { ...rule, percentBps: 5_000 })).toMatchObject({ ok: true });
    expect(await pricesIn("SE", products[0].id)).toEqual(before);
    expect(before[a].amount).toBe(22_900);
  });

  it("keeps every price as it is, set by hand, when the rule is taken away", async () => {
    const [a] = products[0].skus;
    await removeMarketPriceRule(await storeOf(fx), fx.ownerId, "SE");
    expect(await marketPriceRules(fx.storeId)).toEqual([]);
    expect((await pricesIn("SE", products[0].id))[a]).toEqual({ amount: 22_900, derived: false });
    await savePrices(products[0].id, { [a]: "400,00" });
    expect((await pricesIn("SE", products[0].id))[a]).toEqual({ amount: 22_900, derived: false });
  });
});

describe("the AI manager's price rules", () => {
  it("reads each country's rule, refuses before a yes what the page refuses, and saves through the page's writer", async () => {
    const c = { ...(await ownerOf(fx)), invalidate: () => {} };
    await expect(preflightOwnerTool(c, "set_market_price_rule", { country: "SE", from: "SE" })).rejects.toThrow(/itself/);
    await expect(preflightOwnerTool(c, "set_market_price_rule", { country: "SE", from: null })).rejects.toThrow(/by hand/);
    await expect(preflightOwnerTool(c, "set_market_price_rule", { country: "SE", from: "NO", percent: 5, round_to: 10, ending: 9 })).resolves.toBeUndefined();
    const done = (await runOwnerTool(c, "set_market_price_rule", { country: "SE", from: "NO", percent: 5, round_to: 10, ending: 9 })) as { done: string };
    // Every Swedish price was kept as the owner's own when the last rule was taken away, so the new rule writes none of them.
    expect(done.done).toMatch(/Worked out from NO: \+5 %.* 0 prices written/);
    expect(await marketPriceRules(fx.storeId)).toEqual([{ ...rule, percentBps: 500 }]);
    const read = (await runOwnerTool(c, "market_price_rules", {})) as { countries: { country: string; prices: string; prices_by_rule: number }[] };
    const se = read.countries.find((x) => x.country === "SE")!;
    expect(se.prices).toMatch(/^Worked out from NO/);
    expect(se.prices_by_rule).toBe(0);
    expect(read.countries.find((x) => x.country === "NO")!.prices).toBe("Set by hand.");
  });
});
