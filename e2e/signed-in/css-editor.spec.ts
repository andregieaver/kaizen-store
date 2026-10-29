import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The CSS panel's code editor (D394) as the store's owner uses it: the CSS highlighted, Tab indents rather than leaving the field, CSS's
 * own properties suggested as they are typed, a class given to one of the page's parts suggested after a `.`, and what is typed
 * reaching the page's draft; the panel made wider by its edge and keeping that width. On the live site the same editor, in a panel above
 * the site's header and chat that is moved by its title bar and resized from its edges, and is where it was left when opened again.
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
    const [row] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${store.id}, ${SLUG}, ${sql.json(content)}, ${sql.json(content)}, now()) returning id`;
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

test("the builder's CSS panel is made wider by its edge and keeps the width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await page.getByRole("button", { name: /Custom CSS/ }).click();
  const panel = page.locator("#css-panel");
  await expect(panel).toBeVisible();
  const before = (await panel.boundingBox())!;
  const handle = (await panel.getByRole("separator", { name: "Panel width" }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 200, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before.width) + 200);

  // Kept: opened again after a fresh load, it is as wide.
  await page.reload();
  await page.getByRole("button", { name: /Custom CSS/ }).click();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before.width) + 200);
  // A double press gives it its usual width.
  await panel.getByRole("separator", { name: "Panel width" }).dblclick();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before.width));
});

test("on the live site the CSS panel floats above the header and chat, moves and resizes, and is typed in the code editor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  const view = await page.getByRole("link", { name: "View page" }).getAttribute("href");
  await page.goto(view!);
  await page.getByRole("button", { name: /Custom CSS/ }).click();
  const panel = page.locator("[data-site-css-panel]");
  await expect(panel.locator("[data-css-editor] .cm-content")).toBeVisible();
  await expect(panel.locator("[data-css-editor] .cm-content")).toBeFocused();
  // Above the chat's window (z-index 90) and any header.
  expect(Number(await panel.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(90);
  const header = page.locator("header").first();
  if (await header.count()) {
    const z = await header.evaluate((el) => Number(getComputedStyle(el).zIndex) || 0);
    expect(Number(await panel.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(z);
  }

  const start = (await panel.boundingBox())!;
  // Moved by its title bar.
  const title = (await panel.locator("[data-panel-title] h2").boundingBox())!;
  await page.mouse.move(title.x + 5, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x - 300, title.y + 105, { steps: 5 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(Math.round(moved.x)).toBe(Math.round(start.x) - 305);
  expect(Math.round(moved.width)).toBe(Math.round(start.width));

  // Resized from its left edge and its bottom-right corner.
  const left = (await panel.locator('[data-panel-edge="w"]').boundingBox())!;
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await page.mouse.down();
  await page.mouse.move(left.x + left.width / 2 - 100, left.y + left.height / 2, { steps: 5 });
  await page.mouse.up();
  const wider = (await panel.boundingBox())!;
  expect(Math.round(wider.width)).toBe(Math.round(moved.width) + 100);
  expect(Math.round(wider.x + wider.width)).toBe(Math.round(moved.x + moved.width));
  const corner = (await panel.locator('[data-panel-edge="ne"]').boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 + 40, corner.y + corner.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  const resized = (await panel.boundingBox())!;
  expect(Math.round(resized.width)).toBe(Math.round(wider.width) + 40);
  expect(Math.round(resized.height)).toBe(Math.round(wider.height) - 60);

  // Typed in the code editor and shown on the page.
  const heading = page.getByRole("heading", { name: "Hello" });
  await panel.locator("[data-css-editor] .cm-content").fill(".hero-band h2 { color: rgb(200, 10, 10) !important; }");
  await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(200, 10, 10)");
  await panel.locator("[data-css-editor] .cm-content").fill("");
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();

  // Opened again, it is where it was left.
  await page.getByRole("button", { name: /Custom CSS/ }).click();
  await expect(panel).toBeVisible();
  const again = (await panel.boundingBox())!;
  expect(Math.round(again.x)).toBe(Math.round(resized.x));
  expect(Math.round(again.width)).toBe(Math.round(resized.width));
});
