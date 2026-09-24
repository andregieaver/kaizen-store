import { expect, test } from "@playwright/test";

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
