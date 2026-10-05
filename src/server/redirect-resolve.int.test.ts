import { validateHeaderValue } from "node:http";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { auditActions, outcomeOf, redirectFixture, redirectRowsOf, renameProduct, renameTerm, type RedirectFixture } from "./redirect-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const resolve = await import("./redirect-resolve");
const redirects = await import("./redirects");
const notFound = await import("./not-found");
const { findPublishedPage } = await import("./pages");

type Row = Record<string, unknown>;

/**
 * What a request meets where it would be a 404 (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.1, 6.1 R1, 6.3 S1): a changed address of a product,
 * a category, a tag, a page or an article answers ONE permanent redirect to the current address in the same market, whatever the number of renames; a manual
 * redirect is followed through the chain in one response up to 10 hops; a loop, a longer chain, a target that is not live in the market and a failure of the
 * database are a 404; other stores and live addresses are never touched.
 */

let f: RedirectFixture;
let other: RedirectFixture;
const market = (slug: string, code = "NO") => ({ slug, code });
const shop = (fx: RedirectFixture, m = market("no")) => ({ store: { id: fx.fx.storeId, slug: fx.fx.slug }, market: m });

beforeAll(async () => {
  f = await redirectFixture("resolve");
  other = await redirectFixture("resolve-other");
});

afterAll(async () => {
  await closeDb();
});

const miss = (fx: RedirectFixture, path: string, query = "", m = market("no")) => outcomeOf(resolve.missOrRedirect(shop(fx, m), path, query));

describe("an address that changed", () => {
  it("sends the old address of a product to the current one, in the same market and language view, with a 308", async () => {
    const fx = await redirectFixture("resolve-product");
    const old = fx.product.handle;
    await renameProduct(fx.fx.storeId, fx.product.id, `${old}-new`);
    expect(await miss(fx, `/p/${old}`)).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/p/${old}-new` });
    expect(await miss(fx, `/p/${old}`, "", market("no-en"))).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no-en/p/${old}-new` });
    // The request's capitals and its query string follow the normal form and the target.
    expect(await miss(fx, `/p/${old.toUpperCase()}`, "?ref=a")).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/p/${old}-new?ref=a` });
  });

  it("sends every old address of a product renamed several times straight to the current one (one response, never a chain)", async () => {
    const fx = await redirectFixture("resolve-renamed");
    const a = fx.product.handle;
    await renameProduct(fx.fx.storeId, fx.product.id, `${a}-b`);
    await renameProduct(fx.fx.storeId, fx.product.id, `${a}-c`);
    await renameProduct(fx.fx.storeId, fx.product.id, `${a}-d`);
    for (const old of [a, `${a}-b`, `${a}-c`]) expect(await miss(fx, `/p/${old}`), old).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/p/${a}-d` });
    // The current address is the product's own: not a miss at all (a product route never calls the lookup for it).
    expect((await resolve.resolveMiss(fx.fx.storeId, "NO", `/p/${a}-d`))).toBeNull();
  });

  it("is a 404, counted, when the product is a draft, archived or has no price in the market asked", async () => {
    const fx = await redirectFixture("resolve-unlive");
    const old = fx.product.handle;
    await renameProduct(fx.fx.storeId, fx.product.id, `${old}-new`);
    expect(await miss(fx, `/p/${old}`, "", market("se", "SE"))).toEqual({ status: 404 });
    await db().execute(sql`update commerce.products set status = 'draft' where id = ${fx.product.id}::uuid`);
    expect(await miss(fx, `/p/${old}`)).toEqual({ status: 404 });
    await db().execute(sql`update commerce.products set status = 'archived' where id = ${fx.product.id}::uuid`);
    expect(await miss(fx, `/p/${old}`)).toEqual({ status: 404 });
    await db().execute(sql`update commerce.products set status = 'active' where id = ${fx.product.id}::uuid`);
    expect(await miss(fx, `/p/${old}`)).toMatchObject({ status: 308 });
  });

  it("sends the old address of a category and of a tag to the current one", async () => {
    const fx = await redirectFixture("resolve-terms");
    const oldCategory = fx.category.slug;
    const oldTag = fx.tag.slug;
    await renameTerm(fx.fx.storeId, fx.category.id, `${oldCategory}-ny`);
    await renameTerm(fx.fx.storeId, fx.tag.id, `${oldTag}-ny`);
    expect(await miss(fx, `/category/${oldCategory}`)).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/category/${oldCategory}-ny` });
    expect(await miss(fx, `/tag/${oldTag}`)).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/tag/${oldTag}-ny` });
    // A tag's address is not a category's.
    expect(await miss(fx, `/category/${oldTag}`)).toEqual({ status: 404 });
  });

  it("leaves a page's and an article's old address to the page route's own redirect (page_redirects, by the page's id)", async () => {
    const fx = await redirectFixture("resolve-pages");
    await db().execute(sql`update commerce.pages set slug = 'om-oss-ny' where store_id = ${fx.fx.storeId}::uuid and slug = 'om-oss'`);
    await db().execute(sql`update commerce.pages set slug = 'nyheter-ny' where store_id = ${fx.fx.storeId}::uuid and slug = 'nye-produkter' and type = 'article'`);
    await db().execute(sql`update commerce.pages set slug = 'nyheter-nyere' where store_id = ${fx.fx.storeId}::uuid and slug = 'nyheter-ny' and type = 'article'`);
    expect(await findPublishedPage(fx.fx.storeId, "om-oss", "page")).toEqual({ redirect: "om-oss-ny" });
    // An article renamed twice: every old address goes to the current one.
    expect(await findPublishedPage(fx.fx.storeId, "nye-produkter", "article")).toEqual({ redirect: "nyheter-nyere" });
    expect(await findPublishedPage(fx.fx.storeId, "nyheter-ny", "article")).toEqual({ redirect: "nyheter-nyere" });
  });
});

