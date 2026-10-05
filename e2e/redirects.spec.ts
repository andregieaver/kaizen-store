import { expect, test, type APIRequestContext } from "@playwright/test";
import type postgres from "postgres";

import { testDb, testStore } from "./db";

/**
 * Redirects and the 404 report as shoppers and search engines meet them (wave 2, second run, D168, `docs/wave-2-redirects.md` 6.1, 6.3). Everything is seeded with SQL
 * (the repository has no signed-in admin fixture), in a store made for each test so that nothing is cached before the first request.
 *
 * A miss is looked up through a cached function with a one second life (`missOrRedirect()`, section 10 of the spec: a dynamic lookup would stream a 200), and a
 * redirect inserted by SQL does not refresh its tag, so a test that adds one after a first 404 polls until the answer changes: what it holds is that the answer
 * is not stuck on the 404.
 */

const run = Date.now().toString(36);
const POLL = { timeout: 30_000, intervals: [500, 1000, 1000, 2000] };

const newStore = testStore;

const withDb = async <T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> => {
  const sql = testDb();
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
};

/**
 * What a request for an address answers, without following the redirect. The first response of an address that is rendered on demand may carry its `Location`
 * header twice with the same value (Next sets it in two places while it streams), so the values are made one: what matters is where it points.
 */
