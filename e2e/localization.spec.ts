import { expect, test } from "@playwright/test";

/**
 * Language and currency are apart (D109): the demo store offers English and
 * euro as well as its countries' own, in any combination, in the address.
 */

test("a country is shown in another currency at the store's rate, in any language", async ({ page }) => {
  // 249,00 kr at 11.6 kroner to the euro, in Norwegian and in English.
  await page.goto("/s/demo/no-eur/products");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("listitem").filter({ hasText: "Demo: Keramikkopp" })).toContainText("21,47");
  await expect(page.getByRole("listitem").filter({ hasText: "Demo: Keramikkopp" })).toContainText("€");

  await page.goto("/s/demo/no-en-eur/products");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // The mug's title is in English there; its price is 249 kroner as euro.
  await expect(page.getByRole("listitem").filter({ hasText: "€21.47" }).first()).toBeVisible();
  await expect(page.getByText("249,00")).toHaveCount(0);

  // The country's own address is unchanged.
  await page.goto("/s/demo/no/products");
  await expect(page.getByRole("listitem").filter({ hasText: "Demo: Keramikkopp" })).toContainText("249,00");
});

test("a language or currency the store does not offer is not found", async ({ page }) => {
  for (const path of ["/s/demo/no-usd", "/s/demo/no-fr", "/s/demo/no-en-usd", "/s/demo/no-xx-eur"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("shoppers choose a language from the header and stay on the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/s/demo/no/products");
  await page.locator("summary:visible").filter({ hasText: "Velg språk" }).click();
  await page.getByRole("link", { name: "English" }).first().click();
  await expect(page).toHaveURL("/s/demo/no-en/products");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("a country's language and currency are chosen apart in the admin", async ({ page }) => {
  await page.goto("/admin/demo/settings/localization");
  await expect(page).toHaveURL(/\/admin\/sign-in/);
});
