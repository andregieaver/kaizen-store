import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";
import { ADMIN, E2E_STORE, E2E_STORE_NB, OWNER, OWNER_NB } from "./accounts";

/**
 * Say where you are (code review step 2.2, D873): a page's header names its section above the title, in the person's admin language; the
 * menu marks one link in each list, the one whose address the page is deepest inside; and the store switcher keeps the page you are on
 * when the other store has it, else opens its Home. The lookups are unit-tested (`section-eyebrow.test.ts`, `store-admin-nav.test.ts`,
 * `store-switch.test.ts`); this sees them in a browser, as the owner, the owner who reads Norwegian and the platform admin.
 */

/** A second store of the owner's, named to come first in the switcher (it lists twelve, by name). */
const WHERE = "e2e-where";
const WHERE_NAME = "A Where E2E";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // Made once: other specs make the owner's stores at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${WHERE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, ${WHERE_NAME}) returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${WHERE}, ${WHERE_NAME}, null)`;
    });
    // Past its setup wizard, so its Home is Home.
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${WHERE}`;
  } finally {
    await sql.end();
  }
});

/** The page's own header: the one around its `h1`. */
const pageHeader = (page: Page) => page.getByRole("main").locator("header").filter({ has: page.getByRole("heading", { level: 1 }) }).last();

/** The section's word sits above the title, on a line of its own. */
async function expectSection(page: Page, word: string) {
  const header = pageHeader(page);
  const eyebrow = header.getByText(word, { exact: true });
  await expect(eyebrow).toBeVisible();
  const [above, title] = await Promise.all([eyebrow.boundingBox(), header.getByRole("heading", { level: 1 }).boundingBox()]);
  expect(above!.y + above!.height).toBeLessThanOrEqual(title!.y + 1);
}

test.describe("a store's admin", () => {
  test.use({ storageState: OWNER.state });

  test("a page names its section above its title: Analytics' Overview", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/analytics`);
    await expectSection(page, "Analytics");
  });

  test("Draft orders is the one page marked in its sidebar, under Orders, the one section marked", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/orders/drafts`);
    // Its way back already says Orders, so the eyebrow does not say it again.
    await expect(pageHeader(page).getByText("Orders", { exact: true })).toHaveCount(1);
    await expect(pageHeader(page).getByRole("link", { name: "Orders" })).toBeVisible();
    const sidebar = page.getByRole("navigation", { name: "More" });
    await expect(sidebar.getByRole("link", { name: "Draft orders" })).toHaveAttribute("aria-current", "page");
    await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1);
    const rail = page.getByRole("navigation", { name: "Main sections" });
    await expect(rail.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(rail.getByRole("link", { name: "Orders", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("switching store keeps the page, and opens the other store's Home from one of this store's records", async ({ page }) => {
    const switchTo = async (from: string) => {
      await page.goto(from);
      await page.getByRole("button", { name: /E2E Shop/ }).click();
      await page.getByRole("menuitem", { name: WHERE_NAME }).click();
    };
    await switchTo(`/admin/${E2E_STORE}/orders/drafts`);
    await expect(page).toHaveURL(new RegExp(`/admin/${WHERE}/orders/drafts$`));
    await expect(page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "Draft orders" })).toHaveAttribute("aria-current", "page");

    const sql = testDb();
    let product: string;
    try {
      [{ id: product }] = await sql`select p.id from commerce.products p join commerce.stores s on s.id = p.store_id where s.slug = ${E2E_STORE} order by p.created_at limit 1`;
    } finally {
      await sql.end();
    }
    await switchTo(`/admin/${E2E_STORE}/products/${product}`);
    await expect(page).toHaveURL(new RegExp(`/admin/${WHERE}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("a store's admin in Norwegian", () => {
  test.use({ storageState: OWNER_NB.state });

  test("the section is named in the person's admin language", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE_NB}/analytics`);
    await expectSection(page, "Analyse");
  });
});

test.describe("Kaizena Flow's admin", () => {
  test.use({ storageState: ADMIN.state });

  test("a platform page names its section, and the rail keeps its section marked on a page below the section's own", async ({ page }) => {
    await page.goto("/admin/platform/plans/limits");
    await expectSection(page, "Plans");
    const rail = page.getByRole("navigation", { name: "Platform sections" });
    await expect(rail.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(rail.getByRole("link", { name: "Plans", exact: true })).toHaveAttribute("aria-current", "page");
    const sidebar = page.getByRole("navigation", { name: "More" });
    await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(sidebar.getByRole("link", { name: "Limits" })).toHaveAttribute("aria-current", "page");
  });
});
