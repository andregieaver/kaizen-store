import { expect, test } from "@playwright/test";

test("the platform home page links to the demo store", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await page.getByRole("link", { name: "See the demo store" }).click();
  await expect(page).toHaveURL("/s/demo");
});

test("a store's chooser offers every market without redirecting", async ({ page }) => {
  const response = await page.goto("/s/demo");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL("/s/demo");
  await expect(page.getByRole("heading", { level: 1, name: "Kaizen Demo" })).toBeVisible();
  for (const name of ["Norge", "Sverige", "Danmark"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
});

test("a market lists products with VAT-inclusive prices", async ({ page }) => {
  await page.goto("/s/demo/no");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Produkter" })).toBeVisible();
  const mug = page.getByRole("listitem").filter({ hasText: "Demo: Keramikkopp" });
  await expect(mug).toContainText("249,00");
  await expect(mug).toContainText("inkl. mva.");
  // A genuine reduction shows the lowest price of the previous 30 days.
  await expect(mug).toContainText("Laveste pris siste 30 dager: 299,00");
});

test("a product page shows stock, safety details and structured data", async ({ page }) => {
  await page.goto("/s/demo/no");
  await page.getByRole("link", { name: "Demo: Keramikkopp" }).click();
  await expect(page).toHaveURL("/s/demo/no/p/demo-keramikkopp");
  await expect(page).toHaveTitle("Demo: Keramikkopp · Kaizen Demo");

  await expect(page.getByText("Kun 3 igjen")).toBeVisible();
  await expect(page.getByText("På lager")).toBeVisible();
  await expect(page.getByText("Kaizen Demo AS, Storgata 1")).toBeVisible();
  await expect(page.getByText("Ansvarlig person i EU")).toBeVisible();

  // Colours are variants of one product group, each with its own offer.
  // (After a click the previous page stays in the DOM, hidden, so pick the product's data.)
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  const jsonLd = JSON.parse(scripts.find((text) => text.includes("ProductGroup")) ?? "{}");
  const [group, trail] = jsonLd["@graph"];
  expect(group).toMatchObject({ "@type": "ProductGroup", variesBy: ["https://schema.org/color"] });
  expect(group.hasVariant).toHaveLength(2);
  expect(group.hasVariant[0].offers).toMatchObject({
    priceCurrency: "NOK",
    price: "249.00",
    itemCondition: "https://schema.org/NewCondition",
    shippingDetails: { shippingDestination: { addressCountry: "NO" } },
    hasMerchantReturnPolicy: { merchantReturnDays: 14 },
  });
  expect(trail["@type"]).toBe("BreadcrumbList");

  // Shares show the product's picture and its description.
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /mug/);
  await expect(page.locator('meta[property="og:image:alt"]').first()).toHaveAttribute("content", /.+/);
  await expect(page.locator('link[rel="alternate"][hreflang="sv-SE"]')).toHaveAttribute(
    "href",
    /\/s\/demo\/se\/p\/demo-keramikkopp$/,
  );
});

test("search engines and AI assistants get a sitemap, crawler rules and llms.txt", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain("Disallow: /s/demo/*/cart");
  expect(robots).toMatch(/Sitemap: \S+\/sitemap\.xml/);

  const index = await (await request.get("/sitemap.xml")).text();
  expect(index).toContain("/s/demo/sitemap.xml");
  const sitemap = await (await request.get("/s/demo/sitemap.xml")).text();
  expect(sitemap).toContain("/s/demo/se/p/demo-keramikkopp</loc>");
  expect(sitemap).toContain('hreflang="da-DK"');

  const llms = await request.get("/s/demo/llms.txt");
  expect(llms.headers()["content-type"]).toContain("text/markdown");
  const text = await llms.text();
  expect(text).toMatch(/^# Kaizen Demo\n\n> /);
  expect(text).toContain("/s/demo/no/p/demo-keramikkopp): NOK 249.00");
  expect(await (await request.get("/llms.txt")).text()).toContain("/s/demo/llms.txt");

  const share = await request.get("/s/demo/og.png");
  expect(share.headers()["content-type"]).toBe("image/png");
});

test("a market's front page describes the store to search engines", async ({ page }) => {
  await page.goto("/s/demo/no");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Kaizen Demo/);
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
  const types = jsonLd["@graph"].map((node: { "@type": string }) => node["@type"]);
  expect(types).toEqual(["OnlineStore", "WebSite", "CollectionPage"]);
  expect(jsonLd["@graph"][0].hasMerchantReturnPolicy.applicableCountry).toContain("SE");
});

test("other markets use their own language and currency", async ({ page }) => {
  await page.goto("/s/demo/se/p/demo-bordlampe");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.getByText("inkl. moms").first()).toBeVisible();
  await expect(page.getByText("Slutsåld")).toBeVisible();

  await page.goto("/s/demo/dk");
  await expect(page.locator("html")).toHaveAttribute("lang", "da");
  await expect(
    page.getByRole("listitem").filter({ hasText: "Demo: Keramikkrus" }),
  ).toContainText("179,00");
});

test("unknown stores, markets and products are not found", async ({ page }) => {
  expect((await page.goto("/s/no-such-store"))?.status()).toBe(404);
  expect((await page.goto("/s/no-such-store/no"))?.status()).toBe(404);
  expect((await page.goto("/s/demo/de"))?.status()).toBe(404);
  await page.goto("/s/demo/no/p/does-not-exist");
  await expect(page.getByText("Siden finnes ikke.")).toBeVisible();
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

test("health endpoint reaches the database without caching", async ({ request }) => {
  const response = await request.get("/api/health");
  // Supabase's API is not configured in CI, so 503 is expected there.
  expect([200, 503]).toContain(response.status());
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toMatchObject({ database: "ok", activeMarkets: 3 });
});
