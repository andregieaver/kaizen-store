import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Projects and checklists (D903) as an owner uses them: the feature is switched on under Features; a checklist is made, tasks are added with
 * Enter and one is ticked below the Done line; the list made Advanced, a task set to repeat every day, ticked (its run shows) and the tick
 * undone; the list filtered by status, its open task found under All tasks, and the list duplicated under a name of its own; a tag made on Statuses, given to a task, and the task commented
 * on; a project is made, a checklist added to it, and a task moved to the next stage on its board
 * with the keyboard's way (*Move to*). The store is left as it was found: its projects and lists deleted, the feature switched off again.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const LIST = `Opening ${run}`;
const PROJECT = `Launch ${run}`;
const TAG = `Fragile ${run}`;
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

/** A task added with Enter, typed again until the page has woken (a field filled before then is emptied by React). */
async function addTask(page: Page, title: string) {
  const field = page.getByLabel("Add a task");
  await expect(async () => {
    await field.fill(title);
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await field.press("Enter");
  await expect(page.getByRole("button", { name: `Open ${title}` })).toBeVisible({ timeout: 30_000 });
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
    await sql`delete from commerce.project_labels where name = ${TAG}`;
    await sql`delete from commerce.checklists where title in (${LIST}, ${`${LIST} (copy)`}, ${`Campaign ${run}`})`;
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

  for (const task of ["Unlock the door", "Count the till"]) await addTask(page, task);
  await page.getByRole("checkbox", { name: "Unlock the door done" }).check();
  await expect(page.getByRole("button", { name: "Fold Done" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 of 2 done")).toBeVisible();
});

test("an owner makes a task repeat every day, ticks it off and undoes the tick", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/checklists`);
  await page.getByRole("link", { name: LIST }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: LIST })).toBeVisible({ timeout: 30_000 });
  const listUrl = page.url();
  await page.getByRole("link", { name: "Customise" }).click();
  const advanced = page.getByRole("switch", { name: /^Advanced list/ });
  await advanced.check();
  await expect(advanced).toBeChecked({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: "Repeats" })).toBeChecked();

  await page.goto(listUrl);
  await page.getByRole("button", { name: "Open Count the till" }).click();
  await page.getByLabel("Repeats").selectOption("daily");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Every day", { exact: true })).toBeVisible({ timeout: 30_000 });

  const tick = page.getByRole("checkbox", { name: "Count the till done" });
  await tick.check();
  await expect(page.getByText("1 in a row")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(tick).not.toBeChecked({ timeout: 30_000 });
  await expect(page.getByText("1 in a row")).toHaveCount(0);
});

test("an owner filters the list by status and duplicates it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/checklists`);
  await page.getByRole("link", { name: LIST }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: LIST })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("group", { name: "Status", exact: true }).getByRole("button", { name: "Done: 1" }).click();
  await expect(page.getByText("Showing 1 of 2 tasks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Count the till" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("button", { name: "Open Count the till" })).toBeVisible();

  await page.goto(`/admin/${E2E_STORE}/checklists?view=tasks`);
  const ours = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: LIST, exact: true }) });
  await expect(ours.getByRole("checkbox", { name: "Count the till done" })).toBeVisible({ timeout: 30_000 });
  await expect(ours.getByRole("checkbox", { name: "Unlock the door done" })).toHaveCount(0);
  await page.goto(`/admin/${E2E_STORE}/checklists`);
  await page.getByRole("link", { name: LIST, exact: true }).first().click();
  await page.locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByLabel("Name of the copy")).toHaveValue(`${LIST} (copy)`);
  await page.getByRole("button", { name: "Make the copy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${LIST} (copy)` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("0 of 2 done")).toBeVisible();
});

test("an owner makes a tag, gives it to a task and comments on the task", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/projects/statuses`);
  await page.getByRole("button", { name: "Add a tag" }).click();
  await expect(page.locator('input[value="New tag"]')).toBeVisible({ timeout: 30_000 });
  // The Tags card is the page's last, and a new tag goes to its end.
  const fresh = page.getByRole("textbox", { name: "Name" }).last();
  await fresh.fill(TAG);
  await fresh.press("Tab");
  await expect(page.locator(`input[value="${TAG}"]`)).toBeVisible({ timeout: 30_000 });

  await page.goto(`/admin/${E2E_STORE}/checklists`);
  await page.getByRole("link", { name: LIST, exact: true }).first().click();
  await page.getByRole("button", { name: "Open Count the till" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("button", { name: TAG }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(TAG, { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open Count the till" }).click();
  await editor.getByLabel("Write a comment").fill("Counted twice, it matches.");
  await editor.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(editor.getByText("Counted twice, it matches.")).toBeVisible({ timeout: 30_000 });
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
  await addTask(page, "Write the banner");

  await page.getByRole("link", { name: PROJECT }).first().click();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  const doing = page.getByRole("region", { name: "In progress" });
  await page.getByRole("combobox", { name: "Move Write the banner to" }).selectOption({ label: "In progress" });
  await expect(doing.getByRole("link", { name: "Write the banner" })).toBeVisible({ timeout: 30_000 });
});
