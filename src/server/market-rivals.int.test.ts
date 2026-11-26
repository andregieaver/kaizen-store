import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { RIVALS_PER_MARKET } from "@/lib/market-rivals";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const rivals = await import("./market-rivals");
const { marketCheck } = await import("./market-check");
const { listRivalsTool, readRivalOfferTool } = await import("./market-check-tool");
const { getStore } = await import("./stores");
const { customPeriod } = await import("@/lib/analytics-period");
const { platformPricingFacts } = await import("./price-tuning");

type Row = Record<string, unknown>;
type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;
type Fetched = import("./replicate-fetch").Fetched;

/**
 * A store's rivals (D900 M2) against the database: a rival the owner adds, refused in each way the rules say; a rival's product page read
 * through a stand-in (robots.txt missing, the page's JSON-LD only), held against the store's own price in Norway; the finding it makes; and
 * the AI manager's two tools. Prices in NOK minor units, VAT included as shoppers see them.
 */

const run = Date.now().toString(36);
let store: Store;
let account: { id: string };
let rival: Awaited<ReturnType<typeof rivals.addRival>>;
const actor = () => ({ account, store });

const offerPage = (price: string, name = "Linen apron", availability = "InStock") =>
  `<html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    offers: { "@type": "Offer", price, priceCurrency: "NOK", availability: `https://schema.org/${availability}`, hasMerchantReturnPolicy: { merchantReturnDays: 30 } },
  })}</script></head><body><p>Only 9 kr!</p></body></html>`;

/** A site whose robots.txt is missing (404) and whose pages are the ones given. */
const site = (pages: Record<string, string>) =>
  (async (url: string): Promise<Fetched> => {
    const body = pages[new URL(url).pathname];
    return body === undefined ? { ok: false, problem: "The site answered 404.", status: 404 } : { ok: true, url, status: 200, contentType: "text/html", bytes: new TextEncoder().encode(body) };
  }) as never;

beforeAll(async () => {
  const slug = `rivals-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null)`);
  store = (await getStore(slug))!;
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
  account = { id: String(owner.account_id) };
  // The store's own apron, on sale in Norway at 460 kr.
  const [p] = await db().transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    return tx.execute<Row>(sql`insert into commerce.products (store_id, handle, tax_code, kind, status) values (${store.id}::uuid, 'apron', 'txcd_99999999', 'goods', 'active') returning id`);
  });
  const [v] = await db().execute<Row>(sql`insert into commerce.product_variants (store_id, product_id, sku, delivery) values (${store.id}::uuid, ${String(p.id)}::uuid, ${`APRON-${run}`}, 'physical') returning id`);
  await db().execute(sql`insert into commerce.product_translations (store_id, product_id, locale, title) values (${store.id}::uuid, ${String(p.id)}::uuid, 'nb-NO', 'Forkle i lin')`);
  await db().execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'NO', 46000)`);
});

afterAll(async () => {
  await closeDb();
});

