import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * The page builder's sandbox (D457, `docs/builder-sandbox.md`), as a visitor without an account meets it: closed while its switch is off;
 * on, *Start building* makes a store of their own and opens it, the real builder edits and publishes its front page and opens a new
 * article, nobody else sees the store (its storefront is private, another browser cannot open the sandbox), and *Start over* leaves it
 * for a fresh one.
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
  // The real builder opens on the store's front page (S4), with the guided path above it.
  await expect(page).toHaveURL(/\/admin\/try\/[0-9a-f-]{36}\/pages\/[0-9a-f-]{36}$/);
  const id = /\/admin\/try\/([0-9a-f-]{36})\//.exec(page.url())![1];
  const home = new URL(`/admin/try/${id}`, page.url()).toString();
  await expect(page.getByText("Only you can see this store.")).toBeVisible();
  await expect(page.getByText("7 days left")).toBeVisible();
  const guide = page.getByRole("complementary", { name: "Things to try" });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("link", { name: "Choose a look" })).toHaveAttribute("href", `/admin/try/${id}/looks`);

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
    const storefront = await browser.newContext();
    const outsider = await storefront.newPage();
    await outsider.goto(`/s/${row.slug}`);
    await expect(outsider.locator("[data-private-landing]")).toBeVisible();
    await storefront.close();
    // *See your store* (S4): the visitor walks their own storefront, in a new tab, past the private landing page.
    const [walk] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "See your store" }).click()]);
    await expect(walk).toHaveURL(new RegExp(`/s/${row.slug}`));
    await walk.waitForLoadState();
    await expect(walk.locator("[data-private-landing]")).toHaveCount(0);
    await walk.close();
  } finally {
    await sql.end();
  }

  // View opens the published page in the sandbox's own preview: the store's address is private and shows only its landing page.
  await page.getByRole("link", { name: "View page", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/try\/[0-9a-f-]{36}\/pages\/[0-9a-f-]{36}\/preview\?published=1$/);
  await expect(page.getByText("The published version, as your store shows it. Only you can see it.")).toBeVisible();

  // The preview draws it for the visitor.
  await page.goto(home);
  await page.getByRole("link", { name: "Preview" }).first().click();
  await expect(page.getByRole("link", { name: "Back to editing" })).toBeVisible();

  // Articles are in the sandbox too (S3): a new one opens in the same builder.
  await page.goto(home);
  await page.getByRole("link", { name: "New article" }).click();
  await expect(page).toHaveURL(/\/admin\/try\/[0-9a-f-]{36}\/articles\/new$/);
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();

  // *Try another look* (S4): a free theme becomes its look in one press.
  await page.goto(`${home}/looks`);
  await expect(page.getByRole("heading", { level: 1, name: "Try another look" })).toBeVisible();
  await page.getByRole("button", { name: "Use this look" }).first().click();
  await expect(page.getByText("Your store wears its new look. Open a page to see it.")).toBeVisible();
  await expect(page.getByText("Your look", { exact: true })).toBeVisible();

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

test("Keep this store: the emailed link makes the sandbox the person's store, and the old tab says so", async ({ page }) => {
  await setSandbox(true);
  const sql = testDb();
  const [{ self_serve_signup: selfServeWas }] = await sql`select self_serve_signup from commerce.platform_settings`;
  await sql`update commerce.platform_settings set self_serve_signup = true`;
  try {
    await page.goto("/admin/try");
    await page.getByRole("button", { name: "Start building" }).click();
    await expect(page).toHaveURL(/\/admin\/try\/[0-9a-f-]{36}\/pages\/[0-9a-f-]{36}$/);
    const id = /\/admin\/try\/([0-9a-f-]{36})\//.exec(page.url())![1];
    const home = new URL(`/admin/try/${id}`, page.url()).toString();

    // The bar's main action, then the sign-up's three answers.
    await page.getByRole("link", { name: "Keep this store" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Keep this store" })).toBeVisible();
    const run = Date.now().toString(36);
    const email = `keeper-${run}@example.com`;
    await page.getByLabel("Your store's name").fill(`Kari Keramikk ${run}`);
    await page.getByLabel("Your name").fill("Kari");
    await page.getByLabel("Your email").fill(email);
    await page.getByRole("button", { name: "Email me the link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    // The link the email carries, pressed as the person would.
    const [message] = await sql`select text from commerce.email_messages where to_address = ${email} and kind = 'platform.access_confirm' order by created_at desc limit 1`;
    const link = /\/sign-up\/confirm\/[A-Za-z0-9_-]{43}/.exec(String(message?.text ?? ""))?.[0];
    expect(link).toBeTruthy();
    await page.goto(link!);
    await page.getByRole("button", { name: "Start my store" }).click();
    await expect(page.getByText(`Kari Keramikk ${run} is ready`)).toBeVisible();

    const [store] = await sql`
      select s.slug, s.sandbox, s.private_mode, x.state,
             (select array_agg(a.email) from commerce.store_members m join commerce.accounts a on a.id = m.account_id where m.store_id = s.id) as members
        from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = ${id}`;
    expect(store).toMatchObject({ slug: `kari-keramikk-${run}`, sandbox: false, private_mode: true, state: "kept", members: [email] });

    // The tab that built it: the store is theirs now, and signing in is the way on.
    await page.goto(home);
    await expect(page.getByRole("heading", { level: 1, name: "This store is yours now" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/admin/sign-in");
  } finally {
    await sql`update commerce.platform_settings set self_serve_signup = ${Boolean(selfServeWas)}`;
    await sql.end();
  }
});
