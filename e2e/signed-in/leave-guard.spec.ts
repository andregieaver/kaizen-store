import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Unsaved work survives (code review 1.16, D787), as the store's owner meets it in the page builder: a click in the admin's menu with
 * changes not saved asks first in the admin's own dialog, Keep editing stays; the changes are kept in the browser, so after a reload
 * (a crash, a closed tab, a session that timed out) the editor offers them back, and Restore puts them in the editor; a save clears
 * them. The browser's Back asks too, and Leave without saving leaves and takes the kept changes with it.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const SLUG = `leave-${RUN}`;
let pageId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const content = {
      title: "Bli her",
      slug: SLUG,
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [{ id: "row-l", type: "row", layout: "1", columns: [{ id: "col-l", blocks: [{ id: "head-l", type: "heading", text: "Ikke gå", level: 2 }] }] }],
    };
    const [row] = await sql`insert into commerce.pages (store_id, slug, draft) values (${store.id}, ${SLUG}, ${sql.json(content)}) returning id`;
    pageId = String(row.id);
  } finally {
    await sql.end();
  }
});

const title = (page: Page) => page.getByLabel("Title", { exact: true });
const unsaved = (page: Page) => page.getByRole("status").filter({ hasText: "Unsaved changes." });

/** Types into the title until the editor has taken it (a key before hydration does nothing). */
async function edit(page: Page, text: string) {
  await expect(async () => {
    await title(page).fill(text);
    await expect(unsaved(page)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

test("a menu link asks first, Keep editing stays, and after a reload the changes are offered back and restored", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await edit(page, "Bli her, endret");

  await page.getByRole("navigation", { name: "Main sections" }).getByRole("link", { name: "Orders", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}$`));
  await expect(title(page)).toHaveValue("Bli her, endret");

  // The draft is written a moment after the change; the browser's own question on reload is answered Leave.
  await page.waitForTimeout(1500);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  const offer = page.locator("[data-draft-offer]");
  await expect(offer).toContainText("were not saved. They are kept in this browser.");
  await expect(title(page)).toHaveValue("Bli her");
  await offer.getByRole("button", { name: "Restore unsaved changes" }).click();
  await expect(offer).toBeHidden();
  await expect(title(page)).toHaveValue("Bli her, endret");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes restored. Save to keep them." })).toBeVisible();

  // Saved, nothing is kept: the next visit offers nothing, and a menu link leaves without a question.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  await page.reload();
  await expect(title(page)).toHaveValue("Bli her, endret");
  await page.waitForTimeout(500);
  await expect(page.locator("[data-draft-offer]")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/orders$`));
});

test("the browser's Back asks too, and Leave without saving leaves and keeps nothing", async ({ page }) => {
  // Into the editor by a link, so Back moves within the admin (a whole page load back is the browser's own question).
  await page.goto(`/admin/${E2E_STORE}/pages`);
  await page.waitForLoadState("networkidle");
  await page.locator(`a[href="/admin/${E2E_STORE}/pages/${pageId}"]`).first().click();
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await edit(page, "Bli her, igjen");
  await page.waitForTimeout(1500);

  await page.goBack();
  const ask = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(ask).toBeVisible();
  await expect(title(page)).toHaveValue("Bli her, igjen");
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}$`));
  await expect(title(page)).toHaveValue("Bli her, igjen");

  await page.goBack();
  await page.getByRole("dialog", { name: "Leave without saving?" }).getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/pages$`));
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(title(page)).toHaveValue("Bli her, endret");
  await page.waitForTimeout(500);
  await expect(page.locator("[data-draft-offer]")).toHaveCount(0);
});