describe("a store's rivals (D900 M2)", () => {
  it("are added by the owner in one of the store's countries, by name and web host, and refused otherwise", async () => {
    rival = await rivals.addRival(actor(), { market: "no", name: "  Linnet  ", address: "https://www.Linnet.example/om-oss" });
    expect(rival).toMatchObject({ market: "NO", name: "Linnet", host: "linnet.example" });
    const refused = async (input: { market: string; name: string; address: string }) => {
      try {
        await rivals.addRival(actor(), input);
        return null;
      } catch (error) {
        return error instanceof rivals.RivalError ? error.problem : String(error);
      }
    };
    expect(await refused({ market: "NO", name: "Linnet again", address: "linnet.example" })).toBe("exists");
    expect(await refused({ market: "DE", name: "Elsewhere", address: "elsewhere.example" })).toBe("market");
    expect(await refused({ market: "NO", name: "", address: "x.example" })).toBe("name");
    expect(await refused({ market: "NO", name: "No host", address: "not a site" })).toBe("host");
    for (let i = 1; i < RIVALS_PER_MARKET; i++) await rivals.addRival(actor(), { market: "NO", name: `Shop ${i}`, address: `shop${i}.example` });
    expect(await refused({ market: "NO", name: "One too many", address: "toomany.example" })).toBe("full");
    const [entry] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.id}::uuid and action = 'analytics.rival_added' limit 1`);
    expect(entry).toMatchObject({ action: "analytics.rival_added" });
  });

  it("keep an offer read from a rival's own product page, held against the store's price there", async () => {
    const page = "https://www.linnet.example/p/linen-apron";
    const read = await rivals.readRivalOffer(actor(), { rival: "Linnet", page, product: "apron" }, { fetchPage: site({ "/p/linen-apron": offerPage("400.00") }) });
    expect(read.offer).toMatchObject({ name: "Linen apron", priceMinor: 40000, currency: "NOK", returnDays: 30 });
    const [offer] = await rivals.rivalOffers(store, "nb-NO");
    expect(offer).toMatchObject({ rivalName: "Linnet", market: "NO", address: page, productName: "Forkle i lin", priceMinor: 40000, own: { priceMinor: 46000, currency: "NOK" } });
    // Read again at a new price: the one row is replaced, and the product it is held against kept.
    await rivals.readRivalOffer(actor(), { rival: "linnet.example", page }, { fetchPage: site({ "/p/linen-apron": offerPage("420.00") }) });
    const again = await rivals.rivalOffers(store, "nb-NO");
    expect(again.map((o) => [o.priceMinor, o.productName])).toEqual([[42000, "Forkle i lin"]]);
    // The read that changed the price keeps what it was (D900 M3).
    expect(again[0].previous).toMatchObject({ priceMinor: 40000, currency: "NOK", availability: "in_stock", returnDays: 30 });
    expect(again[0].changedAt).toBe(again[0].readAt);
  });

  it("refuse a page off the rival's site, one with no offer data, and a product the store does not have", async () => {
    const problem = async (input: { rival: string; page: string; product?: string }, pages: Record<string, string> = {}) => {
      try {
        await rivals.readRivalOffer(actor(), input, { fetchPage: site(pages) });
        return null;
      } catch (error) {
        return error instanceof rivals.RivalError ? error.problem : String(error);
      }
    };
    expect(await problem({ rival: "Linnet", page: "https://elsewhere.example/p/apron" })).toBe("site");
    expect(await problem({ rival: "Nobody", page: "https://linnet.example/p/apron" })).toBe("rival");
    expect(await problem({ rival: "Linnet", page: "https://linnet.example/p/apron", product: "no-such-handle" })).toBe("product");
    expect(await problem({ rival: "Linnet", page: "https://linnet.example/p/plain" }, { "/p/plain": "<html><body>Apron 9 kr</body></html>" })).toBe("no_offer");
  });

  it("make a finding when a rival is a tenth cheaper, and are left out for Kaizena Flow's own store", async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    // At 420 kr against 460 kr the store is 9.5 % dearer: under the tenth, so no finding.
    const under = await marketCheck(store, customPeriod(today, today), { now });
    expect(under.rivals).toHaveLength(RIVALS_PER_MARKET);
    expect(under.findings.filter((f) => f.kind === "rival_cheaper")).toEqual([]);
    await rivals.readRivalOffer(actor(), { rival: "Linnet", page: "https://www.linnet.example/p/linen-apron" }, { fetchPage: site({ "/p/linen-apron": offerPage("400.00") }) });
    const check = await marketCheck(store, customPeriod(today, today), { now });
    expect(check.findings.find((f) => f.kind === "rival_cheaper")).toMatchObject({ rivalName: "Linnet", productName: "Forkle i lin", ownMinor: 46000, rivalMinor: 40000 });
    // Another rival out of stock on its match for the apron: a gap it leaves, an opportunity in the SWOT.
    await rivals.readRivalOffer(actor(), { rival: "shop1.example", page: "https://shop1.example/p/apron", product: "apron" }, {
      fetchPage: site({ "/p/apron": offerPage("390.00", "Apron", "OutOfStock") }),
    });
    const gaps = (await marketCheck(store, customPeriod(today, today), { now })).findings.filter((f) => f.kind === "rival_out");
    expect(gaps).toEqual([{ kind: "rival_out", market: "NO", productName: "Forkle i lin", rivalName: "Shop 1", ownMinor: 46000, currency: "NOK" }]);
    const house = await marketCheck({ ...store, house: true }, customPeriod(today, today), { now });
    expect([house.rivals, house.offers, house.findings.filter((f) => f.kind === "rival_cheaper")]).toEqual([[], [], []]);
  });

  it("are read and checked by the AI manager's tools, every figure written by code", async () => {
    const listed = await listRivalsTool({ store } as never);
    const linnet = listed.rivals.find((r) => r.host === "linnet.example");
    expect(linnet?.offers[0]).toMatchObject({ their_product: "Linen apron", your_product: "Forkle i lin", difference: "the store is 15 % dearer", old: false });
    await expect(readRivalOfferTool({ account, store } as never, { rival: "Nobody", page: "https://x.example/p" })).rejects.toThrow("no such rival");
  });

  it("are read again by the watcher before they go old, keeping what moved, and a page that cannot be read waits (D900 M3)", async () => {
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.id}::uuid`);
    const page = "https://www.linnet.example/p/linen-apron";
    // Nothing is due while every offer is fresh.
    expect(await rivals.watchRivals({ fetchPage: site({}) })).toMatchObject({ read: 0, changed: 0, failed: 0 });
    await db().execute(sql`update commerce.rival_offers set read_at = now() - interval '40 days' where store_id = ${store.id}::uuid`);
    const run = await rivals.watchRivals({ fetchPage: site({ "/p/linen-apron": offerPage("380.00") }), perRun: 5 });
    // Linnet's page is read and its cut kept; Shop 1's page is gone, so it waits and goes old.
    expect(run).toMatchObject({ read: 1, changed: 1, failed: 1 });
    const linnet = (await rivals.rivalOffers(store, "nb-NO")).find((o) => o.address === page);
    expect(linnet).toMatchObject({ priceMinor: 38000, previous: { priceMinor: 40000 } });
    // The watcher just tried every due page: none is tried again within RIVAL_RETRY_DAYS, whatever it found.
    expect(await rivals.watchRivals({ fetchPage: site({ "/p/linen-apron": offerPage("380.00") }), perRun: 5 })).toMatchObject({ read: 0, changed: 0, failed: 0 });
    // A month on, read again unchanged: kept fresh, the change and what it was left as they were.
    await db().execute(sql`update commerce.rival_offers set read_at = now() - interval '40 days', watched_at = now() - interval '8 days' where store_id = ${store.id}::uuid and address = ${page}`);
    expect(await rivals.watchRivals({ fetchPage: site({ "/p/linen-apron": offerPage("380.00") }), perRun: 5 })).toMatchObject({ read: 1, changed: 0, failed: 0 });
    const kept = (await rivals.rivalOffers(store, "nb-NO")).find((o) => o.address === page);
    expect(kept).toMatchObject({ priceMinor: 38000, previous: { priceMinor: 40000 }, changedAt: linnet?.changedAt });
    // The finding: a rival's cut is a threat in the SWOT.
    const today = new Date().toISOString().slice(0, 10);
    const check = await marketCheck(store, customPeriod(today, today), { now: new Date() });
    expect(check.findings.find((f) => f.kind === "rival_move")).toMatchObject({ rivalName: "Linnet", move: "price", before: 40000, after: 38000 });
  });

  it("are removed with their offers", async () => {
    expect(await rivals.removeRival(actor(), rival.id)).toBe(true);
    expect(await rivals.removeRival(actor(), rival.id)).toBe(false);
    expect(await rivals.removeRival(actor(), "not-an-id")).toBe(false);
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.rival_offers where store_id = ${store.id}::uuid and rival_id = ${rival.id}::uuid`);
    expect(left.n).toBe(0);
  });
});

/**
 * Other store platforms' prices (D900 M4): kept by a platform admin from a platform's own pricing page (a stand-in site), checked there by
 * code when kept and by the watcher after, held against one of Kaizena Flow's plans, and in the platform manager's pricing facts.
 */
describe("other store platforms' prices (D900 M4)", () => {
  const pricing = (text: string) => `<html><head><title>Pricing</title></head><body><main><h1>Plans</h1><p>${text}</p></main></body></html>`;
  let planId = "";
  let admin = { id: "" };

  beforeAll(async () => {
    const [plan] = await db().execute<Row>(sql`insert into commerce.plans (name, position) values (${`Starter ${run}`}, 99) returning id`);
    planId = String(plan.id);
    await db().execute(sql`insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${planId}::uuid, 'EUR', 'month', 3900)`);
    admin = account;
  });

  afterAll(async () => {
    await db().execute(sql`delete from commerce.platform_rival_prices where plan_id = ${planId}::uuid or platform like ${`%${run}%`}`);
    await db().execute(sql`delete from commerce.plan_prices where plan_id = ${planId}::uuid`);
    await db().execute(sql`delete from commerce.plans where id = ${planId}::uuid`);
  });

  it("are kept with whether code found the price on its page, and refused when a field is wrong", async () => {
    const platform = `Shopify ${run}`;
    const input = { platform, plan: "Basic", price: "29", currency: "EUR", interval: "month", fee: "2", ours: planId, source: "https://www.shop.example/pricing" };
    const found = await rivals.keepPlatformRivalPrice(admin, input, { fetchPage: site({ "/pricing": pricing("Basic €29 per month, billed yearly") }) });
    expect(found.onPage).toBe(true);
    const listed = (await rivals.listPlatformRivalPrices()).find((r) => r.platform === platform);
    expect(listed).toMatchObject({ plan: "Basic", priceMinor: 2900, currency: "EUR", interval: "month", feeBps: 200, planName: `Starter ${run}`, oursMinor: 3900, onPage: true, goneAt: null });
    // Kept again in place: a figure not on its page is kept unconfirmed; a page that cannot be read leaves it unread.
    expect((await rivals.keepPlatformRivalPrice(admin, { ...input, price: "31" }, { fetchPage: site({ "/pricing": pricing("Basic €29 per month") }) })).onPage).toBe(false);
    expect((await rivals.keepPlatformRivalPrice(admin, input, { fetchPage: site({}) })).onPage).toBeNull();
    expect((await rivals.listPlatformRivalPrices()).filter((r) => r.platform === platform)).toHaveLength(1);
    const refused = async (over: Partial<typeof input>) => {
      try {
        await rivals.keepPlatformRivalPrice(admin, { ...input, ...over }, { fetchPage: site({}) });
        return null;
      } catch (error) {
        return error instanceof rivals.PlatformRivalError ? error.problem : String(error);
      }
    };
    expect(await refused({ platform: " " })).toBe("platform");
    expect(await refused({ price: "twenty" })).toBe("price");
    expect(await refused({ currency: "XXX" })).toBe("price");
    expect(await refused({ interval: "week" })).toBe("interval");
    expect(await refused({ fee: "120" })).toBe("fee");
    expect(await refused({ source: "http://shop.example/pricing" })).toBe("source");
    expect(await refused({ ours: "11111111-1111-4111-8111-111111111111" })).toBe("ours");
  });

  it("are checked on their pages by the watcher: a price gone from its page is flagged for a person, never guessed", async () => {
    const platform = `Wix ${run}`;
    const input = { platform, plan: "Core", price: "36", currency: "EUR", interval: "month", fee: "", ours: planId, source: "https://wix.example/plans" };
    await rivals.keepPlatformRivalPrice(admin, input, { fetchPage: site({ "/plans": pricing("Core €36/month") }) });
    const age = () => db().execute(sql`update commerce.platform_rival_prices set checked_on = current_date - 40, watched_at = null where platform = ${platform}`);
    await age();
    // Still on its page: checked today.
    expect(await rivals.watchPlatformRivalPrices({ fetchPage: site({ "/plans": pricing("Core €36/month") }) })).toMatchObject({ checked: 1, gone: 0 });
    await age();
    // The page now shows another figure: flagged, the kept price left as it was.
    expect(await rivals.watchPlatformRivalPrices({ fetchPage: site({ "/plans": pricing("Core €39/month") }) })).toMatchObject({ gone: 1 });
    const flagged = (await rivals.listPlatformRivalPrices()).find((r) => r.platform === platform);
    expect(flagged).toMatchObject({ priceMinor: 3600, onPage: false });
    expect(flagged?.goneAt).not.toBeNull();
    // Kept again by a person: the flag goes.
    await rivals.keepPlatformRivalPrice(admin, { ...input, price: "39" }, { fetchPage: site({ "/plans": pricing("Core €39/month") }) });
    expect((await rivals.listPlatformRivalPrices()).find((r) => r.platform === platform)).toMatchObject({ priceMinor: 3900, onPage: true, goneAt: null });
  });

  it("stand in the platform manager's pricing facts as facts, every difference worked out by code", async () => {
    const facts = await platformPricingFacts({});
    const wix = facts.other_platforms.find((o) => o.platform === `Wix ${run}`);
    expect(wix).toMatchObject({ plan: "Core", held_against: `Starter ${run}`, difference: "the same", on_its_page: "yes", source: "https://wix.example/plans" });
    const shopify = facts.other_platforms.find((o) => o.platform === `Shopify ${run}`);
    expect(shopify?.difference).toBe("Kaizena Flow is 34 % dearer");
    expect(shopify?.on_its_page).toBe("its page could not be read");
    expect(facts.other_platforms_note).toContain("never on their own a reason for set_platform_price");
  });

  it("are removed by a platform admin", async () => {
    const [row] = (await rivals.listPlatformRivalPrices()).filter((r) => r.platform === `Wix ${run}`);
    expect(await rivals.removePlatformRivalPrice(admin, row.id)).toBe(true);
    expect(await rivals.removePlatformRivalPrice(admin, row.id)).toBe(false);
    expect(await rivals.removePlatformRivalPrice(admin, "not-an-id")).toBe(false);
  });
});

