import { expect, test } from "@playwright/test";

import { testDb, testStore } from "../db";
import { OWNER } from "./accounts";

/**
 * Each country's own as the owner meets it (wave 7 unit D, D338; row international.market-specific-content-adaptation), in a store of the
 * owner's own that sells in several countries (the shared store's countries are another spec's to switch): a product's description for
 * Sweden written in the editor shows on its Swedish page and not on its Norwegian one, and the builder says whose view it draws and which
 * countries a page limited in its settings is for.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

let store = { slug: "", id: "" };
let product = { id: "", handle: "" };

test.beforeAll(async () => {
  store = await testStore("land-eier", ["countries"]);
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}`;
    await sql`
      insert into commerce.store_members (store_id, account_id, role, kind)
      select ${store.id}, a.id, 'owner', 'staff' from commerce.accounts a where lower(a.email) = ${OWNER.email}
      on conflict (store_id, account_id) do update set role = 'owner'`;
    const [found] = await sql<{ id: string; handle: string }[]>`
      select p.id, p.handle from commerce.products p
       where p.store_id = ${store.id} and p.status = 'active' and p.kind = 'goods'
         and exists (select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id where v.product_id = p.id and cp.market_code = 'SE')
         and exists (select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id where v.product_id = p.id and cp.market_code = 'NO')
       order by p.created_at, p.handle limit 1`;
    expect(found).toBeTruthy();
    product = found;
  } finally {
    await sql.end();
  }
});

test("a description written for Sweden in the editor shows on the Swedish page only", async ({ page }) => {
  await page.goto(`/admin/${store.slug}/products/${product.id}`);
  const countryTexts = page.locator("[data-country-texts]");
  await countryTexts.locator("summary").click();
  await countryTexts.getByRole("textbox", { name: /Sverige|Sweden/ }).fill("Skrevet for Sverige i redigeringen.");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Saved.").first()).toBeVisible({ timeout: 30_000 });

  await expect(async () => {
    await page.goto(`/s/${store.slug}/se/p/${product.handle}`);
    await expect(page.getByText("Skrevet for Sverige i redigeringen.")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.goto(`/s/${store.slug}/no/p/${product.handle}`);
  await expect(page.getByText("Skrevet for Sverige i redigeringen.")).toHaveCount(0);
});

test("the builder names the view it draws, and a page limited to Sweden says so", async ({ page }) => {
  await page.goto(`/admin/${store.slug}/pages/new`);
  const note = page.locator("[data-view-note]");
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note).toContainText(/Norge|Norway/);
  const countries = page.getByRole("group", { name: "Countries" });
  await countries.getByRole("radio", { name: "Only some countries" }).check();
  // The store's own country is ticked first; Sweden ticked, Norway taken off.
  await countries.getByRole("checkbox", { name: /Sverige|Sweden/ }).check();
  await countries.getByRole("checkbox", { name: /Norge|Norway/ }).uncheck();
  await expect(note).toContainText(/(Sverige|Sweden) only|Bare for (Sverige|Sweden)/);
});