async function ask(request: APIRequestContext, path: string): Promise<{ status: number; location: string | null }> {
  const response = await request.get(path, { maxRedirects: 0 });
  const values = [...new Set((response.headers()["location"] ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
  const to = values.length === 1 ? new URL(values[0], "http://x") : null;
  return { status: response.status(), location: to ? to.pathname + to.search : null };
}

test("a renamed product's old addresses go straight to the current one for good, in every market; a product no longer sold is a 404", async ({ request }) => {
  const store = await newStore("e2e-rn-product");
  await withDb(async (sql) => {
    // Renamed twice: each old address must reach the current page in one response, never a chain.
    await sql`update commerce.products set handle = ${`kopp-a-${run}`} where store_id = ${store.id} and handle = 'demo-keramikkopp'`;
    await sql`update commerce.products set handle = ${`kopp-b-${run}`} where store_id = ${store.id} and handle = ${`kopp-a-${run}`}`;
    // Renamed, then taken off sale: its old address has nowhere to go.
    await sql`update commerce.products set handle = ${`notat-${run}`} where store_id = ${store.id} and handle = 'demo-notatbok'`;
    await sql`update commerce.products set status = 'archived' where store_id = ${store.id} and handle = ${`notat-${run}`}`;
  });

  for (const market of ["no", "se"]) {
    for (const old of ["demo-keramikkopp", `kopp-a-${run}`]) {
      const answer = await ask(request, `/s/${store.slug}/${market}/p/${old}`);
      expect(answer.status, `${market} ${old}`).toBe(308);
      expect(answer.location, `${market} ${old}`).toBe(`/s/${store.slug}/${market}/p/kopp-b-${run}`);
    }
  }
  expect((await request.get(`/s/${store.slug}/no/p/kopp-b-${run}`, { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get(`/s/${store.slug}/no/p/demo-notatbok`, { maxRedirects: 0 })).status()).toBe(404);
});

test("a renamed category's and tag's old addresses redirect for good; an address that never existed stays a 404", async ({ request }) => {
  const store = await newStore("e2e-rn-term");
  await withDb(async (sql) => {
    await sql`update commerce.terms set slug = ${`hjem-${run}`} where store_id = ${store.id} and kind = 'category' and slug = 'hjem'`;
    await sql`update commerce.terms set slug = ${`nyhet-${run}`} where store_id = ${store.id} and kind = 'tag' and slug = 'nyhet'`;
  });

  expect(await ask(request, `/s/${store.slug}/no/category/hjem`)).toEqual({ status: 308, location: `/s/${store.slug}/no/category/hjem-${run}` });
  expect(await ask(request, `/s/${store.slug}/se/tag/nyhet`)).toEqual({ status: 308, location: `/s/${store.slug}/se/tag/nyhet-${run}` });
  // A tag's address is not a category's: the redirect is for the kind it was.
  expect((await ask(request, `/s/${store.slug}/no/category/nyhet`)).status).toBe(404);
  expect((await ask(request, `/s/${store.slug}/no/category/finnes-ikke`)).status).toBe(404);
});

test("a manual redirect is followed from the page routes and the catch-all, in every market, with the target's own query kept", async ({ request }) => {
  const store = await newStore("e2e-manual");
  await withDb(async (sql) => {
    await sql`
      insert into commerce.redirects (store_id, kind, source, target, origin) values
        (${store.id}, 'manual', ${`/gammel-${run}`}, '/category/hjem', 'editor'),
        (${store.id}, 'manual', ${`/collections/sko-${run}`}, '/category/belysning?ref=old', 'editor'),
        (${store.id}, 'manual', ${`/blog/gammel-${run}`}, '/', 'editor')`;
  });
  // A single page route, the catch-all (an old shop's address under a market), and an article's route; the same redirect in two countries.
  expect(await ask(request, `/s/${store.slug}/no/gammel-${run}`)).toEqual({ status: 308, location: `/s/${store.slug}/no/category/hjem` });
  expect(await ask(request, `/s/${store.slug}/se/gammel-${run}`)).toEqual({ status: 308, location: `/s/${store.slug}/se/category/hjem` });
  expect(await ask(request, `/s/${store.slug}/no/collections/sko-${run}`)).toEqual({ status: 308, location: `/s/${store.slug}/no/category/belysning?ref=old` });
  // A target of `/` is the market's front page.
  expect(await ask(request, `/s/${store.slug}/dk/blog/gammel-${run}`)).toEqual({ status: 308, location: `/s/${store.slug}/dk` });
  // An address no redirect names is the 404 it was, with the 404 status.
  expect((await ask(request, `/s/${store.slug}/no/ukjent-${run}`)).status).toBe(404);
  expect((await ask(request, `/s/${store.slug}/no/collections/ukjent-${run}`)).status).toBe(404);
});

test("a miss that is answered 404 is not stuck: a redirect added to the database later is followed", async ({ request }) => {
  const store = await newStore("e2e-later");
  const path = `/s/${store.slug}/no/senere-${run}`;
  expect((await ask(request, path)).status).toBe(404);
  await withDb(async (sql) => {
    await sql`insert into commerce.redirects (store_id, kind, source, target, origin) values (${store.id}, 'manual', ${`/senere-${run}`}, '/category/hjem', 'editor')`;
  });
  // A change made behind the application's back (no tag refreshed) is seen when the lookup's one second life is over. Only the status is held here: an owner's change
  // goes through `updateTag()`, which re-renders at once (a first render carries its `Location`); the page that is re-rendered in the background after a lookup's
  // life is over is given a `Location` only by the first kind of render (see the report of the shopper step).
  await expect.poll(async () => (await ask(request, path)).status, POLL).toBe(308);
});

test("a live page is never redirected, whatever a redirect says", async ({ request }) => {
  const store = await newStore("e2e-live");
  await withDb(async (sql) => {
    // A redirect from an address that is live now (the database does not check this, the service does): the page must still be served as itself.
    await sql`
      insert into commerce.redirects (store_id, kind, source, target, origin)
      values (${store.id}, 'manual', '/p/demo-bordlampe', '/category/hjem', 'editor')`;
  });
  expect(await ask(request, `/s/${store.slug}/no/p/demo-bordlampe`)).toEqual({ status: 200, location: null });
});

test("an address with no country (an old shop's) is redirected to the main market by the proxy, and left a 404 without a redirect", async ({ request }) => {
  const source = `/collections/gamle-${run}`;
  expect((await ask(request, `/s/demo${source}`)).status).toBe(404);
  await withDb(async (sql) => {
    const [store] = await sql`select id from commerce.stores where slug = 'demo'`;
    await sql`
      insert into commerce.redirects (store_id, kind, source, target, origin) values (${store.id}, 'manual', ${source}, '/category/hjem', 'editor')`;
  });
  try {
    // The proxy remembers an answer for a few seconds, so the change is polled for; the main market's own address is where it goes, with the request's query.
    await expect.poll(() => ask(request, `/s/demo${source}?utm_source=x`), POLL).toEqual({ status: 308, location: "/s/demo/no/category/hjem?utm_source=x" });
    // A path that has a market never reaches the proxy's branch.
    expect((await ask(request, "/s/demo/no/category/hjem")).status).toBe(200);
  } finally {
    await withDb((sql) => sql`delete from commerce.redirects where source = ${source}`);
  }
});

test("an address whose first part only looks like a country is looked up too, and is a 404 without a redirect", async ({ request }) => {
  const store = await newStore("e2e-looks");
  const first = `om-${run.slice(0, 4)}`;
  await withDb(async (sql) => {
    await sql`insert into commerce.redirects (store_id, kind, source, target, origin) values (${store.id}, 'manual', ${`/${first}`}, '/category/hjem', 'editor')`;
  });
  const moved = await ask(request, `/s/${store.slug}/${first}`);
  expect(moved.status).toBe(308);
  // The store's main market: its own country, whichever the template made first.
  expect(moved.location).toMatch(new RegExp(`^/s/${store.slug}/(no|se|dk)/category/hjem$`));
  expect((await ask(request, `/s/${store.slug}/om-ingen`)).status).toBe(404);
});

test("the 404 report counts what was missing, and never a working page, a token, a probe or a person's address", async ({ request }) => {
  const store = await newStore("e2e-report");
  const base = `/s/${store.slug}/no`;
  // Refused first, then the one that is counted: a count that is written by the time its response is sent shows the others would have been too.
  for (const path of [`${base}/cart/ikke-${run}`, `${base}/0123456789abcdef0123456789abcdef`, `${base}/wp-login.php`, `${base}/kontakt@example.com`]) {
    expect((await ask(request, path)).status, path).toBe(404);
  }
  expect((await ask(request, `${base}/mangler-${run}`)).status).toBe(404);
  // An old shop's address with no country, counted by the proxy after its response.
  expect((await ask(request, `/s/${store.slug}/pages/om-${run}`)).status).toBe(404);

  await expect
    .poll(
      () =>
        withDb(async (sql) => {
          const rows = await sql`select path, hits from commerce.not_found_hits where store_id = ${store.id} and path is not null order by path`;
          return rows.map((r) => r.path);
        }),
      POLL,
    )
    .toEqual([`/mangler-${run}`, `/pages/om-${run}`]);
  const [{ crawlers }] = await withDb((sql) => sql`select coalesce(sum(crawler_hits), 0)::int as crawlers from commerce.not_found_hits where store_id = ${store.id}`);
  // A browser's request is not a robot's.
  expect(crawlers).toBe(0);
});

test("a manual redirect to an address with Nordic, Polish or Greek letters is a 308 with a pure ASCII Location, never a 500 (the market routes and the proxy)", async ({ request }) => {
  const store = await newStore("e2e-unicode");
  const cases = [
    { from: `/gammel-ost-${run}`, to: "/search?q=blå", location: "/search?q=bl%C3%A5" },
    { from: `/gammel-pl-${run}`, to: "/pages/zażółć", location: "/pages/za%C5%BC%C3%B3%C5%82%C4%87" },
    { from: `/zz-greek-${run}`, to: "/products/ζώνη", location: "/products/%CE%B6%CF%8E%CE%BD%CE%B7" },
    { from: `/collections/zzgreek-${run}`, to: "/products/ζώνη", location: "/products/%CE%B6%CF%8E%CE%BD%CE%B7" },
  ];
  await withDb(async (sql) => {
    for (const c of cases) {
      await sql`insert into commerce.redirects (store_id, kind, source, target, origin) values (${store.id}, 'manual', ${c.from}, ${c.to}, 'editor')`;
    }
  });
  const raw = async (path: string) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const location = [...new Set((response.headers()["location"] ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
    return { status: response.status(), location };
  };
  for (const c of cases) {
    // Under a market the route redirects (the first two are page routes, the last is the catch-all); without one the proxy does.
    const viaMarket = !c.from.startsWith("/collections");
    for (const market of viaMarket ? ["no", "se"] : ["no"]) {
      const path = `/s/${store.slug}/${market}${c.from}`;
      const answer = await expect.poll(async () => (await raw(path)).status, POLL).toBe(308).then(() => raw(path));
      expect(answer.location, path).toEqual([`/s/${store.slug}/${market}${c.location}`]);
      expect(/^[\x21-\x7e]*$/.test(answer.location[0]), answer.location[0]).toBe(true);
    }
  }
  // An address with no country: the proxy's, and the unknown-market route's (a first part that only looks like a country).
  const proxy = await raw(`/s/${store.slug}${cases[3].from}`);
  expect(proxy.status).toBe(308);
  expect(proxy.location).toHaveLength(1);
  expect(proxy.location[0]).toMatch(new RegExp(`^/s/${store.slug}/(no|se|dk)/products/%CE%B6%CF%8E%CE%BD%CE%B7$`));
  const looks = await raw(`/s/${store.slug}${cases[2].from}`);
  expect(looks.status).toBe(308);
  expect(looks.location[0]).toMatch(/^[\x21-\x7e]*$/);
});

test("a POST to an address with no country is neither redirected nor counted as a missing page; a GET is", async ({ request }) => {
  const store = await newStore("e2e-post");
  const source = `/collections/gamle-post-${run}`;
  await withDb(async (sql) => {
    await sql`insert into commerce.redirects (store_id, kind, source, target, origin) values (${store.id}, 'manual', ${source}, '/category/hjem', 'editor')`;
  });
  const path = `/s/${store.slug}${source}`;
  // The proxy remembers an answer for a few seconds, so the GET is polled for; the POST is sent after the redirect is known to be live.
  await expect.poll(async () => (await request.get(path, { maxRedirects: 0 })).status(), POLL).toBe(308);
  const post = await request.post(path, { maxRedirects: 0, data: { a: "b" } });
  expect(post.status()).not.toBe(308);
  expect(post.headers()["location"]).toBeUndefined();
  // A POST to an address that no redirect covers is no page request either: it is not counted.
  const missing = `/s/${store.slug}/collections/ingen-post-${run}`;
  await request.post(missing, { maxRedirects: 0, data: { a: "b" } });
  expect((await request.get(`/s/${store.slug}/collections/ingen-get-${run}`, { maxRedirects: 0 })).status()).toBe(404);
  await expect
    .poll(
      () =>
        withDb(async (sql) => {
          const rows = await sql`select path from commerce.not_found_hits where store_id = ${store.id} and path is not null order by path`;
          return rows.map((r) => r.path);
        }),
      POLL,
    )
    .toEqual([`/collections/ingen-get-${run}`]);
});
