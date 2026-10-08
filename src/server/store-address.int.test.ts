import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { forgetStoreAddresses, reservedChoiceSlugs, storeAddress } from "@/lib/store-address";
import { marketPath } from "@/lib/paths";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { getStore } = await import("./stores");
const { forgetStoreFacts, storeRequestAnswer } = await import("./redirect-resolve");
const { storeLlms, storeSitemap } = await import("./seo");

type Row = Record<string, unknown>;

/**
 * Addresses without a country (D181, `docs/marketless-addresses.md`): a new store sells in its own country alone, so its addresses have no
 * country, and the proxy's answers follow its features as `getStore()` reads them. Against the database: the store is made as the platform
 * makes one (`approve_access_request()`), from the template's catalogue.
 */

let slug: string;
let storeId: string;
let handle: string;

beforeAll(async () => {
  slug = `addr-${Date.now().toString(36)}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Adressebutikken') returning id
  `);
  const [made] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Adressebutikken', null) as id`);
  storeId = String(made.id);
  const [product] = await db().execute<Row>(sql`select handle from commerce.products where store_id = ${storeId}::uuid and status = 'active' order by handle limit 1`);
  handle = String(product.handle);
  forgetStoreAddresses();
});

afterAll(async () => {
  await closeDb();
});

const answer = (path: string, page = true) => storeRequestAnswer(path, "?a=1", null, page);

describe("a store that sells in its own country alone (a new store: the shop, nothing else)", () => {
  it("has no country in its addresses, as getStore() reads it, and links follow", async () => {
    const store = await getStore(slug);
    expect(store?.markets.map((m) => m.code)).toEqual(["NO"]);
    expect(store?.address).toMatchObject({ home: "no", marketless: true, languages: [], currencies: [] });
    expect(storeAddress(slug)?.marketless).toBe(true);
    expect(marketPath(slug, "no", "/home")).toBe(`/s/${slug}/home`);
    expect(marketPath(slug, "no")).toBe(`/s/${slug}`);
  });

  it("is served without its country by the proxy, and its old addresses move there for good", async () => {
    expect(await answer(`/s/${slug}`)).toEqual({ rewrite: `/s/${slug}/no` });
    expect(await answer(`/s/${slug}/p/${handle}`)).toEqual({ rewrite: `/s/${slug}/no/p/${handle}` });
    expect(await answer(`/s/${slug}/cart`, false)).toEqual({ rewrite: `/s/${slug}/no/cart` });
    expect(await answer(`/s/${slug}/no/p/${handle}`)).toEqual({ location: `/s/${slug}/p/${handle}?a=1` });
    expect(await answer(`/s/${slug}/no`)).toEqual({ location: `/s/${slug}?a=1` });
    // A POST (a server action on an old page) is served where it was sent, never moved.
    expect(await answer(`/s/${slug}/no/p/${handle}`, false)).toBeNull();
  });

  it("is listed for search engines and AI assistants at the short addresses", async () => {
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${storeId}::uuid`);
    const sitemap = (await storeSitemap(slug)) ?? "";
    expect(sitemap).toContain(`/s/${slug}/p/${handle}</loc>`);
    expect(sitemap).toContain(`/s/${slug}</loc>`);
    expect(sitemap).not.toContain(`/s/${slug}/no`);
    const llms = (await storeLlms(slug)) ?? "";
    expect(llms).toContain(`/s/${slug}/p/${handle}`);
    expect(llms).not.toContain(`/s/${slug}/no/`);
  });
});

describe("the same store once it offers English and euro", () => {
  beforeAll(async () => {
    await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'en-GB'], features = features || array['languages', 'currencies'] where id = ${storeId}::uuid`);
    await db().execute(sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${storeId}::uuid, 'NOK', 11.6, 100, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
      on conflict do nothing
    `);
    forgetStoreFacts(slug);
  });

  it("has short addresses for them, which a page may not take", async () => {
    const store = await getStore(slug);
    expect(store?.address).toMatchObject({ marketless: true, languages: ["en"], currencies: ["eur"] });
    // With the languages and currencies of the countries it keeps but does not offer (the template's Sweden and Denmark).
    expect(reservedChoiceSlugs(store?.address)).toEqual(expect.arrayContaining(["en", "en-eur", "eur", "sv", "sek", "da-dkk"]));
    expect(reservedChoiceSlugs(store?.address)).not.toContain("nb");
    expect(marketPath(slug, "no-en", "/cart")).toBe(`/s/${slug}/en/cart`);
    expect(await answer(`/s/${slug}/en/p/${handle}`)).toEqual({ rewrite: `/s/${slug}/no-en/p/${handle}` });
    expect(await answer(`/s/${slug}/no-en-eur/cart`)).toEqual({ location: `/s/${slug}/en-eur/cart?a=1` });
  });
});

describe("the same store once it sells in several countries", () => {
  beforeAll(async () => {
    await db().execute(sql`
      insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
      select ${storeId}::uuid, code, currency, default_locale, locales, true from commerce.countries where code = 'SE'
      on conflict (store_id, code) do update set active = true
    `);
    await db().execute(sql`update commerce.stores set features = features || array['countries'] where id = ${storeId}::uuid`);
    forgetStoreFacts(slug);
  });

  it("has its country in its addresses again", async () => {
    const store = await getStore(slug);
    expect(store?.address?.marketless).toBe(false);
    expect(marketPath(slug, "no", "/home")).toBe(`/s/${slug}/no/home`);
  });

  it("moves the short addresses back to its own country's: a live product, a working page, a language", async () => {
    expect(await answer(`/s/${slug}/p/${handle}`)).toEqual({ location: `/s/${slug}/no/p/${handle}?a=1` });
    expect(await answer(`/s/${slug}/cart`)).toEqual({ location: `/s/${slug}/no/cart?a=1` });
    expect(await answer(`/s/${slug}/en/cart`)).toEqual({ location: `/s/${slug}/no-en/cart?a=1` });
    expect(await answer(`/s/${slug}/no/p/${handle}`)).toBeNull();
    expect(await answer(`/s/${slug}/se`)).toBeNull();
  });

  it("leaves an address that is live nowhere a 404, counted by the caller", async () => {
    expect(await answer(`/s/${slug}/collections/nothing-here`)).toEqual({ miss: { storeId, path: "/collections/nothing-here" } });
  });
});
