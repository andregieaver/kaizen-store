import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { movedMarketSlug } from "@/lib/market-move";
import { featureOn } from "@/lib/store-features";

import { makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
// 'use cache' needs Next's cache outside a request: run the functions as they are.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const features = await import("./store-features");
const { getStore } = await import("./stores");
const { resolveShop, resolveAfterSaleShop, marketIn, offeredMarketIn } = await import("./shop");
const { changeLine, getCart, readCartId } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { placeOrder } = await import("./checkout");
const { listPublicStores } = await import("./seo");
const { setMarkets } = await import("./setup");
const { createDraft } = await import("./draft-orders");
const { saveCampaign, getCampaign } = await import("./campaigns");
const { staffActor } = await import("./order-actor");

type Row = Record<string, unknown>;

/**
 * Store features, step 4 (D178, docs/store-features.md 4d): the Countries and languages group. A new store sells in its own country, in its
 * own language and currency; Several countries, languages and currencies each add what they say. Off, the other countries, languages and
 * currencies are not offered (`resolveShop()`), their addresses move to one that is (`movedMarketSlug()`), and carts and checkouts in them are
 * refused by the database's own rule (`commerce.market_offered()`); what a shopper already bought still opens in its own country, language and
 * currency (`resolveAfterSaleShop()`). Nothing is deleted: markets stay active, the store's languages and currencies and their rates stay,
 * and switching back on brings each back. The money of the cart and the order agreeing is held in `checkout-kinds.int.test.ts`.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const owner = () => membershipOf(store.slug, store.account, "owner");
type World = "countries" | "languages" | "currencies";
const switchFeature = async (id: World, on: boolean) => {
  const result = await features.setFeature(await owner(), id, on, { confirmed: true });
  expect(result, `${id} ${on ? "on" : "off"}`).toMatchObject({ ok: true });
};
const fresh = async () => (await getStore(store.slug))!;
const variant: Record<string, string> = {};
/** What the database keeps of the store's countries, languages and currencies: a switch must never change it. */
const kept = async () => {
  const [row] = await db().execute<Row>(sql`
    select s.locales,
      (select array_agg(m.code || ':' || m.active order by m.code) from commerce.markets m where m.store_id = s.id) as markets,
      (select array_agg(c.currency || ':' || coalesce(c.rate::text, '-') order by c.currency) from commerce.store_currencies c where c.store_id = s.id) as currencies
    from commerce.stores s where s.id = ${store.id}::uuid
  `);
  return row;
};

beforeAll(async () => {
  store = await makeStore("world");
  // Norway's own store, also offering English and euro, and Swedish kronor at a rate (D109).
  await db().execute(sql`update commerce.stores set country = 'NO', locales = array['nb-NO', 'en-GB'] where id = ${store.id}::uuid`);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${store.id}::uuid, 'NOK', 11.5, 1, 0), (${store.id}::uuid, 'SEK', 11, 1, 1), (${store.id}::uuid, 'EUR', 1, 1, 2)
  `);
  const rows = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${store.id}::uuid`);
  for (const row of rows) variant[String(row.sku)] = String(row.id);
});
afterAll(async () => {
  await closeDb();
});

