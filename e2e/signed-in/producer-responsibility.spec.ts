import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Producer responsibility as the owner meets it (wave 7 unit H, D342; row international.packaging-and-epr-registers): a product ticked for
 * a scheme (tyres) with no registration in Norway is not sold there (the owner's decision of 27 October 2026); the owner adds the Norwegian
 * registration from that list, with a last day in the past, and the product is still not sold there; changed to open-ended, it is valid and
 * nothing is held back. The rules are held by producer-registrations.test.ts, producer-registrations.int.test.ts and the euro scenario in
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
    // One product under a scheme no other product of the shared store is under (tyres), so the minutes its registration has ended stop
    // the sale of this product alone, never the goods the other signed-in specs buy; the thermos cup, which none of them uses.
    const [found] = await sql<{ id: string; title: string }[]>`
      select p.id, t.title from commerce.products p
        join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
       where p.store_id = ${storeId} and p.handle = 'demo-termokopp'`;
    expect(found).toBeTruthy();
    product = found;
    await sql`delete from commerce.product_schemes where store_id = ${storeId} and scheme = 'tyres'`;
    await sql`insert into commerce.product_schemes (store_id, product_id, scheme) values (${storeId}, ${product.id}, 'tyres') on conflict do nothing`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.producer_registrations where store_id = ${storeId}`;
    await sql`delete from commerce.product_schemes where store_id = ${storeId} and scheme = 'tyres'`;
  } finally {
    await sql.end();
  }
});

test("holds back a ticked scheme with no valid registration, recorded or not, until one is valid", async ({ page }) => {
  await page.goto(address());
  await expect(page.getByRole("heading", { name: "Producer responsibility", level: 1 })).toBeVisible();
  // Nothing on record: not sold in Norway.
  const held = page.getByRole("list", { name: "Not sold now" });
  const norway = held.getByRole("listitem").filter({ hasText: "Tyres in Norway" });
  await expect(norway).toContainText(product.title);
  await expect(page.getByRole("list", { name: "No registration recorded" })).toHaveCount(0);

  // The owner adds Norway's registration from the list, with a last day in the past.
  // The link names the scheme and the country; the form is drawn anew for them (its key), so the test opens the address and fills
  // the form it lands on rather than one a client navigation is about to replace.
  const add = norway.getByRole("link", { name: "Add the registration" });
  await expect(add).toHaveAttribute("href", /scheme=tyres&market=NO#registration-form$/);
  await page.goto((await add.getAttribute("href"))!);
  await expect(page.getByLabel("Scheme")).toHaveValue("tyres");
  await expect(page.getByRole("combobox", { name: /^Country/ })).toHaveValue("NO");
  await page.getByLabel("Registration number").fill("NO-EMB-E2E-1");
  await page.getByLabel("Registered with").fill("Miljødirektoratet");
  await page.getByLabel("Valid from").fill("2020-01-01");
  await page.getByLabel("Valid to (optional)").fill(pastDay());
  await page.getByRole("button", { name: "Save registration" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // On record but ended: still not sold in Norway now.
  await page.goto(address());
  const blocked = page.getByRole("list", { name: "Not sold now" });
  await expect(blocked.getByRole("listitem").filter({ hasText: "Tyres in Norway" })).toContainText(product.title);
  const registrations = page.getByRole("list", { name: "Registrations" });
  const row = registrations.getByRole("listitem").filter({ hasText: "NO-EMB-E2E-1" });
  await expect(row).toContainText("Ended");

  // Changed to open-ended: valid, and the product is sold in Norway again (the store's other countries have none, so they still hold it back).
  await row.getByRole("link", { name: "Change" }).click();
  await expect(page.getByRole("heading", { name: "Change a registration" })).toBeVisible();
  await page.getByLabel("Valid to (optional)").fill("");
  await page.getByRole("button", { name: "Save registration" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto(address());
  await expect(page.getByRole("list", { name: "Not sold now" }).getByRole("listitem").filter({ hasText: "Tyres in Norway" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Registrations" }).getByRole("listitem").filter({ hasText: "NO-EMB-E2E-1" })).toContainText("Valid");
});