describe("a manual redirect", () => {
  it("applies in every market and language of the store, keeps the request's query and the target's own", async () => {
    await redirects.createRedirect(f.owner, { from: "/collections/shoes", to: `/category/${f.category.slug}` });
    await redirects.createRedirect(f.owner, { from: "/products/old-cup", to: `/p/${f.product.handle}?variant=2#details` });
    expect(await miss(f, "/collections/shoes")).toEqual({ status: 308, location: `/s/${f.fx.slug}/no/category/${f.category.slug}` });
    expect(await miss(f, "/collections/shoes", "?utm=1&b=2", market("se", "SE"))).toEqual({ status: 308, location: `/s/${f.fx.slug}/se/category/${f.category.slug}?utm=1&b=2` });
    expect(await miss(f, "/Collections/Shoes/", "", market("no-en"))).toEqual({ status: 308, location: `/s/${f.fx.slug}/no-en/category/${f.category.slug}` });
    // The target's own query wins for a name it has; the request's other names are added; the fragment stays.
    expect(await miss(f, "/products/old-cup", "?variant=9&x=1")).toEqual({ status: 308, location: `/s/${f.fx.slug}/no/p/${f.product.handle}?variant=2&x=1#details` });
  });

  it("answers a pure ASCII Location, a valid header value, for a target with Nordic, Polish, Greek or Japanese letters (never a 500 or a raw Latin-1 byte)", async () => {
    const fx = await redirectFixture("resolve-unicode");
    const cases: Array<{ from: string; to: string; location: string }> = [
      { from: "/gammel-ost", to: "/search?q=blå", location: "/search?q=bl%C3%A5" },
      { from: "/gammel-pl", to: "/pages/zażółć", location: "/pages/za%C5%BC%C3%B3%C5%82%C4%87" },
      { from: "/zz-greek", to: "/products/ζώνη", location: "/products/%CE%B6%CF%8E%CE%BD%CE%B7" },
      { from: "/zz-japan", to: "/p/日本語?x=ø#å", location: "/p/%E6%97%A5%E6%9C%AC%E8%AA%9E?x=%C3%B8#%C3%A5" },
    ];
    for (const c of cases) {
      const made = await redirects.createRedirect(fx.owner, { from: c.from, to: c.to });
      expect(made, c.from).toMatchObject({ ok: true });
      for (const [slug, code] of [["no", "NO"], ["se", "SE"]]) {
        const answer = await miss(fx, c.from, "", market(slug, code));
        expect(answer, `${slug} ${c.from}`).toEqual({ status: 308, location: `/s/${fx.fx.slug}/${slug}${c.location}` });
        const { location } = answer as { location: string };
        expect(/^[\x21-\x7e]*$/.test(location), location).toBe(true);
        expect(() => validateHeaderValue("Location", location), location).not.toThrow();
      }
    }
    // The request's own query (already encoded by the client) is carried once, not encoded twice, and a raw letter in it is encoded.
    expect(await miss(fx, "/gammel-ost", "?a=%C3%A5&b=æ")).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/search?q=bl%C3%A5&a=%C3%A5&b=%C3%A6` });
    // The proxy's lookup of an address with no country goes through the same function.
    await redirects.createRedirect(fx.owner, { from: "/collections/zzgreek", to: "/products/ζώνη" });
    expect(await resolve.legacyAnswer(`/s/${fx.fx.slug}/collections/zzgreek`, "", null)).toEqual({ location: `/s/${fx.fx.slug}/no/products/%CE%B6%CF%8E%CE%BD%CE%B7` });
    expect(await resolve.legacyRedirectFor(fx.fx.slug, ["gammel-pl"])).toBe(`/s/${fx.fx.slug}/no/pages/za%C5%BC%C3%B3%C5%82%C4%87`);
  });

  it("goes to the front page of the market for a target of /", async () => {
    await redirects.createRedirect(f.owner, { from: "/home-old", to: "/" });
    expect(await miss(f, "/home-old")).toEqual({ status: 308, location: `/s/${f.fx.slug}/no` });
  });

  it("never touches another store, and a request with no redirect is the 404 it was", async () => {
    await redirects.createRedirect(f.owner, { from: "/only-mine", to: "/om-oss" });
    expect(await miss(other, "/only-mine")).toEqual({ status: 404 });
    expect(await miss(f, "/only-mine")).toMatchObject({ status: 308 });
    expect(await miss(f, "/never-heard-of")).toEqual({ status: 404 });
    expect(await miss(f, "/")).toEqual({ status: 404 });
  });

  it("follows a chain that formed later in one response, stops at a live address, and counts the first redirect's request", async () => {
    const fx = await redirectFixture("resolve-chain");
    await db().execute(sql`
      insert into commerce.redirects (store_id, kind, source, target, origin) values
        (${fx.fx.storeId}::uuid, 'manual', '/m1', '/m2', 'editor'), (${fx.fx.storeId}::uuid, 'manual', '/m2', '/m3?q=1', 'editor'), (${fx.fx.storeId}::uuid, 'manual', '/m3', '/om-oss', 'editor')
    `);
    expect(await miss(fx, "/m1")).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/om-oss` });
    // /m3 becomes a live page: the chain ends there, and the live page is served as itself (it is never looked up).
    await db().execute(sql`update commerce.pages set slug = 'm3' where store_id = ${fx.fx.storeId}::uuid and slug = 'alle-produkter'`);
    expect(await miss(fx, "/m1")).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/m3?q=1` });
    const [row] = await db().execute<Row>(sql`select hits from commerce.redirects where store_id = ${fx.fx.storeId}::uuid and source = '/m1'`);
    expect(Number(row.hits)).toBeGreaterThanOrEqual(1);
  });

  it("follows a manual redirect whose target was renamed afterwards (a manual hop, then an automatic one) in one response", async () => {
    const fx = await redirectFixture("resolve-mixed");
    await redirects.createRedirect(fx.owner, { from: "/shop/cup", to: `/p/${fx.product.handle}` });
    await renameProduct(fx.fx.storeId, fx.product.id, `${fx.product.handle}-new`);
    expect(await miss(fx, "/shop/cup")).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/p/${fx.product.handle}-new` });
  });

  it("follows ten hops and gives up at the eleventh, and a loop in the data is a 404", async () => {
    const fx = await redirectFixture("resolve-hops");
    const rows = Array.from({ length: 11 }, (_, i) => sql`(${fx.fx.storeId}::uuid, 'manual', ${`/h${i + 1}`}, ${i === 10 ? "/om-oss" : `/h${i + 2}`}, 'editor')`);
    await db().execute(sql`insert into commerce.redirects (store_id, kind, source, target, origin) values ${sql.join(rows, sql`, `)}`);
    // /h2 is ten redirects from /om-oss (h2 .. h11); /h1 is eleven.
    expect(await miss(fx, "/h2")).toEqual({ status: 308, location: `/s/${fx.fx.slug}/no/om-oss` });
    expect(await miss(fx, "/h1")).toEqual({ status: 404 });
    // A cycle that got past the checks (the trigger is off for the insert only).
    await db().execute(sql`alter table commerce.redirects disable trigger redirects_no_loop`);
    try {
      await db().execute(sql`insert into commerce.redirects (store_id, kind, source, target, origin) values (${fx.fx.storeId}::uuid, 'manual', '/la', '/lb', 'editor'), (${fx.fx.storeId}::uuid, 'manual', '/lb', '/la', 'editor')`);
    } finally {
      await db().execute(sql`alter table commerce.redirects enable trigger redirects_no_loop`);
    }
    expect(await miss(fx, "/la")).toEqual({ status: 404 });
  });

  it("is a 404, never a 500, when the lookup cannot read the database", async () => {
    // A store id that is no uuid makes every statement fail: the miss is a 404 as it would have been.
    const broken = { store: { id: "not-a-uuid", slug: f.fx.slug }, market: market("no") };
    expect(await outcomeOf(resolve.missOrRedirect(broken, "/anything"))).toEqual({ status: 404 });
  });

  it("does not look up the build's placeholder `_`, and records nothing for it", async () => {
    expect(await miss(f, "/p/_")).toEqual({ status: 404 });
    expect(await miss(f, "/_")).toEqual({ status: 404 });
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.not_found_hits where store_id = ${f.fx.storeId}::uuid and path like '%/_'`);
    expect(row.n).toBe(0);
  });
});

describe("recording what was not found", () => {
  it("counts a miss once in the cached lookup's fill, and not a working page's, a token's or a probe's address", async () => {
    notFound.resetNotFoundThrottle();
    const fx = await redirectFixture("resolve-count");
    expect(await miss(fx, "/zzz-missing")).toEqual({ status: 404 });
    expect(await miss(fx, "/cart/zzz")).toEqual({ status: 404 });
    expect(await miss(fx, "/x/0123456789abcdef0123456789abcdef")).toEqual({ status: 404 });
    expect(await miss(fx, "/wp-login.php")).toEqual({ status: 404 });
    const rows = await db().execute<Row>(sql`select path, hits, crawler_hits from commerce.not_found_hits where store_id = ${fx.fx.storeId}::uuid order by path`);
    expect(rows.map((r) => [r.path, r.hits, r.crawler_hits])).toEqual([["/zzz-missing", 1, 0]]);
  });

  it("does not record an address that has a redirect, and the redirect is counted instead", async () => {
    notFound.resetNotFoundThrottle();
    const fx = await redirectFixture("resolve-covered");
    await redirects.createRedirect(fx.owner, { from: "/covered", to: "/om-oss" });
    expect(await miss(fx, "/covered")).toMatchObject({ status: 308 });
    expect((await db().execute<Row>(sql`select 1 from commerce.not_found_hits where store_id = ${fx.fx.storeId}::uuid`)).length).toBe(0);
    expect(Number((await redirectRowsOf(fx.fx.storeId))[0].hits)).toBe(1);
  });
});

describe("an address with no country", () => {
  it("sends a manual redirect's source to its target in the store's main market, with the query, and only manual ones", async () => {
    const fx = await redirectFixture("resolve-legacy");
    await redirects.createRedirect(fx.owner, { from: "/collections/shoes", to: `/category/${fx.category.slug}` });
    const answer = await resolve.legacyAnswer(`/s/${fx.fx.slug}/collections/Shoes`, "?utm=1", null);
    expect(answer).toEqual({ location: `/s/${fx.fx.slug}/no/category/${fx.category.slug}?utm=1` });
    // On the store's own host the path is the whole address.
    expect(await resolve.legacyAnswer("/collections/shoes", "", fx.fx.slug)).toEqual({ location: `/s/${fx.fx.slug}/no/category/${fx.category.slug}` });
    expect(await resolve.mainMarketOf(fx.fx.slug)).toBe("no");
    // The old address of a product is an AUTOMATIC redirect, which applies inside a market only.
    await renameProduct(fx.fx.storeId, fx.product.id, `${fx.product.handle}-new`);
    expect(await resolve.legacyAnswer(`/s/${fx.fx.slug}/p/${fx.product.handle}`, "", null)).toEqual({ miss: { storeId: fx.fx.storeId, path: `/p/${fx.product.handle}` } });
  });

  it("is a miss, for the caller to count, when no redirect covers it, and nothing at all for a path with a market", async () => {
    const fx = await redirectFixture("resolve-legacy-miss");
    expect(await resolve.legacyAnswer(`/s/${fx.fx.slug}/collections/none`, "", null)).toEqual({ miss: { storeId: fx.fx.storeId, path: "/collections/none" } });
    expect(await resolve.legacyAnswer(`/s/${fx.fx.slug}/no/collections/none`, "", null)).toBeNull();
    expect(await resolve.legacyAnswer("/", "", fx.fx.slug)).toBeNull();
    expect(await resolve.legacyAnswer("/collections/none", "", null)).toBeNull();
    expect(await resolve.legacyAnswer("/s/no-such-store-here/collections/none", "", null)).toBeNull();
  });

  it("serves the unknown-market route's own lookup of a first part that only looks like a market", async () => {
    const fx = await redirectFixture("resolve-legacy-route");
    await redirects.createRedirect(fx.owner, { from: "/om-oss-gammel", to: "/om-oss" });
    expect(await resolve.legacyRedirectFor(fx.fx.slug, ["om-oss-gammel"])).toBe(`/s/${fx.fx.slug}/no/om-oss`);
    expect(await resolve.legacyRedirectFor(fx.fx.slug, ["om-oss-ukjent"])).toBeNull();
    expect(await resolve.legacyRedirectFor(fx.fx.slug, [])).toBeNull();
  });

  it("never reads another store's redirects", async () => {
    const a = await redirectFixture("resolve-legacy-a");
    const b = await redirectFixture("resolve-legacy-b");
    await redirects.createRedirect(a.owner, { from: "/shared-old", to: "/om-oss" });
    expect(await resolve.legacyAnswer(`/s/${b.fx.slug}/shared-old`, "", null)).toEqual({ miss: { storeId: b.fx.storeId, path: "/shared-old" } });
  });
});

describe("the log of changes stays out of the lookup", () => {
  it("writes no activity entry for a request", async () => {
    const before = (await auditActions(f.fx.storeId, "redirect")).length;
    await miss(f, "/collections/shoes");
    expect((await auditActions(f.fx.storeId, "redirect")).length).toBe(before);
  });
});
