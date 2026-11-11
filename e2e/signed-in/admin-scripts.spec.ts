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
 * Each screen's budget, by its address under the store (`{page}` is one of the store's pages). Measured on the build of 4 November 2026
 * from the HTML the server sends: home 2.37 MB, products 2.36, a new product 3.27, orders 2.37, pages 3.16, a page in the builder 4.39,
 * settings 2.34. About 4 % of room. On 31 October they were 3.02, 3.02, 3.71, 3.02, 3.59 (4.71 before the page lists stopped importing
 * the builder), 4.70 and 3.00; by 4 November each had grown about 0.1 MB, and the docs guide's entry in the admin map took the builder
 * over (4,901,307 bytes, D444). The AI manager's chat, and the admin map it names the page from, is now fetched when its panel is first
 * opened, not with every screen (`ai-manager-launcher.tsx`): 0.51 to 0.76 MB off each. On 10 November the admin's English, every area's,
 * left the first scripts (`admin-text-later.ts`): about 1.1 MB off each.
 */
const BUDGETS: Record<string, number> = {
  // Measured 10 November 2026 once the admin's English was fetched per area (PSI PERF-01): home 1,284,745, products 1,257,183, a new
  // product 2,221,325, orders 1,275,688, pages 2,093,288, a page in the builder 3,341,746, settings 1,229,972 bytes; about 4 % of room.
  "": 1_340_000,
  "/products": 1_310_000,
  "/products/new": 2_310_000,
  "/orders": 1_330_000,
  "/pages": 2_180_000,
  "/pages/{page}": 3_480_000,
  "/settings": 1_280_000,
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
