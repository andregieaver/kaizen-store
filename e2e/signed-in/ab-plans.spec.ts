import { expect, test } from "@playwright/test";

import { testDb } from "../db";

import { OWNER } from "./accounts";

/**
 * A/B tests as a plan's feature (D148 phase 21), as an owner on a plan without them sees it: the new-test page says what tests give and
 * where to choose a plan, instead of the form. A store of its own, so no other spec meets its limit. With `AB_SHOTS` set it keeps a
 * screenshot of what it looked at.
 */

const shots = process.env.AB_SHOTS;
let slug = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    slug = `ab-plan-${Date.now().toString(36)}`;
    const [access] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', 'Lampebutikken') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Lampebutikken', null) as id`;
    const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
    await sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}, ${owner.id}, 'owner')`;
    // The store's own limit, as its plan's would be: no A/B tests.
    await sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${storeId}, 'ab_tests_running', 0, 'A plan without A/B tests (e2e)')`;
  } finally {
    await sql.end();
  }
});

test.describe("as the owner of a store whose plan has no A/B tests", () => {
  test.use({ storageState: OWNER.state });

  test("sees what A/B tests give and where to choose a plan, not the form", async ({ page }) => {
    await page.goto(`/admin/${slug}/experiments/new`);
    const card = page.locator("[data-plan-without-tests]");
    await expect(card.getByRole("heading", { name: "A/B tests come with another plan" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", `/admin/${slug}/billing`);
    await expect(page.getByRole("button", { name: "Make version B" })).toHaveCount(0);
    if (shots) await page.screenshot({ path: `${shots}/ab-plan-without-tests.png`, fullPage: true });
  });
});
