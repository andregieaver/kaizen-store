import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * The platform's Stores list is the store admin's list (code review step 2.10, D847): Kaizena Flow's admin finds a store by its name and by
 * its owner's email, narrows the list by the store's state and its plan (each keeping the search), sees a search that matched nothing say
 * so with the bar's own way back, and finds the page builder's sandbox funnel under its switch on Access requests, not above the stores.
 * The reads are held by `src/server/platform-stores.int.test.ts`.
 */

test.use({ storageState: ADMIN.state });

const run = Date.now().toString(36);
const tag = `E2E Stores ${run}`;
const ownerEmail = `stores-owner-${run}@example.com`;
const planName = `E2E Plan ${run}`;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // Two stores of one owner, each named with this run's tag: Harbour open and on a plan, Lantern suspended with none.
    const [owner] = await sql`insert into commerce.accounts (email, name) values (${ownerEmail}, 'Stina Owner') returning id`;
    const [plan] = await sql`insert into commerce.plans (name, position) values (${planName}, 98) returning id`;
    for (const name of ["Harbour", "Lantern"]) {
      const [store] = await sql`insert into commerce.stores (slug, name) values (${`e2e-${name.toLowerCase()}-${run}`}, ${`${name} ${tag}`}) returning id`;
      await sql`insert into commerce.store_members (store_id, account_id, role) values (${store.id}, ${owner.id}, 'owner')`;
      if (name === "Harbour") await sql`insert into commerce.store_billing (store_id, plan_id, status) values (${store.id}, ${plan.id}, 'trialing')`;
      else await sql`update commerce.stores set status = 'suspended', status_reason = 'E2E' where id = ${store.id}`;
    }
  } finally {
    await sql.end();
  }
});

test("Stores finds a store by its name and by its owner's email, and narrows by state and plan keeping the search", async ({ page }) => {
  await page.goto("/admin/platform/stores");
  await expect(page.getByRole("heading", { level: 1, name: "Stores" })).toBeVisible();
  // The sandbox funnel moved to Access requests: Stores lists only stores, and the Dream Factory stays in the header.
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Build a store with AI" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search stores" });
  const rows = page.getByRole("list", { name: "Stores" }).getByRole("listitem");
  await search.fill(`harbour ${tag}`);
  await search.press("Enter");
  await expect(page).toHaveURL(/q=harbour/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`Harbour ${tag}`);

  await search.fill(ownerEmail.toUpperCase());
  await search.press("Enter");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(ownerEmail);
  await expect(rows.nth(1)).toContainText("Suspended");

  // The state's chips are the form's buttons: a chip keeps the search, and says it is the one chosen.
  await page.getByRole("button", { name: /^Suspended \d+$/ }).click();
  await expect(page).toHaveURL(/state=suspended/);
  await expect(page).toHaveURL(/q=STORES-OWNER/);
  await expect(page.getByRole("button", { name: /^Suspended \d+$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`Lantern ${tag}`);

  // The plan is one step away, under Filters, in the same form: every state again, and only the store on that plan.
  await page.getByRole("button", { name: /^All \d+$/ }).click();
  await expect(rows).toHaveCount(2);
  await page.getByText("Filters", { exact: true }).click();
  await page.getByLabel("Plan", { exact: true }).selectOption({ label: planName });
  await page.getByRole("button", { name: "Show stores" }).click();
  await expect(page).toHaveURL(/plan=[0-9a-f-]{36}/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`Harbour ${tag}`);
  await expect(rows.first()).toContainText(planName);
  await expect(rows.first()).toContainText("Free trial");
});

test("a search that finds no store says so, and the bar leads back to every store", async ({ page }) => {
  await page.goto(`/admin/platform/stores?q=${encodeURIComponent(`nothing-${run}`)}`);
  await expect(page.getByText(`No store matches “nothing-${run}”.`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Stores" })).toHaveCount(0);
  // One way back, beside the search bar; the empty box repeats none (D845).
  await expect(page.getByRole("link", { name: "Show every store" })).toHaveCount(1);
  await page.getByRole("link", { name: "Show every store" }).click();
  await expect(page).toHaveURL(/\/admin\/platform\/stores$/);
  await expect(page.getByRole("list", { name: "Stores" }).getByRole("listitem").first()).toBeVisible();
});

test("the page builder's sandbox funnel is under its switch on Access requests", async ({ page }) => {
  await page.goto("/admin/platform/requests");
  const funnel = page.getByRole("table", { name: /Visitors who tried the builder without signing up/ });
  await expect(funnel).toBeVisible();
  await expect(funnel.getByRole("columnheader", { name: "Started" })).toBeVisible();
  await expect(funnel.getByRole("columnheader", { name: "Kept" })).toBeVisible();
  await expect(funnel.getByRole("rowheader", { name: "Last 7 days" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Turn (on|off) the sandbox/ })).toBeVisible();
});
