import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The admin's first scripts (PSI PERF-01's follow-up, `docs/performance.md` *The admin as people use it*): the screens people use most,
 * signed in, each under its own budget, raw (before compression) as `e2e/performance.spec.ts` holds the visitor's routes. The editors
 * and settings were the slow screens of the field's p75. A change that passes one is a regression to look at, not a number to raise.
 */
test.use({ storageState: OWNER.state });

/**
 * The scripts the screen's HTML asks for, as the server sends it (signed in), each fetched with its text: never what the page has loaded
 * by the time it is looked at, which grows with what it does after.
 */
async function firstScripts(page: Page, address: string): Promise<number> {
  const html = await (await page.request.get(address)).text();
  const urls = [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => new URL(match[1].replace(/&amp;/g, "&"), page.url()).href))];
  const sizes = await Promise.all(urls.map(async (url) => (await (await page.request.get(url)).text()).length));
  return sizes.reduce((sum, size) => sum + size, 0);
}

const MEASURE = process.env.E2E_MEASURE === "1";

/**
 * Each screen's budget, by its address under the store (`{page}` is one of the store's pages). Measured on the build of 31 October 2026
 * from the HTML the server sends: home 3.02 MB, products 3.02, a new product 3.71, orders 3.02, pages 3.59 (4.71 before the page lists
 * stopped importing the builder), a page in the builder 4.70, settings 3.00. About 4 % of room. The 3.0 MB every screen shares is the
 * admin's layout and what it imports, not yet broken down.
 */
const BUDGETS: Record<string, number> = {
  "": 3_150_000,
  "/products": 3_150_000,
  "/products/new": 3_870_000,
  "/orders": 3_150_000,
  "/pages": 3_740_000,
  "/pages/{page}": 4_900_000,
  "/settings": 3_130_000,
};

for (const [path, max] of Object.entries(BUDGETS)) {
  test(`the admin's ${path || "home"} first scripts stay within their budget`, async ({ page }) => {
    let address = path;
    if (path.includes("{page}")) {
      const sql = testDb();
      try {
        const [row] = await sql`
          select p.id from commerce.pages p join commerce.stores s on s.id = p.store_id
          where s.slug = ${E2E_STORE} and p.type = 'page' order by p.created_at limit 1`;
        address = path.replace("{page}", String(row.id));
      } finally {
        await sql.end();
      }
    }
    await page.goto(`/admin/${E2E_STORE}${address}`);
    await expect(page.locator("main").first()).toBeVisible();
    const total = await firstScripts(page, `/admin/${E2E_STORE}${address}`);
    if (MEASURE) console.log(`[admin-scripts] ${path || "/"} ${total} ${page.url()}`);
    else expect(total, `${path || "/"} first scripts: ${total} bytes`).toBeLessThan(max);
  });
}
