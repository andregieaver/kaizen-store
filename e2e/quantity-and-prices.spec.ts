import { expect, test, type Page } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * How many to buy (D430) and how prices are written (D429), as shoppers meet them. Each test has a store of its own, changed with SQL before
 * its first request (its catalogue is cached from then on). The rules themselves are held by `quantity-stepper.test.ts`, `price-words.test.ts`,
 * `money.test.ts` and the database's checks in `commerce.test.ts`; this holds the pages.
 */

/** A store of the template's catalogue, with its row and its tote bag's changed first. */
async function storeWith(name: string, change: (sql: ReturnType<typeof testDb>, id: string) => Promise<unknown>): Promise<string> {
  const { slug, id } = await testStore(name);
  const sql = testDb();
  try {
    await change(sql, id);
  } finally {
    await sql.end();
  }
  return slug;
}

const tote = (page: Page, slug: string) => page.goto(`/s/${slug}/p/demo-handlenett`);

test("the shopper chooses how many with − and +, and the cart takes it and saves a change by itself", async ({ page }) => {
  const { slug } = await testStore("antall");
  await tote(page, slug);

  const quantity = page.getByRole("spinbutton", { name: "Antall" });
  const less = page.getByRole("button", { name: "Reduser antall" });
  const more = page.getByRole("button", { name: "Øk antall" });
  await expect(quantity).toHaveValue("1");
  await expect(less).toBeDisabled();
  await more.click();
  await more.click();
  await expect(quantity).toHaveValue("3");
  await less.click();
  await expect(quantity).toHaveValue("2");
  // Thumb-sized: 44 px each way.
  const box = await more.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(page.getByRole("link", { name: "Handlekurv (2)" })).toBeVisible();

  await page.goto(`/s/${slug}/cart`);
  const line = page.getByRole("spinbutton", { name: /^Antall/ });
  await expect(line).toHaveValue("2");
  // No Update button where the page has its script: a press is saved by itself, and the totals follow.
  await expect(page.getByRole("button", { name: "Oppdater" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Øk antall/ }).click();
  await expect(line).toHaveValue("3");
  await expect(page.getByRole("link", { name: "Handlekurv (3)" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: /^Antall/ })).toHaveValue("3");
  // Typed and Enter: saved at once.
  await page.getByRole("spinbutton", { name: /^Antall/ }).fill("1");
  await page.getByRole("spinbutton", { name: /^Antall/ }).press("Enter");
  await expect(page.getByRole("link", { name: "Handlekurv (1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reduser antall/ })).toBeDisabled();
});

test("the chooser follows the quantity rule: its minimum, its steps, and a typed number put right", async ({ page }) => {
  const slug = await storeWith("antall-regel", (sql, id) =>
    sql`update commerce.product_variants v set min_quantity = 6, quantity_step = 6, max_quantity = 24
        from commerce.products p where p.id = v.product_id and p.store_id = ${id} and p.handle = 'demo-handlenett'`,
  );
  await tote(page, slug);
  const quantity = page.getByRole("spinbutton", { name: "Antall" });
  await expect(quantity).toHaveValue("6");
  await expect(page.getByRole("button", { name: "Reduser antall" })).toBeDisabled();
  await page.getByRole("button", { name: "Øk antall" }).click();
  await expect(quantity).toHaveValue("12");
  // 7 is not a multiple of 6: leaving the field puts the nearest one there.
  await quantity.fill("7");
  await quantity.press("Tab");
  await expect(quantity).toHaveValue("6");
  await quantity.fill("100");
  await quantity.press("Tab");
  await expect(quantity).toHaveValue("24");
  await expect(page.getByRole("button", { name: "Øk antall" })).toBeDisabled();
});

test("a store may offer the number alone, or no chooser at all", async ({ page }) => {
  const boxed = await storeWith("antall-boks", (sql, id) => sql`update commerce.stores set quantity_picker = 'box' where id = ${id}`);
  await tote(page, boxed);
  await expect(page.getByRole("spinbutton", { name: "Antall" })).toHaveValue("1");
  await expect(page.getByRole("button", { name: "Øk antall" })).toHaveCount(0);

  const hidden = await storeWith("antall-skjult", (sql, id) => sql`update commerce.stores set quantity_picker = 'hidden' where id = ${id}`);
  await tote(page, hidden);
  await expect(page.getByRole("button", { name: "Legg i handlekurven" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Antall" })).toHaveCount(0);
});

test("prices without ,00 on whole amounts, with the owner's words around a product's price only", async ({ page }) => {
  const slug = await storeWith("priser", async (sql, id) => {
    await sql`update commerce.stores set price_decimals = 'hide_whole', price_words = ${sql.json({ "nb-NO": { prefix: "Kun", suffix: "/stk" } })} where id = ${id}`;
    // The notebook shows no words, whatever the store's.
    await sql`update commerce.products set price_words = ${sql.json({ mode: "none" })} where store_id = ${id} and handle = 'demo-notatbok'`;
  });
  await tote(page, slug);
  const main = page.getByRole("main");
  await expect(main).toContainText(/Kun 199\s+kr\/stk/);
  await expect(main).not.toContainText("199,00");

  await page.goto(`/s/${slug}/p/demo-notatbok`);
  await expect(page.getByRole("main")).toContainText(/129\s+kr/);
  await expect(page.getByRole("main")).not.toContainText("Kun 129");

  // The cart's lines and totals: the store's decimals, never the words.
  await tote(page, slug);
  await page.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(page.getByRole("link", { name: "Handlekurv (1)" })).toBeVisible();
  await page.goto(`/s/${slug}/cart`);
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText(/199\s+kr/);
  await expect(summary).not.toContainText(",00");
  const line = page.getByRole("listitem").filter({ has: page.getByRole("spinbutton", { name: /^Antall/ }) });
  await expect(line).toContainText(/199\s+kr/);
  await expect(line).not.toContainText("/stk");
  await expect(line).not.toContainText("Kun");
});

test("a country keeps its decimals where the store leaves them off", async ({ page }) => {
  const slug = await storeWith("priser-land", async (sql, id) => {
    await sql`update commerce.stores set price_decimals = 'hide_whole' where id = ${id}`;
    await sql`update commerce.markets set price_decimals = 'always' where store_id = ${id} and code = 'NO'`;
  });
  await tote(page, slug);
  await expect(page.getByRole("main")).toContainText("199,00");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the cart's quantity is a number and an Update button", async ({ page }) => {
    const token = `e2eq${Date.now().toString(36)}`;
    const slug = await storeWith("antall-uten-js", async (sql, id) => {
      const [cart] = await sql`
        insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
        values (${id}, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`;
      const [variant] = await sql`
        select v.id from commerce.product_variants v join commerce.products p on p.id = v.product_id
        where p.store_id = ${id} and p.handle = 'demo-handlenett' limit 1`;
      await sql`
        insert into commerce.abandoned_checkouts (store_id, cart_id, email, market_code, locale, currency, lines, subtotal_minor, token, captured_at)
        values (${id}, ${cart.id}, ${`${token}@example.com`}, 'NO', 'nb-NO', 'NOK',
          ${sql.json([{ variantId: variant.id, sellingPlanId: null, title: "Handlenett", quantity: 1, unitPriceMinor: 19900 }])},
          19900, ${token}, now() - interval '2 hours')`;
    });
    await page.goto(`/s/${slug}/cart/restore/${token}`);
    await expect(page).toHaveURL(`/s/${slug}/cart`);
    const quantity = page.getByRole("spinbutton", { name: /^Antall/ });
    await expect(quantity).toHaveValue("1");
    // − and + need the script: they stay switched off, and the number and Update do the work.
    await expect(page.getByRole("button", { name: /^Øk antall/ })).toBeDisabled();
    await quantity.fill("2");
    await page.getByRole("button", { name: "Oppdater" }).click();
    await expect(page.getByRole("spinbutton", { name: /^Antall/ })).toHaveValue("2");
  });
});
