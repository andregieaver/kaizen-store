import { expect, test } from "@playwright/test";

import { testDb } from "./db";

test("add to cart, change quantity within stock, and remove", async ({ page }) => {
  await page.goto("/s/demo/no/p/demo-keramikkopp");

  const black = page.getByRole("listitem").filter({ hasText: "Farge: Svart" });
  await black.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(black.getByRole("status")).toContainText("Lagt i handlekurven.");
  await expect(page.getByRole("link", { name: "Handlekurv (1)" })).toBeVisible();

  await black.getByRole("link", { name: "Gå til handlekurven" }).click();
  await expect(page).toHaveURL("/s/demo/no/cart");
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  // The product page stays mounted but hidden (for back navigation), so look
  // only at what is visible.
  await expect(page.getByText("Farge: Svart").filter({ visible: true })).toBeVisible();

  // Only 3 black mugs are in stock: asking for 5 settles on 3.
  await page.getByLabel("Antall").fill("5");
  await page.getByRole("button", { name: "Oppdater" }).click();
  await expect(page.getByLabel("Antall")).toHaveValue("3");
  await expect(page.getByRole("link", { name: "Handlekurv (3)" })).toBeVisible();
  await expect(page.getByRole("complementary")).toContainText("747,00");
  // Shipping and total are shown before checkout; the demo store takes no payments.
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("Frakt");
  await expect(summary).toContainText("99,00");
  await expect(summary).toContainText("846,00");
  await expect(summary).toContainText("Denne butikken tar ikke imot betaling ennå.");

  await page.getByRole("button", { name: /Fjern/ }).click();
  await expect(page.getByText("Handlekurven er tom.")).toBeVisible();
});

test("out-of-stock variants cannot be added", async ({ page }) => {
  await page.goto("/s/demo/se/p/demo-bordlampe");
  await expect(page.getByRole("button", { name: "Lägg i varukorgen" })).toBeDisabled();
});

test("each market has its own cart", async ({ page }) => {
  await page.goto("/s/demo/dk/p/demo-handlenett");
  await page.getByRole("button", { name: "Læg i kurven" }).click();
  await expect(page.getByRole("link", { name: "Kurv (1)" })).toBeVisible();

  await page.goto("/s/demo/se");
  await expect(page.getByRole("link", { name: "Varukorg", exact: true })).toBeVisible();

  await page.goto("/s/demo/dk/cart");
  await expect(page.getByRole("complementary")).toContainText("149,00");
  await expect(page.getByRole("complementary")).toContainText("inkl. moms");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("product details are plain HTML", async ({ page }) => {
    await page.goto("/s/demo/no/p/demo-notatbok");
    await expect(page.getByRole("heading", { level: 1, name: "Demo: Notatbok A5" })).toBeVisible();
    await expect(page.getByText("129,00").first()).toBeVisible();
    await expect(page.getByText("Kaizen Demo AS, Storgata 1")).toBeVisible();
  });
});

test("the checkout page sends shoppers without an order waiting for payment back to the cart", async ({ page }) => {
  await page.goto("/s/demo/no/checkout");
  await expect(page).toHaveURL("/s/demo/no/cart");
});

test("a download needs no stock or shipping", async ({ page }) => {
  // A digital product in the demo store, as the editor saves one (D24).
  const handle = `e2e-e-bok-${Date.now().toString(36)}`;
  const db = testDb();
  try {
    await db.begin(async (tx) => {
      const [store] = await tx`select id from commerce.stores where slug = 'demo'`;
      const [product] = await tx`
        insert into commerce.products (store_id, handle, tax_code, delivery, download_limit, download_days)
        values (${store.id}, ${handle}, 'txcd_10302000', 'digital', 5, 30) returning id`;
      await tx`
        insert into commerce.product_translations (store_id, product_id, locale, title, description, safety_information)
        values (${store.id}, ${product.id}, 'nb-NO', 'Demo: E-bok', 'En bok å laste ned.', '')`;
      await tx`
        insert into commerce.product_media (store_id, product_id, url, position)
        values (${store.id}, ${product.id}, '/demo/notebook.svg', 0)`;
      const [variant] = await tx`
        insert into commerce.product_variants (store_id, product_id, sku, options, delivery)
        values (${store.id}, ${product.id}, ${handle.toUpperCase()}, '{}', 'digital') returning id`;
      await tx`select commerce.set_price(${variant.id}, 'NO', 9900)`;
      await tx`
        insert into commerce.product_files (store_id, product_id, name, path, size_bytes, content_type)
        values (${store.id}, ${product.id}, 'E-bok.pdf', ${`${store.id}/${handle}/e-bok.pdf`}, 1000, 'application/pdf')`;
      await tx`update commerce.products set status = 'active' where id = ${product.id}`;
    });
  } finally {
    await db.end();
  }

  await page.goto(`/s/demo/no/p/${handle}`);
  await expect(page.getByText("Last ned rett etter betaling")).toBeVisible();
  await expect(page.getByText("Nedlastinger har ikke angrerett")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sikkerhet og produsent" })).toHaveCount(0);
  const offer = page.locator('script[type="application/ld+json"]');
  const product = (await offer.allTextContents()).map((t) => JSON.parse(t)).find((d) => JSON.stringify(d).includes(handle));
  expect(JSON.stringify(product)).not.toContain("shippingDetails");

  await page.getByRole("button", { name: "Legg i handlekurven" }).click();
  await page.getByRole("link", { name: "Gå til handlekurven" }).click();
  await expect(page.getByText("Digital nedlasting").filter({ visible: true })).toBeVisible();
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("99,00");
  await expect(summary).not.toContainText("Frakt");
  await page.getByRole("button", { name: /Fjern/ }).click();
  await expect(page.getByText("Handlekurven er tom.")).toBeVisible();
});
