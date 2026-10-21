import { expect, test, type Page } from "@playwright/test";

import { testDb } from "./db";

/**
 * A footer revealed on scroll (D184) is pinned under the page only where it can be seen whole: the page above it at least a screen
 * tall, and the footer itself no taller than the screen (on a phone, the screen above the bottom bar). Otherwise it stays where it
 * always is, in the page's flow.
 */
const content = (title: string, rows: unknown[], extra: Record<string, unknown> = {}) => ({
  title,
  slug: title.toLowerCase(),
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows,
  ...extra,
});
const row = (id: string, text: string, padding: number, more: unknown[] = []) => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, inline: true, blocks: [{ id: `${id}-h`, type: "heading", text, level: 2 }, ...more] }],
  style: { padding: { top: padding, right: 20, bottom: padding, left: 20 } },
});

/** A store whose revealed footer has `lines` rows of words, with a long page. */
async function storeWithFooter(lines: number) {
  const slug = `reveal-${lines}-${Date.now()}`;
  // A footer keeps the business details and the cookies link (`siteLayoutProblem()`).
  const parts = [{ id: "b", type: "site", part: "business" }, { id: "k", type: "site", part: "cookies" }];
  const footer = content(
    "Bunn",
    Array.from({ length: lines }, (_, n) => row(`f${n}`, n === 0 ? "Bunnen" : `Linje ${n}`, 100, n === 0 ? parts : [])),
    { footerReveal: true },
  );
  const long = content("Lengre", [1, 2, 3, 4, 5, 6].map((n) => row(`l${n}`, `Del ${n}`, 240)));
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null) as id`;
    const add = (type: string, value: ReturnType<typeof content>) => sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}, ${type}, ${value.slug}, ${sql.json(value as never)}, ${sql.json(value as never)}, now()) returning id`;
    const [[{ id: footerId }]] = await Promise.all([add("footer", footer), add("page", long)]);
    await sql`update commerce.stores set footer_id = ${footerId} where id = ${storeId}`;
  } finally {
    await sql.end();
  }
  return slug;
}

async function scrollToEnd(page: Page) {
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
}

const pinned = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute("data-footer-reveal"));
const footerPosition = (page: Page) => page.locator(".site-footer").evaluate((el) => getComputedStyle(el).position);

test("a footer that fits the screen is revealed, one taller than the screen stays in the page's flow (D184)", async ({ page }) => {
  const [short, tall] = [await storeWithFooter(1), await storeWithFooter(5)];
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(`/s/${short}/lengre`);
  await scrollToEnd(page);
  expect(await pinned(page)).toBe(true);
  expect(await footerPosition(page)).toBe("sticky");

  await page.goto(`/s/${tall}/lengre`);
  await expect(page.locator(".site-footer")).toBeVisible();
  expect(await page.locator(".site-footer").evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThan(800);
  await scrollToEnd(page);
  expect(await pinned(page)).toBe(false);
  expect(await footerPosition(page)).toBe("static");

  // A screen made shorter than a footer that fitted lets it go back into the flow.
  await page.goto(`/s/${short}/lengre`);
  await scrollToEnd(page);
  expect(await pinned(page)).toBe(true);
  const height = await page.locator(".site-footer").evaluate((el) => (el as HTMLElement).offsetHeight);
  await page.setViewportSize({ width: 1280, height: height - 20 });
  await page.waitForTimeout(300);
  expect(await pinned(page)).toBe(false);
});

test("on a phone a footer is revealed only when it fits above the bottom bar (D184)", async ({ page }) => {
  const slug = await storeWithFooter(2);
  await page.setViewportSize({ width: 390, height: 3000 });
  await page.goto(`/s/${slug}/lengre`);
  const height = await page.locator(".site-footer").evaluate((el) => (el as HTMLElement).offsetHeight);
  // A screen a little taller than the footer, so it fits the screen but not the room above the 64 px bottom bar.
  await page.setViewportSize({ width: 390, height: height + 30 });
  await page.goto(`/s/${slug}/lengre`);
  await scrollToEnd(page);
  expect(await pinned(page)).toBe(false);
  expect(await footerPosition(page)).toBe("static");
  // With room for it above the bar, it is revealed.
  await page.setViewportSize({ width: 390, height: height + 100 });
  await page.goto(`/s/${slug}/lengre`);
  await scrollToEnd(page);
  expect(await pinned(page)).toBe(true);
});
