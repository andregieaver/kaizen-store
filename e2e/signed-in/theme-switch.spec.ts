import { expect, test, type Locator, type Page } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * Switching theme is seamless (D246, `docs/theme-store.md` phase 2's test, `docs/theme-phase-2.md` step 5): the owner switches the store
 * through every launch theme and back from Design settings, and every content field (pages and articles, products with their texts,
 * variants and pictures, menus, the logo, business details and the store's own addresses) stays as it was; the storefront's words, pictures
 * and links stay the same, the theme's colours are what the site draws, and on a phone nothing runs off the screen. Each theme is installed
 * as the store would hold it (its look, not live), as installing a published theme leaves it.
 */

/**
 * A store of the owner's own for this test, so switching its look never meets another spec working on the shared store's look at the same
 * time (themes.spec.ts holds the live look still while it customises an installed theme).
 */
const E2E_STORE = "e2e-themes";
const design = `/admin/${E2E_STORE}/settings/design`;
const PREFIX = "E2E launch";
const titleOf = (title: string) => `${PREFIX} ${title}`;

/** Every content field of the store, as one fingerprint per kind: what switching theme must never change. */
async function contentOf(): Promise<Record<string, string>> {
  const sql = testDb();
  try {
    const [row] = await sql`
      with s as (select * from commerce.stores where slug = ${E2E_STORE})
      select
        md5(coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type, 'slug', p.slug, 'draft', p.draft, 'published', p.published) order by p.id)
                        from commerce.pages p, s where p.store_id = s.id and p.type in ('page', 'article')), '[]')::text) as pages,
        md5(coalesce((select jsonb_agg(to_jsonb(p) - 'updated_at' order by p.id) from commerce.products p, s where p.store_id = s.id), '[]')::text) as products,
        md5(coalesce((select jsonb_agg(to_jsonb(t) - 'search' - 'updated_at' order by t.product_id, t.locale)
                        from commerce.product_translations t join commerce.products p on p.id = t.product_id, s where p.store_id = s.id), '[]')::text) as texts,
        md5(coalesce((select jsonb_agg(to_jsonb(v) - 'updated_at' order by v.id)
                        from commerce.product_variants v join commerce.products p on p.id = v.product_id, s where p.store_id = s.id), '[]')::text) as variants,
        md5(coalesce((select jsonb_agg(to_jsonb(m) - 'updated_at' order by m.id) from commerce.product_media m join commerce.products p on p.id = m.product_id, s where p.store_id = s.id), '[]')::text) as pictures,
        md5(coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'items', m.items) order by m.id) from commerce.menus m, s where m.store_id = s.id), '[]')::text) as menus,
        (select md5(jsonb_build_array(s.name, s.navigation, s.seo, s.legal_name, s.organisation_number, s.contact_email, s.postal_address,
                    s.header_menu_id, s.footer_menu_id, s.front_page_id, s.products_page_id, s.locales)::text) from s) as brand
    `;
    return row as Record<string, string>;
  } finally {
    await sql.end();
  }
}

/** What a visitor reads on a page: the main content's words, its pictures and every link on the page, once what streams in is in. */
async function seen(page: Page, path: string, ready?: (page: Page) => Locator) {
  await page.goto(path);
  await expect(page.locator("main").first()).toBeVisible();
  if (ready) await expect(ready(page)).toBeVisible({ timeout: 15_000 });
  const read = () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      // The words as the page holds them, not as a theme sets them (capitals are CSS), without scripts, data or staff's own tools.
      const copy = main?.cloneNode(true) as HTMLElement | undefined;
      copy?.querySelectorAll("script, style, template, [data-staff-tools]").forEach((node) => node.remove());
      return {
        words: (copy?.textContent ?? "").replace(/\s+/g, " ").trim(),
        pictures: [...(main?.querySelectorAll("img") ?? [])].map((img) => img.getAttribute("src")).sort(),
        // The signed-in staff's way back to the admin follows the admin page last seen: it is not the store's content.
        links: [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? ""))].filter((href) => !href.startsWith("/admin")).sort(),
      };
    });
  // Stock and the buy box stream in: read until two readings a moment apart agree.
  let last = JSON.stringify(await read());
  await expect
    .poll(async () => {
      const now = JSON.stringify(await read());
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [400, 400, 800, 1000], timeout: 15_000 })
    .toBe(true);
  return JSON.parse(last) as Awaited<ReturnType<typeof read>>;
}

