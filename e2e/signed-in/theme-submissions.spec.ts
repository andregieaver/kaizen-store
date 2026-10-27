import { expect, test } from "@playwright/test";

import { testDb, testStore } from "../db";
import { ADMIN, OWNER } from "./accounts";

/**
 * Themes from outside as their author and Kaizena Flow's admin meet them (wave 7 unit J, D344; rows platform.themes-and-templates-marketplace
 * and storefront.theme-store-free-and-paid-themes): the owner of a store of their own shares its look from Design settings and follows it
 * under Your themes; the admin finds it under Themes → Submissions, reviews it (a draft theme) and approves it, and the theme store's page
 * names its author. A second look is not accepted, with a reason the author reads.
 *
 * Shared data: a store of the owner's own; the themes made here are archived after.
 */

test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const NAME = `Fjord ${RUN}`;
const REJECTED = `Copy ${RUN}`;
let store = { slug: "", id: "" };

test.beforeAll(async () => {
  store = await testStore("tema-eier");
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}`;
    await sql`
      insert into commerce.store_members (store_id, account_id, role, kind)
      select ${store.id}, a.id, 'owner', 'staff' from commerce.accounts a where lower(a.email) = ${OWNER.email}
      on conflict (store_id, account_id) do update set role = 'owner'`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.design_presets set published = false, archived_at = now() where title in (${NAME}, ${REJECTED}) and archived_at is null`;
  } finally {
    await sql.end();
  }
});

test.describe("the author", () => {
  test.use({ storageState: OWNER.state });

  test("shares the store's look from Design settings and follows it under Your themes", async ({ page }) => {
    await page.goto(`/admin/${store.slug}/settings/design`);
    await page.getByRole("link", { name: "Share this look", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Share this look as a theme", level: 1 })).toBeVisible();
    for (const [name, author] of [
      [NAME, "Ada Lovelace"],
      [REJECTED, "Ada Lovelace"],
    ]) {
      await page.goto(`/admin/${store.slug}/settings/design/share`);
      await page.getByLabel("Theme name").fill(name);
      await page.getByLabel("One line about it").fill("Calm and clear.");
      await page.getByLabel(/^Your name as its author/).fill(author);
      await page.getByRole("button", { name: "Send for review" }).click();
      await expect(page.getByText("Sent for review.", { exact: false })).toBeVisible();
    }
    await page.goto("/admin/account/themes");
    const sent = page.getByRole("list", { name: "Sent" });
    await expect(sent.getByRole("listitem").filter({ hasText: NAME })).toContainText("Waiting");
  });
});

test.describe("Kaizena Flow's admin", () => {
  test.use({ storageState: ADMIN.state });

  test("reviews a look, approves it into the theme store, and says why another is not accepted", async ({ page }) => {
    // Review makes a draft theme with a workspace store of its own: a copy of the template, which takes a while on a busy machine.
    test.setTimeout(240_000);
    await page.goto("/admin/platform/themes/submissions");
    await page.getByRole("link", { name: NAME }).click();
    await expect(page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    // The page is drawn again for a submission in review: the theme to open, and the next step.
    await expect(page.getByRole("link", { name: "Open the theme" })).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("header").getByText("In review", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.locator("header").getByText("Approved", { exact: true })).toBeVisible({ timeout: 120_000 });

    const sql = testDb();
    let slug = "";
    try {
      const [theme] = await sql<{ slug: string }[]>`select slug from commerce.design_presets where title = ${NAME} and published`;
      slug = theme.slug;
    } finally {
      await sql.end();
    }
    await page.goto(`/themes/${slug}`);
    await expect(page.locator("[data-theme-author]")).toHaveText("Ada Lovelace");

    await page.goto("/admin/platform/themes/submissions");
    await page.getByRole("link", { name: REJECTED }).click();
    await page.getByLabel("Why (the author reads this)").fill("Too close to an existing theme.");
    await page.getByRole("button", { name: "Not accepted" }).click();
    await expect(page.getByText("Why: Too close to an existing theme.")).toBeVisible();
  });
});

test.describe("the author again", () => {
  test.use({ storageState: OWNER.state });

  test("reads the answers and sees the theme in the theme store", async ({ page }) => {
    await page.goto("/admin/account/themes");
    const sent = page.getByRole("list", { name: "Sent" });
    await expect(sent.getByRole("listitem").filter({ hasText: NAME })).toContainText("Approved");
    await expect(sent.getByRole("listitem").filter({ hasText: REJECTED })).toContainText("Why: Too close to an existing theme.");
    await expect(page.getByRole("list", { name: "In the theme store" }).getByRole("link", { name: NAME })).toBeVisible();
  });
});
