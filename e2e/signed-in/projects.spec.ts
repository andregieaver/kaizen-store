import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Projects and checklists (D903) as an owner uses them: the feature is switched on under Features; a checklist is made, tasks are added with
 * Enter and one is ticked below the Done line; a project is made, a checklist added to it, and a task moved to the next stage on its board
 * with the keyboard's way (*Move to*). The store is left as it was found: its projects and lists deleted, the feature switched off again.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const LIST = `Opening ${run}`;
const PROJECT = `Launch ${run}`;
let wasOn = false;

async function projects(page: Page, on: boolean) {
  await page.goto(`/admin/${E2E_STORE}/settings/features`);
  const toggle = page.getByRole("switch", { name: "Projects", exact: true });
  if ((await toggle.getAttribute("aria-checked")) === String(on)) return;
  await toggle.click();
  if (!on) {
    const confirm = page.getByRole("region", { name: "Switch off Projects" }).getByRole("button", { name: "Switch off", exact: true });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(on), { timeout: 30_000 });
}

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select 'projects' = any(features) as on from commerce.stores where slug = ${E2E_STORE}`;
    wasOn = Boolean(store.on);
  } finally {
    await sql.end();
  }
});

test.afterAll(async ({ browser }) => {
  const sql = testDb();
  try {
    await sql`delete from commerce.projects where name = ${PROJECT}`;
    await sql`delete from commerce.checklists where title in (${LIST}, ${`Campaign ${run}`})`;
  } finally {
    await sql.end();
  }
  const page = await browser.newPage({ storageState: OWNER.state });
  if (!wasOn) await projects(page, false);
  await page.close();
});

test("an owner makes a checklist, adds tasks with Enter and ticks one off", async ({ page }) => {
  await projects(page, true);
  await page.goto(`/admin/${E2E_STORE}/checklists`);
  await expect(page.getByRole("heading", { level: 1, name: "Checklists" })).toBeVisible();
  await page.getByRole("button", { name: "New checklist" }).first().click();
  await page.getByLabel("Title").fill(LIST);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: LIST })).toBeVisible({ timeout: 30_000 });

  const add = page.getByLabel("Add a task");
  for (const task of ["Unlock the door", "Count the till"]) {
    await add.fill(task);
    await add.press("Enter");
    await expect(page.getByRole("button", { name: `Open ${task}` })).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("checkbox", { name: "Unlock the door done" }).check();
  await expect(page.getByRole("button", { name: "Fold Done" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 of 2 done")).toBeVisible();
});

test("an owner makes a project, adds a checklist and moves a task on the board", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/projects`);
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill(PROJECT);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PROJECT })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Add a checklist" }).first().click();
  await page.getByLabel("Title").fill(`Campaign ${run}`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Campaign ${run}` })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Add a task").fill("Write the banner");
  await page.getByLabel("Add a task").press("Enter");
  await expect(page.getByRole("button", { name: "Open Write the banner" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: PROJECT }).first().click();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  const doing = page.getByRole("region", { name: "In progress" });
  await page.getByRole("combobox", { name: "Move Write the banner to" }).selectOption({ label: "In progress" });
  await expect(doing.getByRole("link", { name: "Write the banner" })).toBeVisible({ timeout: 30_000 });
});