let storefront = "";
let productPath = "";
/** The product page's buy box, which streams in (stock is read per request). */
const buyBox = (page: Page) => page.locator("main").getByRole("button", { name: "Legg i handlekurven" }).first();
let original = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // Approved as the platform does, for the owner who already has the shared store.
    if ((await sql`select 1 from commerce.stores where slug = ${E2E_STORE}`).length === 0) {
      const [request] = await sql`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Themes') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${E2E_STORE}, 'E2E Themes', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    await sql`delete from commerce.store_theme_installs where store_id = ${store.id} and title like ${`${PREFIX}%`} and not live`;
    // A run that stopped half-way may have left one live: it is kept, and the store's own theme is still the one to come back to.
    const left = (await sql`select title from commerce.store_theme_installs where store_id = ${store.id} and title like ${`${PREFIX}%`}`).map((row) => String(row.title));
    for (const theme of LAUNCH_THEMES.filter((theme) => !left.includes(titleOf(theme.title)))) {
      const look = { theme: { base: theme.snapshot.theme.base, savedId: null, settings: theme.snapshot.theme.settings }, css: theme.snapshot.css, headerId: null, footerId: null, productLayoutId: null };
      await sql`insert into commerce.store_theme_installs (store_id, title, look, live) values (${store.id}, ${titleOf(theme.title)}, ${sql.json(look)}, false)`;
    }
    // The fonts the themes name are on the platform already: nothing is fetched from Google in a test.
    for (const family of new Set(LAUNCH_THEMES.flatMap((theme) => Object.values(theme.snapshot.theme.settings.fonts)).filter((f): f is string => Boolean(f)))) {
      await sql`insert into commerce.fonts (family, slug, category, css, bytes) values (${family}, ${family.toLowerCase().replace(/\s+/g, "-")}, 'sans-serif', '', 0) on conflict (family) do nothing`;
    }
    const [own] = await sql`
      select title from commerce.store_theme_installs where store_id = ${store.id} and title not like ${`${PREFIX}%`}
       order by live desc, switched_at desc nulls last limit 1`;
    original = String(own.title);
    // The store's own country; the site moves the address to its short form where the store sells in one country (D181).
    const [market] = await sql`select code from commerce.markets where store_id = ${store.id} and active order by created_at, code limit 1`;
    storefront = `/s/${E2E_STORE}/${String(market.code).toLowerCase()}`;
    const [product] = await sql`select handle from commerce.products where store_id = ${store.id} and status = 'active' and kind = 'goods' order by created_at limit 1`;
    productPath = `${storefront}/p/${product.handle}`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async ({ browser }) => {
  // Back to the store's own theme if the test stopped on a launch theme.
  if (original && (await liveTitle()).startsWith(PREFIX)) {
    const context = await browser.newContext({ storageState: OWNER.state });
    await switchTo(await context.newPage(), original);
    await context.close();
  }
  const sql = testDb();
  try {
    await sql`delete from commerce.store_theme_installs where title like ${`${PREFIX}%`} and not live and store_id = (select id from commerce.stores where slug = ${E2E_STORE})`;
  } finally {
    await sql.end();
  }
});

async function switchTo(page: Page, title: string) {
  await page.goto(design);
  await page.getByRole("button", { name: `Switch to ${title}` }).click();
  // The store's live theme is the one pressed, and its row says so.
  await expect.poll(liveTitle, { timeout: 15_000 }).toBe(title);
  await expect(page.getByRole("button", { name: `Switch to ${title}` })).toHaveCount(0);
}

async function liveTitle(): Promise<string> {
  const sql = testDb();
  try {
    const [live] = await sql`select title from commerce.store_theme_installs where live and store_id = (select id from commerce.stores where slug = ${E2E_STORE})`;
    return String(live?.title ?? "");
  } finally {
    await sql.end();
  }
}

test.use({ storageState: OWNER.state });

test("switches through every launch theme and back with no content changed, the look following", async ({ page }) => {
  test.setTimeout(300_000);
  const content = await contentOf();
  const front = await seen(page, storefront);
  const product = await seen(page, productPath, buyBox);
  expect(front.words.length).toBeGreaterThan(0);
  expect(product.pictures.length).toBeGreaterThan(0);

  for (const theme of LAUNCH_THEMES) {
    await test.step(theme.title, async () => {
      await switchTo(page, titleOf(theme.title));
      expect(await contentOf(), `content after ${theme.title}`).toEqual(content);

      const shownFront = await seen(page, storefront);
      expect(shownFront).toEqual(front);
      // The look follows: the site draws the theme's own colours.
      const styles = await page.locator("style").evaluateAll((nodes) => nodes.map((node) => node.textContent ?? "").join("\n"));
      expect(styles).toContain(`--accent: ${theme.snapshot.theme.settings.light.accent}`);
      expect(await seen(page, productPath, buyBox)).toEqual(product);

      // On a phone nothing runs off the screen.
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(storefront);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
      await page.setViewportSize({ width: 1280, height: 800 });
    });
  }

  await switchTo(page, original);
  expect(await contentOf()).toEqual(content);
  expect(await seen(page, storefront)).toEqual(front);
});
