import { expect, test } from "@playwright/test";

/**
 * Selling on backorder (wave 3, D172, `docs/wave-3-inventory.md` 2.1, criteria B1 and B6). The seeded demo store has a thermos with nothing in
 * stock that keeps selling ("expected to ship within 7 days") and a lamp with nothing in stock that does not. The sentences are hand-written
 * and flagged for legal review; this test holds that they are shown before the cart, in the cart and in the structured data, and that a
 * variant that stops at zero is unchanged.
 */

const THERMOS = "/s/demo/no/p/demo-termokopp";
const LAMP = "/s/demo/no/p/demo-bordlampe";

const offers = async (page: import("@playwright/test").Page): Promise<string[]> => {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((text) => [...text.matchAll(/"availability":"([^"]+)"/g)].map((match) => match[1]));
};

test("a variant that keeps selling at zero says it is on backorder, is bought, and the cart says how many and within how many days", async ({ page }) => {
  await page.goto(THERMOS);

  // Said on the product page, before the cart: the days the store states, never "sold out" and never "in stock".
  const note = page.getByText("På restordre: forventes sendt innen 7 dager").filter({ visible: true }).first();
  await expect(note).toBeVisible();
  await expect(page.getByText("Utsolgt").filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("På lager").filter({ visible: true })).toHaveCount(0);

  // The button is enabled and the add is accepted although nothing is in stock.
  const add = page.getByRole("button", { name: "Legg i handlekurven", disabled: false }).first();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." }).first()).toBeVisible();

  await page.goto("/s/demo/no/cart");
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  // One unit, none in stock: the line is fine and says so in words, not as an error.
  await expect(page.getByText("1 på restordre: forventes sendt innen 7 dager").filter({ visible: true })).toBeVisible();
  await expect(page.getByText(/Bare .* igjen|Ikke nok på lager/).filter({ visible: true })).toHaveCount(0);

  // Any quantity up to the line's maximum (20, the field's own limit), where a variant that stops at zero would be settled on its stock.
  await page.getByLabel("Antall").fill("5");
  await page.getByRole("button", { name: "Oppdater" }).click();
  await expect(page.getByLabel("Antall")).toHaveValue("5");
  await expect(page.getByText("5 på restordre: forventes sendt innen 7 dager").filter({ visible: true })).toBeVisible();
  // The price is the same per unit as for any line: 5 x 349 kr, with VAT included as always.
  await expect(page.getByRole("complementary")).toContainText(/1\s745,00/);

  await page.getByLabel("Antall").fill("20");
  await page.getByRole("button", { name: "Oppdater" }).click();
  await expect(page.getByLabel("Antall")).toHaveValue("20");
  await expect(page.getByText("20 på restordre: forventes sendt innen 7 dager").filter({ visible: true })).toBeVisible();
});

test("the structured data says BackOrder for it and OutOfStock for a variant that stops at zero", async ({ page }) => {
  await page.goto(THERMOS);
  await expect.poll(() => offers(page)).toEqual(["https://schema.org/BackOrder"]);
  await page.goto(LAMP);
  await expect.poll(() => offers(page)).toEqual(["https://schema.org/OutOfStock"]);
});

test("a variant that stops at zero is as it was: sold out, and it cannot be added", async ({ page }) => {
  await page.goto(LAMP);
  await expect(page.getByText("Utsolgt").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/restordre/).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Legg i handlekurven" }).first()).toBeDisabled();
});

test("the sentence is in the market's language, by hand, in Swedish and Danish too", async ({ page }) => {
  await page.goto("/s/demo/se/p/demo-termokopp");
  await expect(page.getByText("På restorder: förväntas skickas inom 7 dagar").filter({ visible: true }).first()).toBeVisible();
  await page.goto("/s/demo/dk/p/demo-termokopp");
  await expect(page.getByText("På restordre: forventes afsendt inden for 7 dage").filter({ visible: true }).first()).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });

  test("the slide-out cart carries the backorder line too", async ({ page }) => {
    await page.goto("/s/demo/se/p/demo-termokopp");
    await page.getByRole("button", { name: "Lägg i varukorgen", disabled: false }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Tillagd i varukorgen." }).first()).toBeVisible();

    await page.locator("header").getByRole("link", { name: /Varukorg/ }).click();
    const drawer = page.getByRole("dialog", { name: "Varukorg" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("1 på restorder: förväntas skickas inom 7 dagar")).toBeVisible();
  });
});
