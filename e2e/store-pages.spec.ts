import { expect, test } from "@playwright/test";

/**
 * A store's own pages (D54) as shoppers meet them: the seeded demo store has
 * "Om oss", linked from its footer by address and named after the page.
 */

test("a store's footer leads to its page, prerendered in the store's own layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/s/demo/no");
  await page.getByRole("contentinfo").getByRole("link", { name: "Om oss", exact: true }).click();
  await expect(page).toHaveURL("/s/demo/no/om-oss");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Om Kaizena Flow Demo");
  await expect(page.getByText("Vi selger ting for hjem og kontor.")).toBeVisible();
  // In the store's layout, in the market's language, with its own title and description.
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page).toHaveTitle("Om oss · Kaizena Flow Demo");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /hjem og kontor/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/s\/demo\/no\/om-oss$/);
  // The page spans the window: the storefront's main drops its width for it.
  const main = await page.getByRole("main").boundingBox();
  expect(main?.width).toBe(1280);
});

test("a store page is in every market, and unknown pages and the store's routes are its own", async ({ page, request }) => {
  const response = await request.get("/s/demo/se/om-oss");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Om Kaizena Flow Demo");
  expect(html).toContain('"@type":"WebPage"');
  expect((await page.goto("/s/demo/no/finnes-ikke"))?.status()).toBe(404);
  // The store's own routes come first.
  await page.goto("/s/demo/no/cart");
  await expect(page).toHaveURL("/s/demo/no/cart");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Om Kaizena Flow Demo");
});

test("a store page reads in the market's language where it is translated, else in the main one", async ({ page }) => {
  await page.goto("/s/demo/se/om-oss");
  await expect(page.getByText("Vi säljer saker för hem och kontor.")).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /säljer saker/);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await page.goto("/s/demo/dk/om-oss");
  await expect(page.getByText("Vi selger ting for hjem og kontor.")).toBeVisible();
});

test("the store opens with its front page, a content grid of its products, at the market's own address", async ({ page }) => {
  await page.goto("/s/demo/se");
  await expect(page.getByRole("heading", { level: 1, name: "Produkter" })).toBeVisible();
  const tote = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name: "Demo: Tygkasse i canvas" }) });
  await expect(tote).toContainText("inkl. moms");
  // The page's own address leads to the front page.
  await page.goto("/s/demo/se/forside");
  await expect(page).toHaveURL("/s/demo/se");
});

test("leaving while the next page is still on its way goes where the shopper asked, never to that page", async ({ page }) => {
  // Safari's engine cancels a page's requests the moment a whole-page load starts, while the page's scripts still run. The router took
  // its cancelled request for a failure and loaded that page's address in full instead, taking the shopper there and not where they
  // asked (patches/next@16.4.2.patch). Here the search page is not prefetched, so going to it needs a request of its own, and that
  // request is held, as on a slow connection.
  const search = "/s/demo/se/search";
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const own = (headers: Record<string, string>) => Boolean(headers.rsc) && !headers["next-router-prefetch"];
  await page.route(
    (url) => url.pathname === search,
    async (route) => {
      const headers = route.request().headers();
      if (headers["next-router-prefetch"]) return route.abort();
      if (!own(headers)) return route.fallback();
      await held;
      await route.continue().catch(() => {});
    },
  );
  await page.goto("/s/demo/se");
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === search && own(r.headers()));
  await page.getByRole("link", { name: "Sök" }).first().click();
  await asked;
  // A whole-page load elsewhere before the search page came: an address typed, a bookmark, a plain link.
  await page.goto("/s/demo/se/om-oss");
  await expect(page.getByText("Vi säljer saker för hem och kontor.")).toBeVisible();
  await expect(page).toHaveURL("/s/demo/se/om-oss");
  release();
});
