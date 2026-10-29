import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN, OWNER } from "./accounts";

/**
 * The VAT screens as people use them (wave 1, D157; rows checkout.eu-vat-by-destination-vat-inclusive-prices-reduced-rates and
 * checkout.b2b-vat-id-reverse-charge-exemption): the platform admin schedules a rate on the platform's VAT page, and an owner records
 * the store's VAT registration on its tax screen and gives a product a VAT category in the product editor. The rules (who may write
 * a rate, which number is a number of the store's country, what a category does to a price) are held by the vat and tax-profile
 * tests; this holds the screens that drive them. The owner works in a store of their own, so the other specs' store is not touched.
 */

const RUN = Date.now().toString(36);
const STORE = "e2e-tax";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Tax') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Tax', null)`;
    });
    // A store in Norway, as its company details say: its own VAT number is a Norwegian one.
    await sql`update commerce.stores set country = 'NO' where slug = ${STORE}`;
  } finally {
    await sql.end();
  }
});

test("a platform admin schedules a VAT rate, which starts unverified", async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN.state });
  const page = await context.newPage();
  await page.goto("/admin/platform/vat");
  const card = page.getByRole("region", { name: "Set a rate" });
  await card.getByRole("combobox", { name: /^Country/ }).selectOption("MT");
  await card.getByRole("combobox", { name: /^Category/ }).selectOption("books");
  await card.getByLabel(/^Rate/).fill("7.5");
  await card.getByLabel(/^From/).fill("2099-01-01");
  await card.getByLabel(/^Source/).fill(`https://example.com/vat/mt/${RUN}`);
  await card.getByRole("button", { name: "Set the rate" }).click();
  await expect(card.getByText(/^The rate is set. It starts unverified/)).toBeVisible();
  await context.close();

  const sql = testDb();
  try {
    const rows = await sql`
      select rate::text as rate, verified_at is null as unverified from commerce.vat_rates
       where country_code = 'MT' and category = 'books' and valid_from = '2099-01-01' and source = ${`https://example.com/vat/mt/${RUN}`}`;
    expect(rows).toEqual([{ rate: "0.0750", unverified: true }]);
  } finally {
    await sql.end();
  }
});

test("an owner records the store's VAT registration, is refused a number that is not Norwegian, and sets a product's VAT category", async ({ browser }) => {
  const context = await browser.newContext({ storageState: OWNER.state });
  const page = await context.newPage();

  // The tax screen: registered, with a Norwegian number, saved; a Swedish number is refused for a Norwegian store.
  await page.goto(`/admin/${STORE}/settings/tax`);
  const vat = page.getByRole("region", { name: "VAT registration" });
  await vat.getByRole("checkbox", { name: /The store is registered for VAT/ }).check();
  await vat.getByLabel(/^VAT number/).fill("SE556677889901");
  await page.getByRole("button", { name: "Save the tax settings" }).click();
  await expect(page.getByText("A Norwegian VAT number is the nine-digit organisation number followed by MVA.")).toBeVisible();
  await vat.getByLabel(/^VAT number/).fill("NO923609016MVA");
  await page.getByRole("button", { name: "Save the tax settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const sql = testDb();
  try {
    const [profile] = await sql`
      select t.vat_registered, t.vat_number from commerce.store_tax_profile t join commerce.stores s on s.id = t.store_id where s.slug = ${STORE}`;
    expect(profile).toMatchObject({ vat_registered: true, vat_number: "NO923609016MVA" });

    // The product editor: a product moved to the books category, saved through the editor's own save.
    const [product] = await sql`
      select p.id from commerce.products p join commerce.stores s on s.id = p.store_id
       where s.slug = ${STORE} and p.kind = 'goods' and p.status = 'active' and p.vat_category = 'standard' order by p.handle limit 1`;
    await page.goto(`/admin/${STORE}/products/${product.id}`);
    await page.getByLabel("VAT category").selectOption("books");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByText(/^Saved\./).first()).toBeVisible();
    const [saved] = await sql`select vat_category from commerce.products where id = ${product.id}`;
    expect(saved.vat_category).toBe("books");
  } finally {
    await sql.end();
  }
  await context.close();
});
