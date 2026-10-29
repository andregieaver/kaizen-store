import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Text styles (D393, `docs/text-styles.md`) as the store's owner uses them: the second word of a heading selected on the canvas, a new
 * style made from the *Style* menu and put on it at once, before anything is saved; then a rich text's HTML edited, read back with what
 * was left out named, the style's words drawn in it.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const SLUG = `styles-${RUN}`;
let pageId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    await sql`delete from commerce.text_styles where store_id = ${store.id}`;
    const content = {
      title: "Stiler",
      slug: SLUG,
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [{ id: "row-s", type: "row", layout: "1", columns: [{ id: "col-s", blocks: [{ id: "head-s", type: "heading", text: "My awesome heading", level: 2 }] }] }],
    };
    const [row] = await sql`insert into commerce.pages (store_id, slug, draft) values (${store.id}, ${SLUG}, ${sql.json(content)}) returning id`;
    pageId = String(row.id);
  } finally {
    await sql.end();
  }
});

/** Selects a word in the text being edited, as a person dragging over it would. */
async function selectWord(page: Page, root: string, word: string) {
  await page.evaluate(
    ({ root, word }) => {
      const box = document.querySelector(`${root} .ProseMirror`)!;
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(word) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      throw new Error(`no "${word}" to select`);
    },
    { root, word },
  );
}

test("a word of a heading takes a new style from the Style menu, shown on the canvas at once", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await page.locator('[data-builder-item="block"] h2', { hasText: "My awesome heading" }).click();
  const editor = page.locator('[data-inline-editing="heading"]');
  await expect(editor).toBeVisible();
  await selectWord(page, '[data-inline-editing="heading"]', "awesome");

  await page.getByRole("button", { name: "Text style for the selected words" }).click();
  await page.getByRole("menuitem", { name: "New style…" }).click();
  const dialog = page.getByRole("dialog", { name: "New text style" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Gradient/ }).click();
  await dialog.getByLabel("Name").fill("Sunset");
  await dialog.getByRole("button", { name: "Save and apply" }).click();
  await expect(dialog).toBeHidden();

  // The word wears the style on the canvas, drawn by the site's own CSS for it, before the page is saved.
  const styled = editor.locator("span.ts-sunset", { hasText: "awesome" });
  await expect(styled).toBeVisible();
  expect(await styled.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("linear-gradient");

  await page.keyboard.press("Enter");
  await expect(page.locator('[data-builder-item="block"] h2 span.ts-sunset')).toHaveText("awesome");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();

  const sql = testDb();
  try {
    const [row] = await sql`select draft from commerce.pages where id = ${pageId}`;
    expect(JSON.stringify(row.draft)).toContain('My <span class=\\"ts-sunset\\">awesome</span> heading');
  } finally {
    await sql.end();
  }
});

test("a rich text's HTML is edited, read back with what was left out named, and its styled words drawn", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await page.locator('[data-builder-item="column"]').first().getByRole("button", { name: /^Add rich text/ }).click();
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  const html = page.getByLabel(/^HTML of /);
  await expect(html).toBeVisible();
  await html.fill('<p>Hello <span class="ts-sunset">world</span></p><div>boxed</div>');
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Left out of the HTML: <div>." })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator('[data-builder-item="block"] .rich-text span.ts-sunset')).toHaveText("world");
});
