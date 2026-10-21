import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The page builder's undo and redo and a page's versions (D305), and Custom CSS on the live site (D306), as the store's owner uses them:
 * a change undone and redone from the buttons and the keys, a saved version taken back into the editor, and the page's CSS typed on the
 * published page, shown as it is typed and kept when saved. Find and replace (D307): words found across the page, some left as
 * they are, the rest replaced in one step that Undo takes back.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const SLUG = `history-${RUN}`;
let pageId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const content = {
      title: "Historie",
      slug: SLUG,
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [{ id: "row-h", type: "row", layout: "1", columns: [{ id: "col-h", blocks: [{ id: "head-h", type: "heading", text: "Vi har historie", level: 2 }] }] }],
    };
    const [row] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${store.id}, ${SLUG}, ${sql.json(content)}, ${sql.json(content)}, now()) returning id`;
    pageId = String(row.id);
  } finally {
    await sql.end();
  }
});

const title = (page: Page) => page.getByLabel("Title", { exact: true });

test("a change is undone and redone, from the buttons and the keys, and a saved version is taken back", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await expect(undo).toBeDisabled();

  await title(page).fill("Historie, ny");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(title(page)).toHaveValue("Historie");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(title(page)).toHaveValue("Historie, ny");

  // The keys work outside a field (a field undoes its own typing).
  await page.locator("[data-editor-bar]").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(title(page)).toHaveValue("Historie");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(title(page)).toHaveValue("Historie, ny");

  // Saved, it is a version; an earlier one is taken back as unsaved changes.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  await title(page).fill("Historie, igjen");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();

  await page.getByRole("button", { name: "Versions" }).click();
  const dialog = page.getByRole("dialog", { name: "Versions" });
  const list = dialog.getByRole("list", { name: "Versions, newest first" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").first()).toContainText("Historie, igjen");
  await list.getByRole("listitem").nth(1).getByRole("button", { name: "Use this version" }).click();
  await expect(dialog).toBeHidden();
  await expect(title(page)).toHaveValue("Historie, ny");
  await expect(page.getByRole("status").filter({ hasText: "Undo takes it back" })).toBeVisible();
  await undo.click();
  await expect(title(page)).toHaveValue("Historie, igjen");
});

test("words are found and replaced across the page in one step that Undo takes back", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await title(page).fill("Historie og historie");
  await page.locator("[data-editor-bar]").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+Shift+h");
  const dialog = page.getByRole("dialog", { name: "Find and replace" });
  await dialog.getByLabel("Find", { exact: true }).fill("historie");
  await expect(dialog.getByRole("status")).toHaveText("Found 3 in 2 texts.");
  await dialog.getByLabel("Replace with").fill("fortid");

  // Lisa leaves the heading as it is.
  await dialog.getByRole("button", { name: "More choices" }).click();
  const places = dialog.getByRole("list", { name: "Where it was found" });
  await places.getByRole("listitem").filter({ hasText: "Heading" }).getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "Replace all 2" }).click();
  await expect(dialog).toBeHidden();
  await expect(title(page)).toHaveValue("fortid og fortid");
  await expect(page.getByRole("status").filter({ hasText: "Replaced 2 matches." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vi har historie" })).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(title(page)).toHaveValue("Historie og historie");
});

test("the page's CSS is typed on the live page, shown as it is typed, and kept when saved", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  const view = await page.getByRole("link", { name: "View page" }).getAttribute("href");
  expect(view).toBeTruthy();
  await page.goto(view!);
  const heading = page.getByRole("heading", { name: "Vi har historie" });
  await expect(heading).toBeVisible();
  const colour = () => heading.evaluate((el) => getComputedStyle(el).color);
  const before = await colour();

  await page.getByRole("button", { name: /Custom CSS/ }).click();
  const panel = page.getByRole("dialog", { name: "Custom CSS" });
  const box = panel.getByLabel("This page's CSS");
  await box.fill("h2 { color: rgb(200, 10, 10) !important; }");
  // Shown on the page as it is typed, before anything is saved.
  await expect.poll(colour).toBe("rgb(200, 10, 10)");
  // CSS that is refused is not drawn, and cannot be saved.
  await box.fill("@import url(x.css);");
  await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled();
  await box.fill("h2 { color: rgb(10, 120, 10) !important; }");
  await expect.poll(colour).toBe("rgb(10, 120, 10)");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "CSS saved." })).toBeVisible();

  // Kept: a fresh load draws it from the page itself.
  await page.reload();
  await expect.poll(colour).toBe("rgb(10, 120, 10)");
  expect(before).not.toBe("rgb(10, 120, 10)");

  // Closing without saving gives the page back what it had.
  await page.getByRole("button", { name: /Custom CSS/ }).click();
  await panel.getByLabel("This page's CSS").fill("h2 { color: rgb(1, 2, 3) !important; }");
  await expect.poll(colour).toBe("rgb(1, 2, 3)");
  page.once("dialog", (question) => void question.accept());
  await panel.getByRole("button", { name: "Close" }).click();
  await expect.poll(colour).toBe("rgb(10, 120, 10)");
});
