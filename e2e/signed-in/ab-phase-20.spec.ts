import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * A/B tests, phase 20 (D148, D715), as the owner makes them: a test whose goal is going on to a page, for new visitors only, made on the new-test
 * form; and a running test's preview link, made with one press and shown to copy. With `AB_SHOTS` set it keeps screenshots of what it looked at.
 */

const shots = process.env.AB_SHOTS;
const EXP = randomUUID();
let storeId = "";
let made = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    // A running test of a copy of the about page of its own, so it never meets another spec's running test.
    const [about] = await sql`select published from commerce.pages where store_id = ${storeId} and slug = 'om-oss' and type = 'page'`;
    const own = `share-${EXP.slice(0, 8)}`;
    const [page] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, type)
      values (${storeId}, ${own}, ${sql.json({ ...about.published, slug: own })}, ${sql.json({ ...about.published, slug: own })}, now(), 'page') returning id, published`;
    const slug = `ab-${EXP.slice(0, 8)}-b`;
    const [copy] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, type)
      values (${storeId}, ${slug}, ${sql.json({ ...page.published, slug })}, ${sql.json({ ...page.published, slug })}, now(), 'variant') returning id`;
    await sql`insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal) values (${EXP}, ${storeId}, 'Shorter story', ${page.id}, 'orders')`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${storeId}, ${EXP}, 'a', 'Original', null, 0.5), (${storeId}, ${EXP}, 'b', 'Version B', ${copy.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running', started_at = now() - interval '3 days' where id = ${EXP}`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    // A test that has run is kept (a rule of the database): it ends discarded, as does the draft made on the form.
    await sql`update commerce.experiments set status = 'stopped', stopped_at = now() where id = ${EXP} and status = 'running'`;
    await sql`update commerce.experiments set status = 'discarded' where id = ${EXP}`;
    if (made) await sql`update commerce.experiments set status = 'discarded' where id = ${made} and store_id = ${storeId} and status = 'draft'`;
  } finally {
    await sql.end();
  }
});

test.describe("as the owner", () => {
  test.use({ storageState: OWNER.state });

  test("makes a test of visitors going on to a page, for new visitors only", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/experiments/new`);
    await page.getByRole("button", { name: /^More goals/ }).click();
    await page.locator('[data-goal="page"]').click();
    const choice = page.locator("[data-goal-page]");
    await expect(choice).toBeVisible();
    // The front page is offered, by its name; the page chosen above is not.
    await choice.selectOption({ label: "Front page" });
    await page.getByText("Customise", { exact: true }).click();
    await page.locator("[data-returning]").selectOption("new");
    if (shots) await page.screenshot({ path: `${shots}/ab-page-goal-form.png`, fullPage: true });
    await page.getByRole("button", { name: "Make version B" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/experiments/[0-9a-f-]{36}$`));
    made = page.url().split("/").pop() ?? "";
    const sql = testDb();
    try {
      const [test] = await sql`
        select e.primary_goal, e.audience, (select commerce.page_place(p.store_id, p.id) from commerce.pages p where p.id::text = e.goal_params ->> 'page') as place
        from commerce.experiments e where e.id = ${made}`;
      expect(test).toMatchObject({ primary_goal: "page", audience: { returning: "new" }, place: "front" });
    } finally {
      await sql.end();
    }
  });

  test("makes a preview link of version B with one press, to copy", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/experiments/${EXP}`);
    const share = page.locator("[data-share]");
    await expect(share.getByRole("heading", { name: "Show it to someone" })).toBeVisible();
    await share.getByRole("button", { name: "Copy a link to Version B" }).click();
    const link = share.locator('[data-share-link="b"]');
    await expect(link).toHaveValue(/\/api\/ab\/preview\?t=/);
    if (shots) {
      await share.scrollIntoViewIfNeeded();
      await share.screenshot({ path: `${shots}/ab-share.png` });
    }
  });
});
