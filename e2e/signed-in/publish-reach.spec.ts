import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * How far a publish reaches (bloat review step 2.14): a change to a page's words makes only that page render again, so the store's home
 * and a product page stay cached; a change to its title, which the home's menu shows, reaches the home at once. A page served whole
 * answers `x-nextjs-cache` (the home, a built page); a product page streams its stock, so Next sends no such header for it, and what
 * shows it was not drawn again is its kept entry under `.next/server/route-cache`, unchanged since before the publish.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const SLUG = `reach-${RUN}`;
const BEFORE = `Words before ${RUN}`;
const AFTER = `Words after ${RUN}`;
const TITLE = `Reach ${RUN}`;
let pageId = "";
let productPath = "";
let productHandle = "";
let menuId = "";
let menuBefore: unknown = null;

const home = `/s/${E2E_STORE}`;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const content = {
      title: "Reach",
      slug: SLUG,
      thumbnail: null,
      // Its own excerpt: the body's words are its own, not what lists show.
      excerpt: "A page for the reach of a publish.",
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [
        {
          id: "row-r",
          type: "row",
          layout: "1",
          columns: [{ id: "col-r", blocks: [{ id: "text-r", type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: BEFORE }] }] } }] }],
        },
      ],
    };
    const [row] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, first_published_at)
      values (${store.id}, ${SLUG}, ${sql.json(content)}, ${sql.json(content)}, now(), now()) returning id`;
    pageId = String(row.id);
    const [product] = await sql`
      select handle from commerce.products where store_id = ${store.id} and status = 'active' order by created_at limit 1`;
    productHandle = String(product.handle);
    productPath = `${home}/p/${productHandle}`;
    // The page in the store's main menu, under its own title (a link with no label of its own, D85).
    const [menu] = await sql`select m.id, m.items from commerce.menus m join commerce.stores s on s.header_menu_id = m.id where s.id = ${store.id}`;
    menuId = String(menu.id);
    menuBefore = menu.items;
    const items = [...(menu.items as unknown[]), { label: {}, link: { kind: "page", pageId }, depth: 0 }];
    await sql`update commerce.menus set items = ${sql.json(items as never)} where id = ${menuId}`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    if (menuId) await sql`update commerce.menus set items = ${sql.json(menuBefore as never)} where id = ${menuId}`;
  } finally {
    await sql.end();
  }
});

/** The cache's answer for an address, asked twice so the second is what is kept. */
async function cached(request: APIRequestContext, path: string): Promise<string | undefined> {
  expect((await request.get(path)).status()).toBe(200);
  const second = await request.get(path);
  expect(second.status()).toBe(200);
  return second.headers()["x-nextjs-cache"];
}

/**
 * What the server keeps of the product page: each of its entries (prerendered at build under `.next/server/app`, or kept later by `next
 * start` under `.next/server/route-cache/<hash>/`, where one page can have more than one) with when it was written, as one string; null
 * while it keeps none. A redraw writes an entry, so the string changes.
 */
function productEntryTime(): string | null {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.endsWith(".segments")) walk(full);
      } else if (full.includes(`/s/${E2E_STORE}/`) && full.endsWith(`/p/${productHandle}.meta`)) found.push(full);
    }
  };
  for (const root of [".next/server/app", ".next/server/route-cache"]) walk(path.join(process.cwd(), root));
  return found.length === 0 ? null : found.sort().map((file) => `${file}@${statSync(file).mtimeMs}`).join("\n");
}

async function publishInBuilder(page: import("@playwright/test").Page) {
  // A live page's button says what it does: Publish changes.
  await page.getByRole("button", { name: /^Publish( changes)?$/ }).click();
  const anyway = page.getByRole("button", { name: /Publish anyway/ });
  await expect(page.locator("[data-editor-bar]").getByRole("status").or(anyway)).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(page.locator("[data-editor-bar]").getByRole("status")).toContainText(/Published/);
}

test("a change to a page's words makes only that page render again", async ({ page, request }) => {
  expect(await cached(request, home)).toBe("HIT");
  await cached(request, productPath);
  const kept = productEntryTime();
  expect(kept).not.toBeNull();
  await cached(request, `${home}/${SLUG}`);
  expect(await (await request.get(`${home}/${SLUG}`)).text()).toContain(BEFORE);

  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  // A double press on the text opens its settings; its words are changed as HTML (e2e/signed-in/text-styles.spec.ts).
  await page.locator('[data-builder-item="block"]', { hasText: BEFORE }).dblclick();
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByLabel(/^HTML of /).fill(`<p>${AFTER}</p>`);
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator('[data-builder-item="block"]', { hasText: AFTER })).toBeVisible();
  await publishInBuilder(page);

  await expect.poll(async () => (await request.get(`${home}/${SLUG}`)).text()).toContain(AFTER);
  expect((await request.get(home)).headers()["x-nextjs-cache"]).toBe("HIT");
  expect((await request.get(productPath)).status()).toBe(200);
  // A stale entry is drawn again after the answer: give it the time, then see it was not.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(productEntryTime()).toBe(kept);
});

/** The store's main menu saved from the Menus screen as it stands in the database, so the store's cached menus are read again. */
async function saveMenu(page: import("@playwright/test").Page) {
  await page.goto(`/admin/${E2E_STORE}/menus?menu=${menuId}`);
  await page.getByRole("button", { name: "Save menu" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: /saved/i }).first()).toBeVisible();
}

test("a change to its title reaches the home's menu at once", async ({ page, request }) => {
  // The page's link, under its title, in the home's menu.
  await saveMenu(page);
  await expect.poll(async () => (await request.get(home)).text()).toContain(`/${SLUG}`);

  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await expect(page.locator("[data-editor-bar]")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill(TITLE);
  await publishInBuilder(page);
  await expect.poll(async () => (await request.get(home)).text()).toContain(TITLE);

  // The menu as it was, for the other specs.
  const sql = testDb();
  try {
    await sql`update commerce.menus set items = ${sql.json(menuBefore as never)} where id = ${menuId}`;
  } finally {
    await sql.end();
  }
  await saveMenu(page);
});
