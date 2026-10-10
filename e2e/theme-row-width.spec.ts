import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * The theme's Row says how wide every row is and what it holds (D190): a row that chooses nothing takes the theme's, a row's own
 * choice wins. Arranged in the database as the page builder's Theme tab and rows save it.
 */

const column = (id: string, words: string) => ({ id, blocks: [{ id: `${id}-b`, type: "heading", text: words, level: 2 }] });
const row = (id: string, words: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "row",
  layout: "1",
  background: { type: "color", color: "#e8eefc" },
  columns: [column(`${id}-c`, words)],
  ...extra,
});

/** A new store whose theme's Row is `element`, with one published page of the rows; returns the page's address. */
async function storeWith(element: Record<string, unknown>, rows: unknown[]): Promise<string> {
  const slug = `radbredde-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Test', 'Radbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Radbutikk', null) as id`;
    await sql`update commerce.stores set theme = ${sql.json({ base: "minimal", settings: { elements: { row: element } } } as never)} where id = ${id}`;
    const content = {
      title: "Bredde",
      slug: "bredde",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows,
    };
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${id}, 'bredde', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
  } finally {
    await sql.end();
  }
  return `/s/${slug}/bredde`;
}

test("a theme that spans the screen makes every row span it, unless a row chooses the content's width", async ({ page }) => {
  const url = await storeWith({ width: "full" }, [
    row("a", "Følger temaet"),
    row("b", "Velger innholdets bredde", { width: "content" }),
  ]);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(url);
  const width = async (selector: string) => (await page.locator(selector).first().boundingBox())!.width;

  // The row with no choice of its own spans the screen; the one that chose keeps to the content's width (1024 px).
  expect(await width(".kz-a")).toBeGreaterThan(1300);
  expect(await width(".kz-b")).toBeLessThanOrEqual(1030);
  // What a full-width row holds keeps to the content's width unless the theme says it spreads.
  expect(await width(".kz-a-c")).toBeLessThanOrEqual(1030);
});

test("a theme that also lets what rows hold spread makes their content span the screen, unless a row keeps it", async ({ page }) => {
  const url = await storeWith({ width: "full", contentWidth: "full" }, [
    row("a", "Sprer seg"),
    row("b", "Holder innholdet", { width: "full", contentWidth: "content" }),
  ]);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(url);
  const width = async (selector: string) => (await page.locator(selector).first().boundingBox())!.width;

  expect(await width(".kz-a")).toBeGreaterThan(1300);
  expect(await width(".kz-a-c")).toBeGreaterThan(1300);
  expect(await width(".kz-b")).toBeGreaterThan(1300);
  expect(await width(".kz-b-c")).toBeLessThanOrEqual(1030);
});

test("a store without it keeps its rows to the content's width, as always", async ({ page }) => {
  const url = await storeWith({ radius: 0 }, [row("a", "Som før")]);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(url);
  expect((await page.locator(".kz-a").first().boundingBox())!.width).toBeLessThanOrEqual(1030);
});
