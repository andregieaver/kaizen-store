import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * The page builder's sandbox (D456, `docs/builder-sandbox.md`), as a visitor without an account meets it: closed while its switch is off;
 * on, *Start building* makes a store of their own and opens it, the real builder edits and publishes its front page, nobody else sees the
 * store (its storefront is private, another browser cannot open the sandbox), and *Start over* leaves it for a fresh one.
 */
test.describe.configure({ mode: "serial" });

async function setSandbox(on: boolean): Promise<void> {
  const sql = testDb();
  try {
    await sql`update commerce.platform_settings set sandbox_on = ${on}, sandbox_daily_cap = 10000`;
    // Every test browser is one network: the `sandbox` budget (5 an hour) would refuse a run after a few others on this database.
    await sql`delete from commerce.chat_usage where store_id is null and bucket like 'budget:sandbox%'`;
  } finally {
    await sql.end();
  }
}

test.afterAll(async () => {
  await setSandbox(false);
});

test("the sandbox is closed while its switch is off", async ({ page }) => {
  await setSandbox(false);
  await page.goto("/admin/try");
  await expect(page.getByRole("heading", { level: 1, name: "Try the page builder" })).toBeVisible();
  await expect(page.getByText("The sandbox is closed right now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start building" })).toHaveCount(0);
});

test("a visitor without an account builds and publishes in a private store of their own", async ({ page, browser }) => {
  await setSandbox(true);
  await page.goto("/admin/try");
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(/\/admin\/try\/[0-9a-f-]{36}$/);
  const home = page.url();
  const id = home.split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: "Your store" })).toBeVisible();
  await expect(page.getByText("Only you can see this store.")).toBeVisible();
  await expect(page.getByText("7 days left")).toBeVisible();

  // The real builder, on the store's front page.
  await page.getByRole("link", { name: "Edit the front page" }).click();
  const title = page.getByLabel("Title", { exact: true });
  await expect(title).toBeVisible();
  const heading = `Sandkasse ${Date.now().toString(36)}`;
  await title.fill(heading);
  // The front page is published already, so its button publishes the changes.
  await page.getByRole("button", { name: "Publish changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Published at \/s\/try-[a-z0-9]{8}\// })).toBeVisible();

  const sql = testDb();
  try {
    const [row] = await sql`
      select s.slug, s.private_mode, x.first_publish_at is not null as published,
             (select p.published->>'title' from commerce.pages p where p.id = s.front_page_id) as title
        from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = ${id}`;
    expect(row).toMatchObject({ private_mode: true, published: true, title: heading });
    // Nobody else sees it: the store's own address answers with its private landing page, never the page.
    const storefront = await page.request.get(`/s/${row.slug}`);
    expect(await storefront.text()).not.toContain(heading);
  } finally {
    await sql.end();
  }

  // The preview draws it for the visitor.
  await page.goto(home);
  await page.getByRole("link", { name: "Preview" }).first().click();
  await expect(page.getByRole("link", { name: "Back to editing" })).toBeVisible();

  // Another browser, without the pass, cannot open it.
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(home);
  await expect(stranger.getByRole("heading", { level: 1, name: "This sandbox has ended" })).toBeVisible();
  await other.close();

  // Start over: a fresh sandbox, and the old one closed.
  await page.goto(home);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page).not.toHaveURL(home);
  await expect(page).toHaveURL(/\/admin\/try\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your store" })).toBeVisible();
  const check = testDb();
  try {
    const [old] = await check`select x.state, s.status from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = ${id}`;
    expect(old).toEqual({ state: "expired", status: "closed" });
  } finally {
    await check.end();
  }
});
