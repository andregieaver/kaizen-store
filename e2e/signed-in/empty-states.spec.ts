import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN, OWNER } from "./accounts";

/**
 * Empty screens with a next step (code review 2.9, D845): an empty list is the kit's `EmptyState`, a title and one thing to do, and a search
 * or filter that matched nothing says so in its own words and offers Clear filters back to the whole list. A fresh store of the owner's own
 * (its demo products put aside) shows it on Products and on the store's custom fields; Kaizena Flow's admin on its docs feedback. The
 * markup is `ui.test.ts`'s and the scan that keeps hand-written empty blocks out is `ratchet.scan.test.ts`'s.
 */

/** A store of the owner's own with nothing in it, so no other spec's products or fields fill it. */
const STORE = "e2e-empty";
const run = Date.now().toString(36);
/** A docs page only this spec answers, so other specs' feedback never matches its filter. */
const DOCS_PATH = `e2e-empty-states/${run}`;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Empty') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Empty', null)`;
    });
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    // The demo products are put aside, as the setup's Archive the demo products does: the store has no product of its own yet.
    await sql`update commerce.products set status = 'archived' where store_id = ${store.id} and status <> 'archived'`;
    // One answer on a docs page of this run's own, so the platform's filter for its other answers matches nothing.
    await sql`insert into commerce.docs_feedback (path, lang, helpful) values (${DOCS_PATH}, 'en', true)`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.docs_feedback where path = ${DOCS_PATH}`;
  } finally {
    await sql.end();
  }
});

test.describe("a store's empty screens", () => {
  test.use({ storageState: OWNER.state });

  test("Products with none yet offers the first product, and a search that found nothing clears back to the list", async ({ page }) => {
    await page.goto(`/admin/${STORE}/products`);
    const main = page.getByRole("main");
    await expect(main.getByText("No products yet.", { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "Add your first product" })).toHaveAttribute("href", `/admin/${STORE}/products/new`);

    // A search is a different empty: its own words, and the way back.
    await page.goto(`/admin/${STORE}/products?q=nothing-here`);
    await expect(main.getByText("No product matches “nothing-here”.", { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "Add your first product" })).toHaveCount(0);
    await main.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/products$`));
    await expect(main.getByText("No products yet.", { exact: true })).toBeVisible();
  });

  test("the store's custom fields with no group say what shows there and offer to make one", async ({ page }) => {
    await page.goto(`/admin/${STORE}/fields/store`);
    const main = page.getByRole("main");
    await expect(main.getByText("No group of custom fields is on the store yet", { exact: true })).toBeVisible();
    await expect(main.getByText(/ticked under Where it can be used shows here/)).toBeVisible();
    await main.getByRole("link", { name: "Make a group for the store" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/fields/new\\?entity=store$`));
  });
});

test.describe("Kaizena Flow's empty screens", () => {
  test.use({ storageState: ADMIN.state });

  test("docs feedback filtered to answers there are none of says so and clears back to every answer", async ({ page }) => {
    await page.goto(`/admin/platform/docs/feedback?page=${encodeURIComponent(DOCS_PATH)}&helpful=no`);
    const main = page.getByRole("main");
    await expect(main.getByText("No answers match.", { exact: true })).toBeVisible();
    await main.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/admin\/platform\/docs\/feedback$/);
    await expect(main.getByText("No answers match.", { exact: true })).toHaveCount(0);
  });
});
