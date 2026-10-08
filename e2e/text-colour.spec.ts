import { expect, test } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Text colour and opacity (D180, `docs/text-colour.md`): a colour set in a part's Typography reaches the live page at the
 * screen sizes it is set for, a row's colour passes down to text that sets none, and rich text's colour mark is drawn as a
 * style on the words.
 */

const doc = (content: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content }] });

test("a text colour and its opacity reach the live page at two screen sizes", async ({ page }) => {
  const { slug, id } = await testStore("text-colour");
  const sql = testDb();
  try {
    const content = {
      title: "Farger",
      slug: "farger",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [
        {
          id: "r1",
          type: "row",
          layout: "1",
          // The row's colour: its text that sets none takes it.
          typography: { text: { color: "#14532d" } },
          columns: [
            {
              id: "c1",
              blocks: [
                // Dark red from Extra large, blue at half strength on Small.
                { id: "h1", type: "heading", text: "Fargerik", level: 2, typography: { text: { color: "#7f1d1d" } }, at: { sm: { typography: { text: { color: "#1e3a8a", opacity: 50 } } } } },
                { id: "t1", type: "richText", doc: doc([{ type: "text", text: "Arvet " }, { type: "text", text: "merket", marks: [{ type: "textStyle", attrs: { color: "#581c87", opacity: 40 } }] }]) },
              ],
            },
          ],
        },
      ],
    };
    await sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${id}, 'page', 'farger', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
  } finally {
    await sql.end();
  }

  const colour = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/s/${slug}/no/farger`);
  expect(await colour("main h2")).toBe("rgb(127, 29, 29)");
  // Inherited from the row.
  expect(await colour("main .rich-text p")).toBe("rgb(20, 83, 45)");
  // The mark: a style on the words, see-through.
  const marked = page.locator('main .rich-text span[style*="color"]');
  await expect(marked).toHaveText("merket");
  expect(await marked.evaluate((el) => getComputedStyle(el).color)).toMatch(/^(rgba\(88, 28, 135, 0\.4\)|color\(srgb 0\.345\d* 0\.109\d* 0\.529\d* \/ 0\.4\))$/);

  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  expect(await colour("main h2")).toMatch(/^(rgba\(30, 58, 138, 0\.5\)|color\(srgb 0\.117\d* 0\.227\d* 0\.541\d* \/ 0\.5\))$/);
  expect(await colour("main .rich-text p")).toBe("rgb(20, 83, 45)");
});