describe("a new store's countries, languages and currencies (D178)", () => {
  it("sells in its own country alone, in its own language and currency, and keeps the template's other countries", async () => {
    const s = await fresh();
    expect(s.features).toEqual(["shop"]);
    expect(s.markets.map((m) => m.code)).toEqual(["NO"]);
    // The template's countries are copied in its order, its own first, so a store with no country of its own yet is Norway's too.
    expect(s.keptMarkets.map((m) => m.code)).toEqual(["NO", "DK", "SE"]);
    expect(s.localization.locales).toEqual(["nb-NO"]);
    expect(s.localization.keptLocales).toEqual(["nb-NO", "en-GB", "da-DK", "sv-SE"]);
    expect(s.localization.currencies.map((c) => c.currency)).toEqual(["NOK"]);
    // The rates stay for the analytics of what was sold before.
    expect(s.localization.rates.get("EUR")?.rate).toBe(1);
    expect(await resolveShop(store.slug, "no")).not.toBeNull();
    for (const slug of ["se", "dk", "no-en", "no-eur", "no-sek", "se-en-eur"]) expect(await resolveShop(store.slug, slug), slug).toBeNull();
    // The public list (sitemap, llms.txt) has one country in one language.
    const listed = (await listPublicStores()).find((p) => p.slug === store.slug)!;
    expect(listed.markets.map((m) => m.code)).toEqual(["NO"]);
    expect(listed.languageChoice).toBe(false);
  });

  it("moves an address it does not offer to one it does, for good, and never in a loop", async () => {
    const s = await fresh();
    expect(movedMarketSlug(s, "se")).toBe("no");
    expect(movedMarketSlug(s, "se-en-eur")).toBe("no");
    expect(movedMarketSlug(s, "no-en")).toBe("no");
    expect(movedMarketSlug(s, "no-eur")).toBe("no");
    // A country the store never had stays the 404 it was.
    expect(movedMarketSlug(s, "fi")).toBeNull();
    expect(movedMarketSlug(s, "no")).toBeNull();
  });

  it("offers each with its feature on, and switching back off restores exactly what was offered, deleting nothing", async () => {
    const before = await kept();
    await switchFeature("countries", true);
    let s = await fresh();
    expect(s.markets.map((m) => m.code)).toEqual(["NO", "DK", "SE"]);
    expect(await resolveShop(store.slug, "se")).not.toBeNull();
    // A country is still shown in its own language and currency only.
    expect(await resolveShop(store.slug, "se-en")).toBeNull();
    expect(await resolveShop(store.slug, "no-eur")).toBeNull();
    // NO and SE are offered: each in its own currency (Several currencies is off), no Norwegian shopper sees kronor of Sweden.
    expect(s.localization.currencyChoice).toBe(false);

    await switchFeature("languages", true);
    s = await fresh();
    expect(s.localization.locales).toEqual(["nb-NO", "en-GB", "da-DK", "sv-SE"]);
    expect(await resolveShop(store.slug, "se-en")).not.toBeNull();

    await switchFeature("currencies", true);
    expect(await resolveShop(store.slug, "no-eur")).not.toBeNull();
    expect(await resolveShop(store.slug, "se-en-eur")).not.toBeNull();
    // Several countries and currencies: a Norwegian shopper may also see Swedish kronor (D109).
    expect(await resolveShop(store.slug, "no-sek")).not.toBeNull();

    for (const id of ["currencies", "languages", "countries"] as const) await switchFeature(id, false);
    expect(await kept()).toEqual(before);
    s = await fresh();
    expect(s.markets.map((m) => m.code)).toEqual(["NO"]);
    expect(s.features).toEqual(["shop"]);
  });

  it("refuses a cart and a checkout in a country or currency no longer offered, and keeps the home country's", async () => {
    await switchFeature("countries", true);
    await switchFeature("currencies", true);
    const s = await fresh();
    const se = { storeId: s.id, market: s.markets.find((m) => m.code === "SE")! };
    const euro = { storeId: s.id, market: (await resolveShop(store.slug, "no-eur"))!.market };
    const no = { storeId: s.id, market: s.markets[0] };
    expect(await changeLine(se, variant["DEMO-MUG-BLACK"], 1, "add")).toMatchObject({ outcome: "added" });
    expect(await changeLine(euro, variant["DEMO-MUG-BLACK"], 1, "add")).toMatchObject({ outcome: "added" });
    expect((await getCart(se)).lines[0].status).toBe("ok");

    await switchFeature("countries", false);
    await switchFeature("currencies", false);
    // Sweden's cart is kept, unavailable: nothing can be added to it, and it cannot be ordered.
    expect((await getCart(se)).lines.map((l) => l.status)).toEqual(["unavailable"]);
    expect(await changeLine(se, variant["DEMO-MUG-WHITE"], 1, "add")).toMatchObject({ outcome: "unavailable" });
    expect(await placeOrder(se, (await readCartId(se))!)).toEqual({ ok: false, problem: "unavailable" });
    // The cart shows nothing to pay, as the order refuses it.
    expect(await cartSummary(se, await getCart(se))).toMatchObject({ payable: [], subtotal: 0 });
    // The euro view of Norway: the same cart (a cart is the country's) refused in euro, and fine in kroner.
    expect((await getCart(euro)).lines.map((l) => l.status)).toEqual(["unavailable"]);
    expect(await placeOrder(euro, (await readCartId(euro))!)).toEqual({ ok: false, problem: "unavailable" });
    expect((await getCart(no)).lines.map((l) => l.status)).toEqual(["ok"]);

    // Switching back makes them whole again.
    await switchFeature("countries", true);
    expect((await getCart(se)).lines.map((l) => l.status)).toEqual(["ok"]);
    await switchFeature("countries", false);
  });

  it("opens what a shopper bought in a country, language or currency no longer offered, as it was bought", async () => {
    const s = await fresh();
    expect(featureOn(s, "countries")).toBe(false);
    const se = await resolveAfterSaleShop(store.slug, "se");
    expect(se?.market).toMatchObject({ code: "SE", currency: "SEK", lang: "sv" });
    const enEur = await resolveAfterSaleShop(store.slug, "se-en-eur");
    expect(enEur?.market).toMatchObject({ code: "SE", currency: "EUR", lang: "en" });
    // A country taken off the store's list (inactive) too.
    await db().execute(sql`update commerce.markets set active = false where store_id = ${store.id}::uuid and code = 'DK'`);
    try {
      expect((await resolveAfterSaleShop(store.slug, "dk"))?.market.code).toBe("DK");
      expect(movedMarketSlug(await fresh(), "dk")).toBe("no");
    } finally {
      await db().execute(sql`update commerce.markets set active = true where store_id = ${store.id}::uuid and code = 'DK'`);
    }
    // A country the store never had is no shop at all.
    expect(await resolveAfterSaleShop(store.slug, "fi")).toBeNull();
    // The parts of an after-sale page find it; what sells (WordPress) does not.
    expect(marketIn(s, "se")?.code).toBe("SE");
    expect(offeredMarketIn(s, "se")).toBeUndefined();
  });

  it("makes no draft order in a country, language or currency no longer offered", async () => {
    const actor = staffActor(store.account.id);
    for (const slug of ["se", "no-en", "no-eur"]) expect(await createDraft(store.id, actor, { marketSlug: slug }), slug).toEqual({ ok: false, problem: "market" });
    const home = await createDraft(store.id, actor);
    expect(home).toMatchObject({ ok: true, draft: { marketSlug: "no" } });
    await switchFeature("countries", true);
    expect(await createDraft(store.id, actor, { marketSlug: "se" })).toMatchObject({ ok: true });
    await switchFeature("countries", false);
  });

  it("keeps what a campaign says of a country not offered when it is edited, and refuses a new one there", async () => {
    await switchFeature("countries", true);
    const made = await saveCampaign(await owner(), null, {
      name: `Sweden ${run}`, kind: "percent", percent: 10, scope: "all", productIds: [], termIds: [], tierIds: [], markets: ["SE"], stacks: false,
      startsAt: null, endsAt: null, active: true, thresholds: {}, giftVariantId: null, giftQuantity: 1, buyQuantity: 2, payQuantity: 1, usageLimit: null, perCustomerLimit: null,
    });
    expect(made, JSON.stringify(made)).toMatchObject({ ok: true });
    await switchFeature("countries", false);
    const campaign = (await getCampaign(store.id, made.id!))!;
    const again = await saveCampaign(await owner(), campaign.id, {
      name: `Sweden ${run} renamed`, kind: "percent", percent: 10, scope: "all", productIds: [], termIds: [], tierIds: [], markets: ["SE"], stacks: false,
      startsAt: null, endsAt: null, active: true, thresholds: {}, giftVariantId: null, giftQuantity: 1, buyQuantity: 2, payQuantity: 1, usageLimit: null, perCustomerLimit: null,
    });
    expect(again).toMatchObject({ ok: true });
    expect((await getCampaign(store.id, campaign.id))!.markets).toEqual(["SE"]);
    const denmark = await saveCampaign(await owner(), null, {
      name: `Denmark ${run}`, kind: "percent", percent: 10, scope: "all", productIds: [], termIds: [], tierIds: [], markets: ["DK"], stacks: false,
      startsAt: null, endsAt: null, active: true, thresholds: {}, giftVariantId: null, giftQuantity: 1, buyQuantity: 2, payQuantity: 1, usageLimit: null, perCustomerLimit: null,
    });
    expect(denmark).toMatchObject({ ok: false, problems: [expect.stringContaining("does not sell to DK")] });
  });

  it("lets the Countries page choose one country with the feature off, keeping the others when it is the one already sold in", async () => {
    const before = await kept();
    expect(await setMarkets(await owner(), ["NO", "SE"])).toMatchObject({ ok: false, problems: [expect.stringContaining("Several countries is switched off")] });
    expect(await setMarkets(await owner(), ["NO"])).toEqual({ ok: true, note: "Nothing changed." });
    expect(await kept()).toEqual(before);
  });
});

