import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * A crawler on Next's bot list used to get a blocking render of every page; `htmlLimitedBots` in `next.config.ts` now keeps only the
 * link-preview fetchers on it (bloat review step 2.5), so Bing, Apple, Yandex and the rest get the cached page. These read the pages as
 * such a crawler does: the `request` fixture only, no browser, so no script runs and what is not in the HTML is not there.
 */
const BING = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

async function read(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(path, { headers: { "user-agent": BING } });
  expect(response.status(), path).toBe(200);
  return response.text();
}

/** The four tags a crawler needs from the head. */
function expectHead(html: string) {
  expect(html).toMatch(/<title>[^<]+<\/title>/);
  expect(html).toMatch(/<meta name="description" content="[^"]+"/);
  expect(html).toMatch(/<link rel="canonical" href="[^"]+"/);
  expect(html).toMatch(/<meta property="og:title" content="[^"]+"/);
}

test("a crawler without scripts reads the home page", async ({ request }) => {
  expectHead(await read(request, "/s/demo/no"));
});

test("a crawler without scripts reads a product page", async ({ request }) => {
  const html = await read(request, "/s/demo/no/p/demo-keramikkopp");
  expectHead(html);
  expect(html).toContain("Demo: Keramikkopp");
  expect(html).toMatch(/\d+[,.]\d{2}|\d+\s?kr/);
  expect(html).toContain("application/ld+json");
  expect(html).toMatch(/\\?"@type\\?":\\?"Product/);
  expect(html).toMatch(/\\?"price\\?"/);
});

test("a crawler without scripts reads a category page", async ({ request }) => {
  const html = await read(request, "/s/demo/no/category/belysning");
  expectHead(html);
  expect(html).toContain("Demo: Bordlampe");
});

test("a crawler without scripts reads a blog article", async ({ request }) => {
  const html = await read(request, "/s/demo/no/blog/nye-produkter");
  expectHead(html);
  expect(html).toContain("Nye produkter i høst");
});

test("a crawler gets the cached page", async ({ request }) => {
  // The first request may be a MISS that fills the cache.
  let response = await request.get("/docs", { headers: { "user-agent": BING } });
  expect(response.status()).toBe(200);
  response = await request.get("/docs", { headers: { "user-agent": BING } });
  expect(response.headers()["x-nextjs-cache"]).toBe("HIT");
  expect(response.headers()["cache-control"] ?? "").not.toContain("no-store");
});

test("a link preview still gets its metadata in the head", async ({ request }) => {
  const response = await request.get("/s/demo/no/p/demo-keramikkopp", { headers: { "user-agent": "facebookexternalhit/1.1" } });
  expect(response.status()).toBe(200);
  const html = await response.text();
  const end = html.indexOf("</head>");
  expect(end).toBeGreaterThan(0);
  for (const tag of ["<title>", 'property="og:title"']) {
    const at = html.indexOf(tag);
    expect(at, tag).toBeGreaterThanOrEqual(0);
    expect(at, tag).toBeLessThan(end);
  }
});
