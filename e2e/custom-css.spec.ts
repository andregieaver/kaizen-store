import { expect, test } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * Owners' own CSS (D100): a page's on that page only, the store's on every
 * page; and CSS that could not have been saved is never drawn.
 */

test("a page's own CSS styles that page; the store's styles every page", async ({ page }) => {
  const address = await storePageWith("css", [{ id: "h", type: "heading", text: "Velkommen", level: 1 }]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    await sql`
      update commerce.pages set
        draft = jsonb_set(draft, '{css}', ${sql.json("h1 { color: rgb(180, 83, 42); }")}),
        published = jsonb_set(published, '{css}', ${sql.json("h1 { color: rgb(180, 83, 42); }")})
      where slug = 'side' and store_id = (select id from commerce.stores where slug = ${slug})`;
    await sql`update commerce.stores set custom_css = 'footer { outline: 3px solid rgb(1, 2, 3); }' where slug = ${slug}`;
  } finally {
    await sql.end();
  }

  await page.goto(address);
  const color = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
  await expect.poll(() => color("h1")).toBe("rgb(180, 83, 42)");
  const outline = () => page.locator("footer").first().evaluate((el) => getComputedStyle(el).outlineColor);
  expect(await outline()).toBe("rgb(1, 2, 3)");

  // Another page of the store: the store's CSS, not the page's.
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  expect(await outline()).toBe("rgb(1, 2, 3)");
  expect(await color("h1")).not.toBe("rgb(180, 83, 42)");
});

test("CSS that could not have been saved is never drawn", async ({ page }) => {
  const address = await storePageWith("badcss", [{ id: "h", type: "heading", text: "Hei", level: 1 }]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    // Written past the checks, as a damaged value would be.
    await sql`update commerce.stores set custom_css = ${"h1 { color: red } </style><script>window.escaped = true</script><style>"} where slug = ${slug}`;
  } finally {
    await sql.end();
  }
  await page.goto(address);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hei");
  expect(await page.evaluate(() => (window as unknown as { escaped?: boolean }).escaped)).toBeUndefined();
  expect(await page.locator("h1").evaluate((el) => getComputedStyle(el).color)).not.toBe("rgb(255, 0, 0)");
});
