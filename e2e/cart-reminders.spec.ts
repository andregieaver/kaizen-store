import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** A cart reminder's links (D33): back to the cart as it was, and a way to stop reminders. */
test("a reminder's button brings the cart back, and its unsubscribe link asks before stopping", async ({ page }) => {
  const token = `e2e${Date.now().toString(36)}`;
  const email = `${token}@example.com`;
  const db = testDb();
  try {
    const [cart] = await db`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
      select id, 'NO', 'NOK', 'nb-NO', now() + interval '1 day' from commerce.stores where slug = 'demo'
      returning id, store_id`;
    const [variant] = await db`
      select id from commerce.product_variants where store_id = ${cart.store_id} and sku = 'DEMO-TOTE'`;
    await db`
      insert into commerce.abandoned_checkouts (store_id, cart_id, email, market_code, locale, currency, lines, subtotal_minor, token, captured_at)
      values (${cart.store_id}, ${cart.id}, ${email}, 'NO', 'nb-NO', 'NOK',
        ${db.json([{ variantId: variant.id, sellingPlanId: null, title: "Handlenett", quantity: 3, unitPriceMinor: 19900 }])},
        59700, ${token}, now() - interval '2 hours')`;
  } finally {
    await db.end();
  }

  await page.goto(`/s/demo/no/cart/restore/${token}`);
  await expect(page).toHaveURL("/s/demo/no/cart");
  await expect(page.getByLabel("Antall")).toHaveValue("3");

  await page.goto(`/s/demo/no/unsubscribe/${token}`);
  await expect(page.getByRole("heading", { level: 1, name: "Påminnelser om handlekurven" })).toBeVisible();
  await page.getByRole("button", { name: "Meld meg av" }).click();
  await expect(page.getByText("Du er meldt av.")).toBeVisible();

  const check = testDb();
  try {
    const [row] = await check`select email, clicked_at from commerce.abandoned_checkouts where token = ${token}`;
    expect(row.email).toBeNull();
    expect(row.clicked_at).not.toBeNull();
    const [optOut] = await check`select source from commerce.email_opt_outs where email = ${email}`;
    expect(optOut.source).toBe("unsubscribe");
  } finally {
    await check.end();
  }
});
