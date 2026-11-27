import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Projects and checklists (D903) as an owner uses them: the feature is switched on under Features; a checklist is made, tasks are added with
 * Enter and one is ticked below the Done line; the list made Advanced, a task set to repeat every day, ticked (its run shows) and the tick
 * undone; the list filtered by status, its open task found under All tasks, and the list duplicated under a name of its own; a tag made on Statuses, given to a task, and the task commented
 * on; the task given a customer (P4.7), linked on the list and listed on the customer's page; with Deals on, a deal's next step made a task on
 * the deal's page (D910), where the activity form then offers calls and meetings, the board counting it as the deal's next step and the task's
 * list linking the deal; a project is made, a checklist added to it, a task moved to the next stage on its board
 * with the keyboard's way (*Move to*), and the project's calendar opened. The store is left as it was found: its projects, lists and deal deleted, the features switched off again.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const LIST = `Opening ${run}`;
const PROJECT = `Launch ${run}`;
const TAG = `Fragile ${run}`;
const BUYER = `Kari Tasker ${run}`;
const DEAL = `Showroom ${run}`;
let wasOn = false;
let salesWasOn = false;
let buyerId = "";
let dealId = "";

/** A store feature switched on or off under Features (Projects, or Deals for D910's step), confirming a switch-off where it asks. */
async function feature(page: Page, name: "Projects" | "Deals", on: boolean) {
  await page.goto(`/admin/${E2E_STORE}/settings/features`);
  const toggle = page.getByRole("switch", { name, exact: true });
  if ((await toggle.getAttribute("aria-checked")) === String(on)) return;
  await toggle.click();
  if (!on) {
    const confirm = page.getByRole("region", { name: `Switch off ${name}` }).getByRole("button", { name: "Switch off", exact: true });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(on), { timeout: 30_000 });
}
const projects = (page: Page, on: boolean) => feature(page, "Projects", on);

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
    const [store] = await sql`select id, 'projects' = any(features) as on, 'sales' = any(features) as sales from commerce.stores where slug = ${E2E_STORE}`;
    wasOn = Boolean(store.on);
    salesWasOn = Boolean(store.sales);
    // Deals' switch shows while its pilot is open, as deals.spec.ts and contracts.spec.ts open it (all three run one at a time).
    await sql`update commerce.stores set sales_pilot = true where slug = ${E2E_STORE}`;
    const [buyer] = await sql`insert into commerce.customers (store_id, email, name) values (${store.id}, ${`kari-${run}@example.com`}, ${BUYER}) returning id`;
    buyerId = String(buyer.id);
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
    if (dealId) await sql`delete from commerce.deals where id = ${dealId}`;
    if (buyerId) await sql`delete from commerce.customers where id = ${buyerId}`;
  } finally {
    await sql.end();
  }
  const page = await browser.newPage({ storageState: OWNER.state });
  if (!wasOn) await projects(page, false);
  if (!salesWasOn) await feature(page, "Deals", false);
  await page.close();
  const pilot = testDb();
  try {
    await pilot`update commerce.stores set sales_pilot = false where slug = ${E2E_STORE}`;
  } finally {
    await pilot.end();
  }
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
  await expect(page.locator('input[value="New tag"]').last()).toBeVisible({ timeout: 30_000 });
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

test("an owner says which customer a task is about, and finds it on the customer's page", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/checklists`);
  await page.getByRole("link", { name: LIST, exact: true }).first().click();
  await page.getByRole("button", { name: "Open Count the till" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Customer", { exact: true }).fill(BUYER.slice(0, 10));
  await editor.getByRole("button", { name: new RegExp(`^${BUYER}`) }).click();
  await expect(editor.getByRole("button", { name: `Remove ${BUYER} from the task` })).toBeVisible();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });

  const link = page.getByRole("link", { name: BUYER, exact: true });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  const tasks = page.getByRole("region", { name: "Tasks", exact: true });
  await expect(tasks.getByText("Count the till", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(tasks.getByRole("link", { name: `In ${LIST}`, exact: true })).toBeVisible();
});

test("an owner makes a deal's next step a task on its page, and the board and the task's list say so (D910)", async ({ page }) => {
  await feature(page, "Deals", true);
  // The deal, in the store's first pipeline, which the board makes on its first visit; its person is the spec's customer.
  await page.goto(`/admin/${E2E_STORE}/deals`);
  await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const [stage] = await sql`
      select s.id, s.pipeline_id from commerce.deal_stages s join commerce.deal_pipelines p on p.id = s.pipeline_id
      where p.store_id = ${String(store.id)} order by p.sort, p.created_at, s.position limit 1`;
    const [deal] = await sql`
      insert into commerce.deals (store_id, title, customer_id, pipeline_id, stage_id, currency)
      values (${String(store.id)}, ${DEAL}, ${buyerId}, ${String(stage.pipeline_id)}, ${String(stage.id)}, 'NOK') returning id`;
    dealId = String(deal.id);
  } finally {
    await sql.end();
  }

  await page.goto(`/admin/${E2E_STORE}/deals/${dealId}`);
  // One way to make a task here: the activity form offers a call or a meeting, and the Tasks card below makes the task.
  await page.getByText("Add activity", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Meeting", exact: true })).toBeAttached();
  await expect(page.getByRole("radio", { name: "Task", exact: true })).toHaveCount(0);

  const tasks = page.getByRole("region", { name: "Tasks", exact: true });
  await expect(tasks.getByText("No tasks yet.", { exact: true })).toBeVisible();
  // Pressed until the page has woken (a press before then opens nothing); the title is written in advance.
  const make = tasks.getByRole("button", { name: "Make a task", exact: true });
  const title = tasks.getByRole("textbox", { name: /^Task/ });
  await expect(async () => {
    if (await make.isVisible()) await make.click({ timeout: 2_000 });
    await expect(title).toHaveValue("Next step for the deal", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await tasks.getByRole("combobox", { name: /^List/ }).selectOption({ label: LIST });
  await tasks.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(tasks.getByText("Next step for the deal", { exact: true })).toBeVisible({ timeout: 30_000 });

  // The board counts it as the deal's next step, so the deal is not one with none.
  await page.goto(`/admin/${E2E_STORE}/deals`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: DEAL, exact: true }) });
  await expect(card.getByText("Next: task", { exact: true })).toBeVisible({ timeout: 30_000 });

  // On its list, the task links back to the deal.
  await page.goto(`/admin/${E2E_STORE}/deals/${dealId}`);
  await page.getByRole("region", { name: "Tasks", exact: true }).getByRole("link", { name: `In ${LIST}`, exact: true }).click();
  const back = page.getByRole("link", { name: DEAL, exact: true });
  await expect(back).toBeVisible({ timeout: 30_000 });
  await expect(back).toHaveAttribute("href", `/admin/${E2E_STORE}/deals/${dealId}`);
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
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Month" })).toBeVisible({ timeout: 30_000 });
});
