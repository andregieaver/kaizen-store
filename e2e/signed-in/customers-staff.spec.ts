import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Customers in the admin as staff use them (wave 10 unit C, D366; row customers.customer-profiles-notes-csv-import-and-export): adding a
 * customer through the form, changing their details, a note with its author, the merge page's refusal of the same person, the import page,
 * and a member who may only read customers offered none of it. What each writer does is held by `customer-staff.int.test.ts`.
 */

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36).toLowerCase();
const EMAIL = `e2e-staff-${RUN}@example.com`;
let customerPath = "";

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("adds a customer through the form and lands on their page", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/customers`);
    await page.getByRole("link", { name: "Add customer" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Add a customer" })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(EMAIL);
    await page.getByLabel("Name", { exact: true }).fill("Stella Staff");
    await page.getByLabel("Street address").fill("Storgata 1");
    await page.getByLabel("Postal code").fill("0155");
    await page.getByLabel("City").fill("Oslo");
    await page.getByLabel("Country code").fill("NO");
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/customers/[0-9a-f-]{36}$`));
    customerPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Stella Staff");
  });

  test("refuses the same email twice, keeping what was typed", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/customers/new`);
    await page.getByLabel("Email", { exact: true }).fill(EMAIL);
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByText("A customer with that email is already in the store.")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(EMAIL);
  });

  test("changes the details and keeps a note with its author", async ({ page }) => {
    await page.goto(customerPath);
    const edit = page.getByRole("region", { name: "Edit details" });
    await edit.getByLabel("Phone").fill("+47 400 00 123");
    await edit.getByRole("button", { name: "Save details" }).click();
    await expect(edit.getByText("Details saved.")).toBeVisible();
    const notes = page.getByRole("region", { name: "Notes" });
    await notes.getByRole("textbox").fill("Asked for invoices by email");
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(notes.getByText("Asked for invoices by email")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: "+47 400 00 123" })).toBeVisible();
  });

  test("is told a customer cannot be merged with themselves", async ({ page }) => {
    await page.goto(customerPath);
    await page.getByRole("link", { name: "Merge with another customer" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Merge customers" })).toBeVisible();
    await page.getByLabel("Email of the customer to fold in").fill(EMAIL);
    await page.getByRole("button", { name: "Show what moves" }).click();
    await expect(page.getByText("That is this customer.")).toBeVisible();
  });

  test("filters the list by a tag and opens the import page", async ({ page }) => {
    await page.goto(customerPath);
    const tags = page.getByRole("region", { name: "Tags" });
    await tags.getByRole("textbox").fill(`e2e-${RUN}`);
    await tags.getByRole("button", { name: "Add", exact: true }).click();
    await expect(tags.getByText(`e2e-${RUN}`)).toBeVisible();
    await page.goto(`/admin/${E2E_STORE}/customers?tag=e2e-${RUN}`);
    await expect(page.getByText(EMAIL)).toBeVisible();
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Import customers" })).toBeVisible();
    await expect(page.getByLabel("A CSV file of customers")).toBeVisible();
  });
});

test.describe("a member who may only read customers", () => {
  test.use({ storageState: READER.state });

  test("is offered neither adding, changing, notes nor merging", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/customers`);
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add customer" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import", exact: true })).toHaveCount(0);
    await page.goto(customerPath);
    await expect(page.getByRole("region", { name: "Notes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Edit details" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Merge with another customer" })).toHaveCount(0);
    // The add page is not found for them (a streamed page answers 200 with the not-found page, so its content is what is checked).
    await page.goto(`/admin/${E2E_STORE}/customers/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Add a customer" })).toHaveCount(0);
  });
});
