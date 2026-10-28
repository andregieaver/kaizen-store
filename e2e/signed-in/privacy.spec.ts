import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN, E2E_STORE, OWNER, READER } from "./accounts";

/**
 * The staff's privacy screens in a browser (wave 1g, D162; wave 10 unit H, D371; row international.gdpr-data-export-and-erasure). What a file
 * holds and what erasure does are held by privacy-export.int.test.ts and privacy-erasure.int.test.ts, the download route by its route test;
 * this holds the screens as staff use them: the customer's Privacy card, the file it downloads, the erase page's preview (nothing is erased
 * here), the privacy requests and the platform's retention schedule, and that a member who may only read customers is offered neither.
 */

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36).toLowerCase();
const EMAIL = `e2e-privacy-${RUN}@example.com`;
let customerId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const [customer] = await sql`
      insert into commerce.customers (store_id, email, name, phone) values (${store.id}, ${EMAIL}, 'Petra Privacy', '+47 400 00 000') returning id`;
    customerId = String(customer.id);
  } finally {
    await sql.end();
  }
});

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("downloads a customer's data from the Privacy card, as one JSON file", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/customers/${customerId}`);
    const card = page.getByRole("region", { name: "Privacy" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("The file includes internal notes about the customer");
    const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Download data" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const file = JSON.parse(await (await download.createReadStream()).toArray().then((parts) => Buffer.concat(parts).toString("utf8")));
    expect(file.schema).toBe("kaizen.customer-export");
    expect(JSON.stringify(file)).toContain(EMAIL);
  });

  test("previews what erasing would do and asks for the email before anything happens", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/customers/${customerId}`);
    await page.getByRole("region", { name: "Privacy" }).getByRole("link", { name: "Erase personal data" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/customers/${customerId}/erase`));
    await expect(page.getByRole("heading", { level: 1, name: "Erase personal data" })).toBeVisible();
    await expect(page.getByText("Erasing cannot be undone.")).toBeVisible();
    const confirm = page.getByRole("region", { name: "Confirm" });
    await expect(confirm).toContainText(EMAIL);
    await expect(confirm.getByRole("textbox")).toBeEmpty();
    // Nothing is pressed: the customer is still there, with their name.
    await page.goto(`/admin/${E2E_STORE}/customers/${customerId}`);
    await expect(page.getByText("Petra Privacy").first()).toBeVisible();
  });

  test("opens the store's privacy requests", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/privacy`);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy requests" })).toBeVisible();
  });
});

test.describe("a member who may only read customers", () => {
  test.use({ storageState: READER.state });

  test("is told downloading and erasing need more, and the erase page is not found", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/customers/${customerId}`);
    const card = page.getByRole("region", { name: "Privacy" });
    await expect(card).toContainText("Downloading or erasing a customer's data needs permission to change customers.");
    await expect(card.getByRole("button", { name: "Download data" })).toHaveCount(0);
    // The erase page is not found for them (a streamed page answers 200 with the not-found page, so its content is what is checked).
    await page.goto(`/admin/${E2E_STORE}/customers/${customerId}/erase`);
    await expect(page.getByRole("heading", { level: 1, name: "Erase personal data" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Confirm" })).toHaveCount(0);
  });
});

test.describe("the platform admin", () => {
  test.use({ storageState: ADMIN.state });

  test("reads the retention schedule", async ({ page }) => {
    await page.goto("/admin/platform/retention");
    await expect(page.getByRole("heading", { level: 1, name: "Data retention" })).toBeVisible();
    await expect(page.getByText("Orders, invoices and payments (bookkeeping)").first()).toBeVisible();
  });
});
