import { expect, test, type Locator, type Page } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Dual page (D412, docs/dual-page.md): two documents side by side in one builder. A row dragged from one page onto the other is
 * copied there and stays where it was; a part the other kind of page cannot hold is refused with the reason; Publish both publishes
 * both; Custom CSS edits either page; Create new asks which kind, then side by side or on its own.
 */

const canvas = (page: Page, side: "left" | "right") => page.locator(`[data-dual-side="${side}"]`);
const rowsOf = (where: Locator) => where.locator('[data-builder-item="row"]');

/** Drags the row's handle and drops it on the other canvas's foot, in small steps as a person's pointer moves. */
async function dragRowOnto(page: Page, row: Locator, target: Locator) {
  await row.hover();
  const handle = row.getByRole("button", { name: /^Drag row \d+ to move it$/ });
  await expect(handle).toBeVisible();
  const start = (await handle.boundingBox())!;
  // The tools show while the row is pointed at: the pointer comes up to the handle from inside the row, as a person's does.
  await page.mouse.move(start.x + start.width / 2, start.y + start.height + 8);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2 + 12, { steps: 4 });
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height - 40, 400), { steps: 16 });
  await page.mouse.up();
}

test.describe("dual page", () => {
  test.use({ storageState: OWNER.state });

  test("a row dragged to the other page is copied there with its text, and stays where it was", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/admin/${E2E_STORE}/pages/new?with=new:article`);
    await expect(canvas(page, "left")).toBeVisible();
    await expect(canvas(page, "right")).toBeVisible();
    await expect(canvas(page, "left")).toHaveAttribute("data-dual-active", "");

    // A heading on the left page, written where it stands.
    const left = canvas(page, "left");
    await page.getByRole("tab", { name: "Components" }).click();
    const leftRow = rowsOf(left).first();
    await leftRow.locator('[data-builder-item="column"]').first().click({ position: { x: 6, y: 6 } });
    await page.getByRole("button", { name: "Add heading" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    const rightBefore = await rowsOf(canvas(page, "right")).count();
    const leftBefore = await rowsOf(left).count();

    await dragRowOnto(page, leftRow, canvas(page, "right"));
    await expect(rowsOf(canvas(page, "right"))).toHaveCount(rightBefore + 1);
    await expect(rowsOf(left)).toHaveCount(leftBefore);
    await expect(canvas(page, "right").getByText("Copied from the other page.")).toBeVisible();
    // What lands is worked on next: the right page is the active one.
    await expect(canvas(page, "right")).toHaveAttribute("data-dual-active", "");
    // A copy has ids of its own: the two rows are not one.
    const leftIds = await rowsOf(left).evaluateAll((rows) => rows.map((r) => r.getAttribute("data-builder-id")));
    const rightIds = await rowsOf(canvas(page, "right")).evaluateAll((rows) => rows.map((r) => r.getAttribute("data-builder-id")));
    expect(rightIds.filter((id) => leftIds.includes(id))).toEqual([]);
  });

  test("a header's row with the site's logo is refused on a page, saying why", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/admin/${E2E_STORE}/pages/new?with=new:header`);
    const right = canvas(page, "right");
    await right.click({ position: { x: 20, y: 20 } });
    await expect(right).toHaveAttribute("data-dual-active", "");
    const before = await rowsOf(canvas(page, "left")).count();
    await dragRowOnto(page, rowsOf(right).first(), canvas(page, "left"));
    await expect(canvas(page, "left").getByText(/^Not copied: Site components belong in headers and footers/)).toBeVisible();
    await expect(rowsOf(canvas(page, "left"))).toHaveCount(before);
  });

  test("Publish both publishes the two, and the address keeps both", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/admin/${E2E_STORE}/pages/new?with=new:article`);
    const stamp = Date.now().toString(36);
    await page.getByLabel("Title", { exact: true }).fill(`Dual left ${stamp}`);
    await canvas(page, "right").click({ position: { x: 20, y: 20 } });
    await expect(canvas(page, "right")).toHaveAttribute("data-dual-active", "");
    await page.getByLabel("Title", { exact: true }).fill(`Dual right ${stamp}`);
    await page.getByRole("button", { name: "Publish both" }).click();
    // The checker may ask about the new pages' empty texts: publishing anyway is the owner's choice.
    const anyway = page.getByRole("button", { name: /Publish anyway/ });
    if (await anyway.isVisible({ timeout: 1500 }).catch(() => false)) await anyway.click();
    await expect(page.getByText("Both published.")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}\?with=article%3A[0-9a-f-]{36}$/);
    // Reloaded, the address opens both again.
    await page.reload();
    await expect(canvas(page, "right")).toBeVisible();
    await expect(canvas(page, "right").getByText(`Dual right ${stamp}`)).toBeVisible();
  });

  test("scrolling together and Custom CSS on either page", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/admin/${E2E_STORE}/pages/new?with=new:article`);
    await expect(page.getByLabel("Scroll together")).toBeChecked();
    await page.getByRole("button", { name: "Custom CSS" }).click();
    const sides = page.getByRole("radiogroup", { name: "Which page" });
    await expect(sides.getByRole("radio", { name: "Left page" })).toHaveAttribute("aria-checked", "true");
    await sides.getByRole("radio", { name: "Right page" }).click();
    await expect(sides.getByRole("radio", { name: "Right page" })).toHaveAttribute("aria-checked", "true");
  });

  test("Create new asks which kind, and side by side opens it next to this one", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/admin/${E2E_STORE}/pages/new`);
    await expect(page.locator("[data-dual-side]")).toHaveCount(0);
    await page.getByRole("button", { name: "Create new" }).click();
    const dialog = page.getByRole("dialog", { name: "Create new" });
    await dialog.getByRole("radio", { name: "Footer" }).check();
    await dialog.getByRole("button", { name: /^Side by side/ }).click();
    await expect(page).toHaveURL(/\/pages\/new\?with=new%3Afooter$/);
    await expect(canvas(page, "right")).toBeVisible();
    await expect(canvas(page, "right").getByText("Footer", { exact: false }).first()).toBeVisible();
  });

  test("a saved template opens beside a page, takes a row copied from it, and is saved back", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const name = `Dual template ${Date.now().toString(36)}`;
    const sql = testDb();
    let id: string;
    try {
      const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
      const layout = {
        pageType: "page",
        css: "",
        rows: [{ id: "tpl-row", type: "row", layout: "1", columns: [{ id: "tpl-col", blocks: [{ id: "tpl-h", type: "heading", text: "From the template", level: 2 }] }] }],
      };
      [{ id }] = await sql`insert into commerce.saved_parts (store_id, kind, name, content) values (${store.id}, 'page', ${name}, ${sql.json(layout)}) returning id`;
    } finally {
      await sql.end();
    }

    // Open beside offers the store's saved templates.
    await page.goto(`/admin/${E2E_STORE}/pages/new`);
    await page.getByRole("button", { name: "Open beside" }).click();
    const dialog = page.getByRole("dialog", { name: "Open a page beside this one" });
    await dialog.getByLabel("Kind").selectOption("template");
    await dialog.getByRole("button", { name }).click();
    await expect(page).toHaveURL(new RegExp(`/pages/new\\?with=template%3A${id}$`));
    const right = canvas(page, "right");
    await expect(right.getByText("Saved template", { exact: false }).first()).toBeVisible();
    await expect(right.getByText("From the template")).toBeVisible();

    await page.getByLabel("Title", { exact: true }).fill(`Beside a template ${Date.now().toString(36)}`);
    await dragRowOnto(page, rowsOf(canvas(page, "left")).first(), right);
    await expect(rowsOf(right)).toHaveCount(2);
    await page.getByRole("button", { name: "Save both" }).click();
    await expect(page.getByText("Both saved as drafts.")).toBeVisible({ timeout: 20_000 });
    const check = testDb();
    try {
      const [saved] = await check`select content from commerce.saved_parts where id = ${id}`;
      expect((saved.content as { rows: unknown[] }).rows).toHaveLength(2);
    } finally {
      await check.end();
    }
  });
});
