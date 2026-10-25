import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Collections in depth as the owner works them (wave 6 unit A, D319; rows catalogue.collections-manual and
 * catalogue.smart-rule-based-collections): a category's description written in its panel and shown above its products on its page, and a tag
 * filled by rules with the live count of what it holds, its page listing what the rules hold. The server side is held by
 * collections.int.test.ts; this holds the screens that drive it and the page shoppers see.
 */

test.use({ storageState: OWNER.state });

const CATEGORY = { name: "E2E Lamper", slug: "e2e-lamper" };
const TAG = { name: "E2E Utvalgt", slug: "e2e-utvalgt" };
const PICTURE = "/demo/lamp.svg";
let storefront = "";
let titles: string[] = [];

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    // A run that stopped half-way leaves its terms: they are made again from nothing.
    await sql`delete from commerce.terms where store_id = ${store.id} and slug in (${CATEGORY.slug}, ${TAG.slug})`;
    const products = await sql<{ id: string; title: string }[]>`
      select p.id, t.title from commerce.products p
        join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
       where p.store_id = ${store.id} and p.status = 'active' and p.kind = 'goods'
         and exists (select 1 from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id where v.product_id = p.id)
       order by p.created_at, p.handle limit 2`;
    expect(products).toHaveLength(2);
    titles = products.map((p) => p.title);
    // Its picture from the library is set here (the upload is held by the media library's own tests); the panel writes the description.
    const [category] = await sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug, image_url)
      values (${store.id}, 'product', 'category', ${CATEGORY.name}, ${CATEGORY.slug}, ${PICTURE}) returning id`;
    for (const product of products) {
      await sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${store.id}, ${product.id}, ${category.id})`;
    }
    await sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${store.id}, 'product', 'tag', ${TAG.name}, ${TAG.slug})`;
    const [market] = await sql`select code from commerce.markets where store_id = ${store.id} and active order by created_at, code limit 1`;
    storefront = `/s/${E2E_STORE}/${String(market.code).toLowerCase()}`;
  } finally {
    await sql.end();
  }
});

test("writes a category's description in its panel, and its page shows it above its products", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products/categories`);
  await page.getByRole("button", { name: `Change category ${CATEGORY.name}`, exact: true }).click();
  const form = page.getByRole("form", { name: new RegExp(CATEGORY.name) });
  const description = form.getByRole("textbox", { name: "Description", exact: true });
  await description.click();
  await page.keyboard.type("Lys til lange kvelder.");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);

  await page.goto(`${storefront}/category/${CATEGORY.slug}`);
  const header = page.locator("[data-term-header]");
  await expect(header.getByRole("heading", { level: 1, name: CATEGORY.name })).toBeVisible();
  await expect(header.getByText("Lys til lange kvelder.")).toBeVisible();
  await expect(header.locator(`img[src="${PICTURE}"]`)).toBeVisible();
  // Its metadata: the description's first sentence and its own picture to share.
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Lys til lange kvelder\./);
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", new RegExp(`${PICTURE.replace(/\./g, "\\.")}$`));
  for (const title of titles) await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});

test("fills a tag by rules with the count of what it holds, and its page lists what the rules hold", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products/categories`);
  await page.getByRole("button", { name: `Change tag ${TAG.name}`, exact: true }).click();
  const form = page.getByRole("form", { name: new RegExp(TAG.name) });
  await form.getByRole("checkbox", { name: /Fill this automatically/ }).check();
  // The first condition is "in a category or tag": the category above, by hand.
  await form.getByRole("combobox", { name: "In a category or tag" }).last().selectOption({ label: CATEGORY.name });
  await expect(form.getByRole("status").filter({ hasText: /match/ })).toHaveText("2 products match");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText("Filled by rules: 1 condition")).toBeVisible();

  await page.goto(`${storefront}/tag/${TAG.slug}`);
  await expect(page.locator("[data-term-header]").getByRole("heading", { level: 1, name: TAG.name })).toBeVisible();
  for (const title of titles) await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});
