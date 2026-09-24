import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** A shopper's discount code in the cart (D31). */
test("a discount code comes off the cart, says why when it cannot, and comes off again", async ({ page }) => {
  const code = `E2E${Date.now().toString(36).toUpperCase()}`;
  const db = testDb();
  try {
    await db`
      insert into commerce.discount_codes (store_id, code, kind, percent, min_subtotals)
      select id, ${code}, 'percent', 10, '{"NO": 30000}'::jsonb from commerce.stores where slug = 'demo'`;
  } finally {
    await db.end();
  }

  await page.goto("/s/demo/no/p/demo-handlenett");
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();
  await page.goto("/s/demo/no/cart");
  const summary = page.getByRole("complementary");

  // Unknown codes are named as such.
  await summary.getByLabel("Rabattkode").fill("finnes-ikke");
  await summary.getByRole("button", { name: "Bruk" }).click();
  await expect(summary.getByRole("alert")).toHaveText("Vi finner ingen slik kode.");
  await summary.getByRole("button", { name: /Fjern/ }).click();

  // 199,00 is below the code's 300,00 minimum.
  await summary.getByLabel("Rabattkode").fill(code.toLowerCase());
  await summary.getByRole("button", { name: "Bruk" }).click();
  await expect(summary.getByRole("alert")).toContainText("300,00");

  // With two, 10 % comes off: 398,00 − 39,80 + 99,00 shipping.
  await page.getByLabel("Antall").fill("2");
  await page.getByRole("button", { name: "Oppdater" }).click();
  await expect(summary).toContainText(`Rabatt (${code})`);
  await expect(summary).toContainText("−39,80");
  await expect(summary).toContainText("457,20");

  await summary.getByRole("button", { name: /Fjern/ }).click();
  await expect(summary).not.toContainText(`Rabatt (${code})`);
  await expect(summary).toContainText("497,00");
});
