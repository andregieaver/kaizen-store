import { expect, test } from "@playwright/test";

test("the chooser offers every market without redirecting", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL("/");
  for (const name of ["Norge", "Sverige", "Danmark"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
});

test("a market lists products with VAT-inclusive prices", async ({ page }) => {
  await page.goto("/no");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Produkter" })).toBeVisible();
  const mug = page.getByRole("listitem").filter({ hasText: "Demo: Keramikkopp" });
  await expect(mug).toContainText("249,00");
  await expect(mug).toContainText("inkl. mva.");
  // A genuine reduction shows the lowest price of the previous 30 days.
  await expect(mug).toContainText("Laveste pris siste 30 dager: 299,00");
});

test("a product page shows stock, safety details and structured data", async ({ page }) => {
  await page.goto("/no");
  await page.getByRole("link", { name: "Demo: Keramikkopp" }).click();
  await expect(page).toHaveURL("/no/p/demo-keramikkopp");
  await expect(page).toHaveTitle("Demo: Keramikkopp · Kaizen Store");

  await expect(page.getByText("Kun 3 igjen")).toBeVisible();
  await expect(page.getByText("På lager")).toBeVisible();
  await expect(page.getByText("Kaizen Demo AS, Storgata 1")).toBeVisible();
  await expect(page.getByText("Ansvarlig person i EU")).toBeVisible();

  const jsonLd = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
  );
  expect(jsonLd["@type"]).toBe("Product");
  expect(jsonLd.offers).toHaveLength(2);
  expect(jsonLd.offers[0]).toMatchObject({ priceCurrency: "NOK", price: "249.00" });
});

test("other markets use their own language and currency", async ({ page }) => {
  await page.goto("/se/p/demo-bordlampe");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.getByText("inkl. moms").first()).toBeVisible();
  await expect(page.getByText("Slutsåld")).toBeVisible();

  await page.goto("/dk");
  await expect(page.locator("html")).toHaveAttribute("lang", "da");
  await expect(
    page.getByRole("listitem").filter({ hasText: "Demo: Keramikkrus" }),
  ).toContainText("179,00");
});

test("unknown markets and products are not found", async ({ page }) => {
  expect((await page.goto("/de"))?.status()).toBe(404);
  await page.goto("/no/p/does-not-exist");
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
