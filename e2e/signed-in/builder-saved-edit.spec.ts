import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * A saved row, column, component or page layout is changed on the builder's own canvas (D46, D127), with every tool the page has:
 * opened from Saved, its content stands in for the page's rows; saved, it goes back into the saved part and the page comes back as
 * it was.
 */
test.use({ storageState: OWNER.state });

const RUN = Date.now().toString(36);
const NAME = `Edit me ${RUN}`;
let partId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const content = {
      id: `row-${RUN}`,
      type: "row",
      layout: "1",
      columns: [{ id: `col-${RUN}`, blocks: [{ id: `head-${RUN}`, type: "heading", text: `Saved words ${RUN}`, level: 2 }] }],
    };
    const [row] = await sql`
      insert into commerce.saved_parts (store_id, kind, name, content) values (${store.id}, 'row', ${NAME}, ${sql.json(content)}) returning id`;
    partId = String(row.id);
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.saved_parts where id = ${partId}::uuid`;
  } finally {
    await sql.end();
  }
});

test("a saved row is edited on the canvas and saved back, and the page comes back as it was", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  const rows = page.locator('[data-builder-item="row"]');
  await expect(rows.first()).toBeVisible();
  const pageRows = await rows.count();

  await page.getByRole("tab", { name: "Saved" }).click();
  await page.getByRole("button", { name: new RegExp(`^${NAME}, saved row`) }).press("Enter");
  await page.getByRole("button", { name: "Edit on the canvas" }).click();

  // The canvas holds the saved row alone, with the bar that says so.
  const bar = page.locator("[data-part-canvas]");
  await expect(bar).toContainText(NAME);
  await expect(rows).toHaveCount(1);
  await expect(page.getByText(`Saved words ${RUN}`)).toBeVisible();
  // Saving one row as two is refused: a saved row is one row.
  await page.getByRole("tab", { name: "Rows" }).click();
  await page.getByRole("button", { name: "Add 2 columns" }).press("Enter");
  await expect(rows).toHaveCount(2);
  await bar.getByRole("button", { name: "Save the row" }).click();
  await expect(bar.getByRole("alert")).toContainText("A saved row is one row");
  // The new row taken away again, the row's own columns changed with the canvas's tools, and saved.
  await rows.last().hover();
  // An empty row goes at once; one with content asks first.
  await page.getByRole("button", { name: /^Delete row 2/ }).click();
  await expect(rows).toHaveCount(1);
  await rows.first().locator('[data-builder-item="column"]').first().click({ position: { x: 6, y: 6 } });
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add heading", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Done" }).click();
  await bar.getByRole("button", { name: "Save the row" }).click();

  // The page is back, as it was; the saved row holds two components now.
  await expect(bar).toHaveCount(0);
  await expect(rows).toHaveCount(pageRows);
  const sql = testDb();
  try {
    const [saved] = await sql`select content from commerce.saved_parts where id = ${partId}::uuid`;
    const blocks = (saved.content as { columns: { blocks: { type: string; text?: string }[] }[] }).columns[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "heading", text: `Saved words ${RUN}` });
  } finally {
    await sql.end();
  }
});
