import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The CSS panel's code editor (D394) as the store's owner uses it: the CSS highlighted, Tab indents rather than leaving the field, CSS's
 * own properties suggested as they are typed, a class given to one of the page's parts suggested after a `.`, and what is typed
 * reaching the page's draft.
 */
test.use({ storageState: OWNER.state });

const RUN = Date.now().toString(36);
const SLUG = `css-${RUN}`;
let pageId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const content = {
      title: "Stilark",
      slug: SLUG,
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [{ id: "row-c", type: "row", layout: "1", className: "hero-band", columns: [{ id: "col-c", blocks: [{ id: "head-c", type: "heading", text: "Hello", level: 2 }] }] }],
    };
    const [row] = await sql`insert into commerce.pages (store_id, slug, draft) values (${store.id}, ${SLUG}, ${sql.json(content)}) returning id`;
    pageId = String(row.id);
  } finally {
    await sql.end();
  }
});

test("the CSS editor highlights, indents with Tab and suggests properties and the page's classes", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await page.getByRole("button", { name: /Custom CSS/ }).click();
  const editor = page.locator("[data-css-editor] .cm-content");
  await expect(editor).toBeVisible();
  await editor.click();

  // A class of the page's own after a dot.
  await page.keyboard.type(".hero");
  const suggestions = page.locator(".cm-tooltip-autocomplete");
  await expect(suggestions.getByText("hero-band", { exact: true })).toBeVisible();
  // CodeMirror takes no Enter for a moment after its suggestions open (against picking one by accident), as a person never notices.
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.keyboard.type(" {");
  await page.keyboard.press("Enter");

  // Tab indents inside the editor; the focus stays.
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();

  // CSS's own properties as they are typed.
  await page.keyboard.type("letter-spa");
  await expect(suggestions.getByText("letter-spacing", { exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  // A property comes with its colon.
  await page.keyboard.type("2px;");

  await expect(editor).toContainText(".hero-band {");
  await expect(editor).toContainText("letter-spacing: 2px;");
  // Highlighted: the property is drawn apart from the selector.
  expect(await editor.locator("span", { hasText: "letter-spacing" }).count()).toBeGreaterThan(0);

  // Escape closes suggestions and keeps the panel open; the CSS is the page's.
  await page.keyboard.press("Escape");
  await expect(page.locator("#css-panel")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  const sql = testDb();
  try {
    const [row] = await sql`select draft ->> 'css' as css from commerce.pages where id = ${pageId}`;
    expect(String(row.css)).toMatch(/\.hero-band \{\s*\n\s+letter-spacing: 2px;/);
  } finally {
    await sql.end();
  }
});
