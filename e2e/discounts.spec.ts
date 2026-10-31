import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** A shopper's discount code in the cart (D31). */
test("a discount code comes off the cart, says why when it cannot or cannot beside another, and comes off again", async ({ page }) => {
  const code = `E2E${Date.now().toString(36).toUpperCase()}`;
  const db = testDb();
  try {
    await db`
      insert into commerce.discount_codes (store_id, code, kind, percent, min_subtotals)
      select id, ${code}, 'percent', 10, '{"NO": 30000}'::jsonb from commerce.stores where slug = 'demo'`;
    // A code that cannot be used beside it (D299 E2), and takes more off.
    await db`
      insert into commerce.discount_codes (store_id, code, kind, amounts)
      select id, ${`${code}X`}, 'fixed', '{"NO": 5000}'::jsonb from commerce.stores where slug = 'demo'`;
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
  // The button was disabled while it sent; the focus comes back to it, not to the page (KeepFocusEverywhere, PSI ACC-02).
  await expect(summary.getByRole("button", { name: "Bruk" })).toBeFocused();
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

  // A second code that cannot be used with it: the one taking more off is used, and the cart says why of the other.
  await summary.getByLabel("Rabattkode").fill(`${code}x`);
  await summary.getByRole("button", { name: "Bruk" }).click();
  await expect(summary).toContainText(`Rabatt (${code}X)`);
  await expect(summary).toContainText("−50,00");
  await expect(summary.getByRole("alert")).toHaveText(`Kan ikke brukes sammen med ${code}X.`);
  await summary.getByRole("button", { name: `Fjern : ${code}X`, exact: true }).click();
  await expect(summary).toContainText(`Rabatt (${code})`);

  await summary.getByRole("button", { name: `Fjern : ${code}`, exact: true }).click();
  await expect(summary).not.toContainText(`Rabatt (${code})`);
  await expect(summary).toContainText("497,00");
});
