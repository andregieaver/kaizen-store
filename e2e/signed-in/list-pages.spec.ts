import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * One way to page a list (code review 1.13, D834): a store with 150 customers and 150 products shows a hundred of each with "100 of 150" and a
 * link to the next page, which holds the rest; the search goes over every page; and the products table says plainly whether a choice is this
 * page or every product that matches. The reads are held by `customer-admin.int.test.ts` and `product-list.int.test.ts`.
 */

test.use({ storageState: OWNER.state });

/** A store of the owner's own, so no other spec's customers or products change its counts. */
const STORE = "e2e-pager";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Pager') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Pager', null)`;
    });
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    // The demo products are put aside, as the setup's Archive the demo products does: the list is the 150 made here.
    await sql`update commerce.products set status = 'archived' where store_id = ${store.id} and handle like 'demo-%' and status <> 'archived'`;
    await sql`
      insert into commerce.customers (store_id, email, name)
      select ${store.id}, 'p' || lpad(i::text, 3, '0') || '@example.com', 'Person ' || lpad(i::text, 3, '0') from generate_series(1, 150) i
      on conflict do nothing`;
    await sql`
      insert into commerce.products (store_id, handle, tax_code, kind)
      select ${store.id}, 'item-' || lpad(i::text, 3, '0'), 'txcd_99999999', 'goods' from generate_series(1, 150) i
      on conflict do nothing`;
    await sql`
      insert into commerce.product_translations (store_id, product_id, locale, title)
      select p.store_id, p.id, 'nb-NO', 'Item ' || substr(p.handle, 6) from commerce.products p where p.store_id = ${store.id} and p.handle like 'item-%'
      on conflict do nothing`;
  } finally {
    await sql.end();
  }
});

test("Customers shows a hundred of 150 with a next page that holds the rest, and the search goes over every page", async ({ page }) => {
  await page.goto(`/admin/${STORE}/customers`);
  const people = page.getByRole("list", { name: "Customers" }).getByRole("listitem");
  await expect(people).toHaveCount(100);
  await expect(page.getByText("100 of 150", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Next 100" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/customers\\?page=2$`));
  await expect(people).toHaveCount(50);
  await expect(page.getByText("150 of 150", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous 100" })).toHaveAttribute("href", `/admin/${STORE}/customers`);
  await expect(page.getByRole("link", { name: "Next 100" })).toHaveCount(0);

  // Ordered by name, the search finds people on every page, and a list that fits on one page has no pager.
  await page.goto(`/admin/${STORE}/customers?sort=name`);
  await expect(people.first()).toContainText("Person 001");
  await expect(page.getByRole("link", { name: "Next 100" })).toHaveAttribute("href", `/admin/${STORE}/customers?sort=name&page=2`);
  await page.getByRole("searchbox", { name: "Search by name or email" }).fill("Person 14");
  await page.getByRole("searchbox", { name: "Search by name or email" }).press("Enter");
  await expect(page).toHaveURL(/q=Person\+14/);
  await expect(people).toHaveCount(10);
  await expect(page.getByText(/^\d+ of \d+$/)).toHaveCount(0);

  // A page past the last opens the first.
  await page.goto(`/admin/${STORE}/customers?page=9`);
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/customers$`));
  await expect(people).toHaveCount(100);
});

test("Products shows a hundred of 150 with a next page, and the table says whether a choice is this page or every match", async ({ page }) => {
  await page.goto(`/admin/${STORE}/products`);
  await expect(page.getByText("100 of 150", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const rows = page.getByRole("table", { name: "Products" }).locator("tbody tr");
  await expect(rows).toHaveCount(100);

  // The head's box chooses this page; the foot chooses every product that matches, on all pages, and says so.
  await page.getByRole("checkbox", { name: "Choose all 100 on this page" }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar.getByText("100 products chosen")).toBeVisible();
  await page.getByRole("button", { name: "Choose all 150 products that match, on every page" }).click();
  await expect(bar.getByText("150 products chosen")).toBeVisible();
  await expect(bar.getByText("150 products match and all of them are chosen.")).toBeVisible();

  await page.getByRole("link", { name: "Next 100" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/products\\?page=2$`));
  await expect(rows).toHaveCount(50);
  await expect(page.getByText("150 of 150", { exact: true })).toBeVisible();
  // The offer is still every match on all pages, not this page's fifty.
  await expect(page.getByRole("button", { name: "Choose all 150 products that match, on every page" })).toBeVisible();

  // The search goes over every page, by name or SKU, and keeps the view; a view's chip keeps the search.
  await page.getByRole("searchbox", { name: "Search products" }).fill("item-14");
  await page.getByRole("searchbox", { name: "Search products" }).press("Enter");
  await expect(page).toHaveURL(/q=item-14/);
  await expect(rows).toHaveCount(10);
  await expect(page.getByText(/^\d+ of \d+$/)).toHaveCount(0);
  // All that match fit on this page: the head's box is all there is to choose.
  await expect(page.getByRole("button", { name: /on every page$/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Drafts/ }).click();
  await expect(page).toHaveURL(/show=draft/);
  await expect(page).toHaveURL(/q=item-14/);
  await expect(page.getByRole("button", { name: /^Drafts/ })).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(10);
});