describe("switching Several countries off (D178)", () => {
  let other: Awaited<ReturnType<typeof makeStore>>;
  beforeAll(async () => {
    other = await makeStore("world-blocked");
    await db().execute(sql`update commerce.stores set country = 'NO', features = features || array['countries'] where id = ${other.id}::uuid`);
  });

  it("is refused while goods paid for in another country are still to send, and warns of open carts there", async () => {
    const [v] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${other.id}::uuid and sku = 'DEMO-MUG-BLACK'`);
    const [o] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
      values (${other.id}::uuid, ${`W-${run}`}, 'SE', 'SEK', 'sv-SE', ${`w-${run}@example.com`}, 'paid', 24900, 0, 0, 4980, 24900, '{"name":"A"}'::jsonb,
        '{"name":"A","line1":"G 1","postalCode":"11151","city":"Stockholm","country":"SE"}'::jsonb)
      returning id
    `);
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${other.id}::uuid, ${String(o.id)}::uuid, ${String(v.id)}::uuid, 'DEMO-MUG-BLACK', 'Kopp', 1, 24900, 24900, 4980, 0.25, 'txcd_99999999', 'physical')
    `);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status, test_mode)
      values (${other.id}::uuid, ${String(o.id)}::uuid, 'stripe', ${`pi_w_${run}`}, 24900, 0, 'SEK', 'captured', false)
    `);
    const s = (await getStore(other.slug))!;
    const se = { storeId: s.id, market: s.markets.find((m) => m.code === "SE")! };
    jar.clear();
    expect(await changeLine(se, String(v.id), 1, "add")).toMatchObject({ outcome: "added" });

    const facts = await features.featureFacts(other.id);
    expect(facts).toMatchObject({ foreignUnsent: 1, foreignCarts: 1, otherCountries: 2 });
    const member = await membershipOf(other.slug, other.account, "owner");
    const refused = await features.setFeature(member, "countries", false, { confirmed: true });
    expect(refused).toMatchObject({ ok: false, blockers: [{ path: "/orders", text: expect.stringContaining("1 paid order has goods still to send to another country") }] });
    expect(refused.ok === false && refused.warnings).toEqual(expect.arrayContaining([expect.stringContaining("1 open cart is in another country")]));
    expect(featureOn((await getStore(other.slug))!, "countries")).toBe(true);
  });
});
