import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A long table in a pop-up (D203) scrolls inside itself: the pop-up has no scrollbar, the header stays at the top, and each section title
 * stays under it until the next one takes its place.
 */

const body = Array.from({ length: 40 }, (_, i) => [`Rad ${i + 1}`, `${i + 1} kr`]);
// Row index in `rows`: 0 is the header; dividers above rows 1 and 21.
const table = { id: "t1", type: "table", header: true, rows: [["Navn", "Pris"], ...body], sections: [null, "Del A", ...Array(19).fill(null), "Del B"] };

async function arrange() {
  const slug = `tabmodal-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'Tabellbutikk') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Tabellbutikk', null) as id`;
    const content = {
      title: "Side", slug: "side", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [],
      rows: [
        { id: "r0", type: "row", layout: "1", columns: [{ id: "c0", blocks: [{ id: "b0", type: "button", label: "Åpne", href: "#modal-liste" }] }] },
        { id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "h1", type: "heading", text: "Prisliste", level: 2 }, { id: "p1", type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Alle våre priser." }] }] } }, table] }], modal: { key: "liste", frequency: "always", size: "md", triggers: { button: true } } },
      ],
    };
    await sql`insert into commerce.pages (store_id, slug, draft, published, published_at) values (${storeId}, 'side', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
    return `/s/${slug}/side`;
  } finally {
    await sql.end();
  }
}

test("a long table in a pop-up scrolls itself, with its header and section titles kept in view", async ({ page }) => {
  const url = await arrange();
  await page.setViewportSize({ width: 1200, height: 520 });
  await page.goto(url);
  await page.getByRole("link", { name: "Åpne" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const box = dialog.locator(".kz-table-box");
  const scrolls = await box.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(scrolls).toBe(true);
  // The title and text above the table stay in view too: the table took only what was left.
  await expect(dialog.getByRole("heading", { name: "Prisliste" })).toBeInViewport();
  // The pop-up itself does not scroll: everything it holds is inside it.
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);

  // Scroll the table: the header stays at its top.
  await box.evaluate((el) => (el.scrollTop = 300));
  const boxTop = (await box.boundingBox())!.y;
  const head = dialog.locator("thead th").first();
  expect(Math.abs((await head.boundingBox())!.y - boxTop)).toBeLessThan(2);

  // Section A's title sits right under the header while its rows scroll; further down, B's takes its place.
  const headHeight = (await head.boundingBox())!.height;
  const a = dialog.getByRole("columnheader", { name: "Del A" });
  expect(Math.abs((await a.boundingBox())!.y - (boxTop + headHeight))).toBeLessThan(3);
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const b = dialog.getByRole("columnheader", { name: "Del B" });
  expect(Math.abs((await b.boundingBox())!.y - (boxTop + headHeight))).toBeLessThan(3);
});

test("on a phone the pop-up uses the height it has, and the section title stays at the top of the table", async ({ page }) => {
  const url = await arrange();
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(url);
  await page.getByRole("link", { name: "Åpne" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = dialog.locator(".kz-table-box");
  // The table takes the room the pop-up has: well over half the screen.
  expect((await box.boundingBox())!.height).toBeGreaterThan(350);
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await box.evaluate((el) => (el.scrollTop = 600));
  const boxTop = (await box.boundingBox())!.y;
  const title = dialog.getByRole("columnheader", { name: /Del [AB]/ }).first();
  await expect.poll(async () => Math.abs((await title.boundingBox())!.y - boxTop)).toBeLessThan(3);
});

test("with little room in the pop-up, the pop-up scrolls and the header and section titles stick to its top", async ({ page }) => {
  const url = await arrange();
  await page.setViewportSize({ width: 375, height: 420 });
  await page.goto(url);
  await page.getByRole("link", { name: "Åpne" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const panel = dialog.locator(".page-modal-panel");
  await expect(dialog.locator(".kz-table-box")).toHaveAttribute("data-fit", "panel");
  await panel.evaluate((el) => (el.scrollTop = 700));
  const top = (await panel.boundingBox())!.y;
  const title = dialog.getByRole("columnheader", { name: /Del [AB]/ }).first();
  await expect.poll(async () => Math.abs((await title.boundingBox())!.y - top)).toBeLessThan(3);
});
