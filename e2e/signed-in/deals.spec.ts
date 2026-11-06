import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Deals and pipelines (S2, D464) as an owner uses them: Deals offered to the store as a pilot is switched on under Features; the board
 * shows the first pipeline's stages and Won and Lost; a deal is added for a customer found by name, moved on its page, won, and deleted.
 * The store is left as it was found: Deals switched off again and the pilot closed.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PERSON = `deal-buyer-${run}@example.com`;
const NAME = `Dina Deal ${run}`;
let salesWasOn = false;

async function deals(page: Page, on: boolean) {
  await page.goto(`/admin/${E2E_STORE}/settings/features`);
  const toggle = page.getByRole("switch", { name: "Deals", exact: true });
  if ((await toggle.getAttribute("aria-checked")) === String(on)) return;
  await toggle.click();
  if (!on) {
    const confirm = page.getByRole("region", { name: "Switch off Deals" }).getByRole("button", { name: "Switch off", exact: true });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(on), { timeout: 30_000 });
}

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id, 'sales' = any(features) as sales from commerce.stores where slug = ${E2E_STORE}`;
    salesWasOn = Boolean(store.sales);
    await sql`update commerce.stores set sales_pilot = true where slug = ${E2E_STORE}`;
    await sql`insert into commerce.customers (store_id, email, name) values (${String(store.id)}, ${PERSON}, ${NAME})`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: OWNER.state });
  if (!salesWasOn) await deals(page, false);
  await page.close();
  const sql = testDb();
  try {
    await sql`update commerce.stores set sales_pilot = false where slug = ${E2E_STORE}`;
  } finally {
    await sql.end();
  }
});

test("an owner switches Deals on, adds a deal for a customer, moves it, wins it and deletes it", async ({ page }) => {
  await deals(page, true);

  await page.goto(`/admin/${E2E_STORE}/deals`);
  await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
  const board = page.getByRole("region", { name: "The board of deals" });
  for (const column of ["New", "Talking", "Quote sent", "Won", "Lost"]) await expect(board.getByRole("heading", { name: column, exact: true })).toBeVisible();

  await page.getByRole("link", { name: "New deal" }).click();
  await page.getByLabel("What they might buy").fill(`Tote bags ${run}`);
  await page.getByRole("searchbox", { name: "Search by name, email or company" }).fill(NAME);
  await page.getByRole("button", { name: new RegExp(NAME) }).click();
  await page.getByLabel(/^Estimate in/).fill("12 500");
  await page.getByRole("button", { name: "Add the deal" }).click();

  await expect(page.getByRole("heading", { level: 1, name: `Tote bags ${run}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The estimate, until something is linked.")).toBeVisible();
  await page.getByLabel("Move to").selectOption({ label: "Talking" });
  await expect(page.getByRole("status").filter({ hasText: "Moved to Talking." })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Won", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved to Won." })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Open again" })).toBeVisible();
  await expect(page.getByText("Entered Talking")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete the deal" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/deals$`), { timeout: 30_000 });
  await expect(page.getByRole("link", { name: `Tote bags ${run}` })).toHaveCount(0);
});
