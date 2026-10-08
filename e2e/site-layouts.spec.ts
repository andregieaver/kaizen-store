import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Headers and footers (D80): a store's own, built in the page builder,
 * show its parts; a header set to lie over the page does so over a page
 * that starts with a background, see-through until the shopper scrolls.
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
const row = (id: string, blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, inline: true, blocks }],
  ...extra,
});

test("a store's own header and footer show its parts, and the header lies over a page that starts with a background", async ({ page }) => {
  const slug = `chrome-${Date.now()}`;
  const header = content(
    "Topp",
    [row("h", [{ id: "logo", type: "site", part: "logo" }, { id: "hello", type: "heading", text: "Velkommen inn", level: 2 }, { id: "cart", type: "site", part: "cart" }], { sideBySide: true })],
    { overlay: { where: "everywhere", categories: [], tags: [], textColor: "#ffffff" } },
  );
  const footer = content("Bunn", [row("f", [{ id: "b", type: "site", part: "business" }, { id: "k", type: "site", part: "cookies" }])]);
  const hero = content("Sommer", [
    row("hero", [{ id: "t", type: "heading", text: "Sommer ved vannet", level: 1 }], { background: { type: "color", color: "#123456" }, style: { padding: { top: 200, right: 20, bottom: 200, left: 20 } } }),
    // Tall enough to scroll.
    ...[1, 2, 3, 4].map((n) => row(`more-${n}`, [{ id: `m${n}`, type: "heading", text: `Mer ${n}`, level: 2 }], { style: { padding: { top: 240, right: 20, bottom: 240, left: 20 } } })),
  ]);
  const plain = content("Om", [row("om", [{ id: "o", type: "heading", text: "Om oss", level: 1 }])]);
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null) as id`;
    const add = (type: string, value: ReturnType<typeof content>) => sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}, ${type}, ${value.slug}, ${sql.json(value as never)}, ${sql.json(value as never)}, now()) returning id`;
    const [[{ id: headerId }], [{ id: footerId }]] = await Promise.all([add("header", header), add("footer", footer), add("page", hero), add("page", plain)]);
    await sql`update commerce.stores set header_id = ${headerId}, footer_id = ${footerId} where id = ${storeId}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${slug}/sommer`);
  const top = page.locator("[data-header-wrap]");
  const bar = page.locator(".site-header");
  await expect(bar.getByRole("heading", { name: "Velkommen inn" })).toBeVisible();
  await expect(bar.locator("a[href$='/cart']")).toHaveCount(1);
  await expect(page.locator(".site-footer").getByRole("link", { name: "Informasjonskapsler" })).toBeVisible();
  await expect(page.locator(".site-footer address")).toContainText("Siris Butikk");

  // Over the page's first row, see-through with white text at the top.
  await expect(top).toHaveCSS("position", "fixed");
  await expect(bar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(bar).toHaveCSS("color", "rgb(255, 255, 255)");
  // Scrolled down and back up a little, it has its background again.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, -200);
  await expect(top).not.toHaveAttribute("data-at-top");
  await expect(bar).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  // A page starting without a background keeps the header above it.
  await page.goto(`/s/${slug}/om`);
  await expect(page.getByRole("heading", { name: "Om oss" })).toBeVisible();
  await expect(top).toHaveCSS("position", "sticky");
});

test("a header over the front page only stays above other pages, also after visiting the front page", async ({ page }) => {
  const slug = `front-over-${Date.now()}`;
  const header = content("Topp", [row("h", [{ id: "logo", type: "site", part: "logo" }, { id: "cart", type: "site", part: "cart" }], { sideBySide: true })], {
    overlay: { where: "front", categories: [], tags: [] },
  });
  const footer = content("Bunn", [row("f", [{ id: "b", type: "site", part: "business" }, { id: "k", type: "site", part: "cookies" }])]);
  const hero = content("Velkommen", [
    row("hero", [{ id: "t", type: "heading", text: "Velkommen", level: 1 }], { background: { type: "color", color: "#123456" }, style: { padding: { top: 200, right: 20, bottom: 200, left: 20 } } }),
  ]);
  // Another page that starts with a background: the header stays above it all the same.
  const other = content("Sommer", [
    row("sommer", [{ id: "s", type: "heading", text: "Sommer ved vannet", level: 1 }], { background: { type: "color", color: "#345678" } }),
  ]);
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null) as id`;
    const add = (type: string, value: ReturnType<typeof content>) => sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}, ${type}, ${value.slug}, ${sql.json(value as never)}, ${sql.json(value as never)}, now()) returning id`;
    const [[{ id: headerId }], [{ id: footerId }], [{ id: frontId }]] = await Promise.all([add("header", header), add("footer", footer), add("page", hero), add("page", other)]);
    await sql`update commerce.stores set header_id = ${headerId}, footer_id = ${footerId}, front_page_id = ${frontId} where id = ${storeId}`;
  } finally {
    await sql.end();
  }

  const top = page.locator("[data-header-wrap]");
  await page.goto(`/s/${slug}/sommer`);
  await expect(page.getByRole("heading", { level: 1, name: "Sommer ved vannet" })).toBeVisible();
  await expect(top).toHaveCSS("position", "sticky");

  // To the front page by the logo, in the browser: the header lies over it.
  await page.locator(`.site-header a[href='/s/${slug}']`).first().click();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Velkommen" })).toBeVisible();
  await expect(top).toHaveCSS("position", "fixed");

  // Back again: the front page stays in the document, hidden, but the header is above the page once more.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Sommer ved vannet" })).toBeVisible();
  await expect(top).toHaveCSS("position", "sticky");
});
