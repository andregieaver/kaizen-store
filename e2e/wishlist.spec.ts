import { expect, test } from "@playwright/test";

/** Wishlists (D34): the heart, lists, moving between them, and to the cart. */
test("a shopper saves products with the heart, sorts them into lists and adds a list to the cart", async ({ page }) => {
  await page.goto("/s/demo/no");
  const heart = page.getByRole("button", { name: "Lagre Demo: Handlenett i lerret i ønskelisten" });
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Lagret i ønskelisten." }).first()).toBeAttached();

  // On the product page the heart knows, and a second product joins the list.
  await page.goto("/s/demo/no/p/demo-handlenett");
  await expect(page.getByRole("button", { name: /i ønskelisten$/ })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/s/demo/no/p/demo-bordlampe");
  await page.getByRole("button", { name: /i ønskelisten$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lagret i ønskelisten." }).first()).toBeAttached();

  await page.getByRole("link", { name: "Ønskeliste" }).first().click();
  await expect(page).toHaveURL("/s/demo/no/wishlist");
  await expect(page.getByRole("heading", { level: 2, name: "Ønskeliste" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Demo: Handlenett i lerret" })).toBeVisible();

  // A new list, and the lamp moves there.
  await page.getByRole("button", { name: "+ Ny liste" }).click();
  await page.getByLabel("Navn på listen").fill("Stua");
  await page.getByRole("button", { name: "Opprett" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Stua" })).toBeVisible();
  await page.getByRole("navigation", { name: "Dine lister" }).getByRole("link", { name: /^Ønskeliste/ }).click();
  await page.getByRole("checkbox", { name: "Velg Demo: Bordlampe" }).check();
  await page.getByLabel("Flytt valgte til").selectOption({ label: "Stua" });
  await page.getByRole("button", { name: "Flytt", exact: true }).click();
  await expect(page.getByText("1 vare flyttet til Stua.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Demo: Bordlampe" })).toHaveCount(0);

  // Into the cart, and the list lets go of it as chosen.
  await page.getByLabel("Fjern dem fra listen").check();
  await page.getByRole("button", { name: "Legg alle i handlekurven" }).click();
  await expect(page.getByText("1 vare lagt i handlekurven.")).toBeVisible();
  await expect(page.getByText("Listen er tom.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();
});
