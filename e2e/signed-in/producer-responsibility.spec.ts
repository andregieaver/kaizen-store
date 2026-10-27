import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Producer responsibility as the owner meets it (wave 7 unit H, D342; row international.packaging-and-epr-registers): a product ticked as
 * packaging with no registration recorded in Norway is warned of and still sold; the owner adds the Norwegian registration from that warning,
 * with a last day in the past, and the page then says the product is not sold there now; changed to open-ended, it is valid and nothing is held
 * back. The rules are held by producer-registrations.test.ts, producer-registrations.int.test.ts and the euro scenario in
 * checkout-kinds.int.test.ts; this holds the screen.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

let storeId = "";
let product = { id: "", title: "" };

const address = () => `/admin/${E2E_STORE}/settings/producer-responsibility`;

/** Two days back as a date field takes it: in the past in any of the store's time zones. */
const pastDay = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
};

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    await sql`delete from commerce.producer_registrations where store_id = ${storeId}`;
    // An active product of goods, ticked as packaging (as every new product is by default).
    const [found] = await sql<{ id: string; title: string }[]>`
      select p.id, t.title from commerce.products p
        join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
       where p.store_id = ${storeId} and p.status = 'active' and p.kind = 'goods'
       order by p.created_at, p.handle limit 1`;
    expect(found).toBeTruthy();
    product = found;
    await sql`insert into commerce.product_schemes (store_id, product_id, scheme) values (${storeId}, ${product.id}, 'packaging') on conflict do nothing`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.producer_registrations where store_id = ${storeId}`;
  } finally {
    await sql.end();
  }
});

test("warns of a scheme with no registration recorded, and stops sales once a recorded registration has ended", async ({ page }) => {
  await page.goto(address());
  await expect(page.getByRole("heading", { name: "Producer responsibility", level: 1 })).toBeVisible();
  // Nothing on record: warned of, still sold.
  await expect(page.getByTestId("producer-nothing-blocked")).toBeVisible();
  const warnings = page.getByRole("list", { name: "No registration recorded" });
  const norway = warnings.getByRole("listitem").filter({ hasText: "Packaging in Norway" });
  await expect(norway).toContainText(product.title);

  // The owner adds Norway's registration from the warning, with a last day in the past.
  await norway.getByRole("link", { name: "Add the registration" }).click();
  await expect(page.getByLabel("Scheme")).toHaveValue("packaging");
  await expect(page.getByLabel("Country")).toHaveValue("NO");
  await page.getByLabel("Registration number").fill("NO-EMB-E2E-1");
  await page.getByLabel("Registered with").fill("Miljødirektoratet");
  await page.getByLabel("Valid from").fill("2020-01-01");
  await page.getByLabel("Valid to (optional)").fill(pastDay());
  await page.getByRole("button", { name: "Save registration" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Now on record and ended: not sold in Norway now.
  await page.goto(address());
  const blocked = page.getByRole("list", { name: "Not sold now" });
  await expect(blocked.getByRole("listitem").filter({ hasText: "Packaging in Norway" })).toContainText(product.title);
  const registrations = page.getByRole("list", { name: "Registrations" });
  const row = registrations.getByRole("listitem").filter({ hasText: "NO-EMB-E2E-1" });
  await expect(row).toContainText("Ended");

  // Changed to open-ended: valid, and nothing is held back.
  await row.getByRole("link", { name: "Change" }).click();
  await expect(page.getByRole("heading", { name: "Change a registration" })).toBeVisible();
  await page.getByLabel("Valid to (optional)").fill("");
  await page.getByRole("button", { name: "Save registration" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto(address());
  await expect(page.getByTestId("producer-nothing-blocked")).toBeVisible();
  await expect(page.getByRole("list", { name: "Registrations" }).getByRole("listitem").filter({ hasText: "NO-EMB-E2E-1" })).toContainText("Valid");
});
