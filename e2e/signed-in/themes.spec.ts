import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Trying a theme before switching to it (D244, `docs/theme-phase-2.md` step 3), as the owner and a Read-only member see it: the theme library
 * opens an installed theme that is not live; its page says what switching changes, and its CSS is saved into it without touching the live look;
 * its preview draws the store's own pages inert, in that theme. The reader looks and previews but changes nothing. The server side is held by
 * theme-preview.int.test.ts.
 */

const TITLE = "E2E Calm";
const CSS = ".e2e-calm { outline: 1px solid #123456; }";
const design = `/admin/${E2E_STORE}/settings/design`;
let installId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.store_theme_installs where title = ${TITLE} and not live and store_id = (select id from commerce.stores where slug = ${E2E_STORE})`;
    const [row] = await sql`
      insert into commerce.store_theme_installs (store_id, title, look, live)
      select id, ${TITLE}, ${sql.json({ theme: { base: "minimal", savedId: null, settings: {} }, css: "", headerId: null, footerId: null, productLayoutId: null })}, false
      from commerce.stores where slug = ${E2E_STORE}
      returning id`;
    installId = String(row.id);
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.store_theme_installs where id = ${installId} and not live`;
  } finally {
    await sql.end();
  }
});

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("customises an installed theme, sees what changes and previews it, and the live look stays", async ({ page }) => {
    const sql = testDb();
    try {
      const [before] = await sql`select theme, custom_css from commerce.stores where slug = ${E2E_STORE}`;

      await page.goto(design);
      await page.getByRole("link", { name: `Customise ${TITLE}` }).click();
      await expect(page.getByRole("heading", { level: 1, name: `Customise “${TITLE}”` })).toBeVisible();
      await expect(page.getByRole("heading", { name: "What changes" })).toBeVisible();

      await page.getByLabel("CSS", { exact: true }).fill(CSS);
      await page.getByRole("button", { name: "Save CSS" }).click();
      await expect(page.getByText("Saved in this theme. Visitors see it once you switch to it.")).toBeVisible();
      // Saved into the install, not the store.
      const [install] = await sql`select look->>'css' as css from commerce.store_theme_installs where id = ${installId}`;
      expect(install.css).toBe(CSS);
      const [after] = await sql`select theme, custom_css from commerce.stores where slug = ${E2E_STORE}`;
      expect(after).toEqual(before);

      // The preview: a page of the store in this theme, its CSS in, nothing to press inside it.
      await page.goto(`${design}/themes/${installId}/preview`);
      await expect(page.getByRole("status").getByText(`Preview of “${TITLE}”`)).toBeVisible();
      const drawn = page.locator("[data-theme-preview]");
      await expect(drawn).toHaveAttribute("inert", "");
      // The theme's CSS, kept inside the preview (a style element's text is not shown, so it is read as text).
      const styles = await drawn.locator("style").evaluateAll((nodes) => nodes.map((node) => node.textContent ?? "").join("\n"));
      expect(styles).toContain("e2e-calm");
      await page.getByRole("navigation", { name: "Pages to preview" }).getByRole("link", { name: "A product" }).click();
      await expect(page).toHaveURL(/\?product=1$/);
      await expect(page.locator("[data-theme-preview] main")).not.toBeEmpty();
    } finally {
      await sql.end();
    }
  });
});

test.describe("a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("opens and previews an installed theme but cannot change it", async ({ page }) => {
    await page.goto(design);
    await page.getByRole("link", { name: `Open ${TITLE}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Customise “${TITLE}”` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save CSS" })).toHaveCount(0);
    await page.goto(`${design}/themes/${installId}/preview`);
    await expect(page.locator("[data-theme-preview]")).toBeVisible();
  });
});
