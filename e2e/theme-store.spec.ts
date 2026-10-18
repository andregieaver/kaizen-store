import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../src/lib/launch-themes";
import { demoStoreOf, testDb } from "./db";

/**
 * The theme store (`docs/theme-phase-3.md` step 1, D275), signed out: a theme's page, published after the site was built, is drawn on its
 * first visit with its preview at computer and phone widths (the public preview, inert, `noindex`, on the theme's own content), its
 * presets as swatches that the address keeps, what one gets, the details folded, structured data without a price, and *Use this theme*
 * leading to sign-up with the look named; its full-screen preview has a slim bar. The list's filters are plain links.
 */

const SLUG = `e2e-theme-${Date.now().toString(36)}`;
let id = "";
let demo: Awaited<ReturnType<typeof demoStoreOf>>;

test.beforeAll(async () => {
  demo = await demoStoreOf("home");
  const sql = testDb();
  try {
    // With one preset besides its own look (docs/theme-showcase-phase-1.md): Hearth's settings over Fjord.
    const snapshot = { ...LAUNCH_THEMES[3].snapshot, v: 2, variations: [{ key: "coast", name: "Coast", theme: LAUNCH_THEMES[1].snapshot.theme }] };
    const [row] = await sql`
      insert into commerce.design_presets (title, summary, description, snapshot, published, published_at, slug, listing)
      values ('E2E Fjord', 'Cool and clear.', 'A theme made by the test.', ${sql.json(snapshot as never)}, true, now(), ${SLUG}, ${sql.json({ kinds: ["home"], styles: ["natural"], pictures: ["/demo/mug.svg"] })})
      returning id`;
    id = String(row.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${id}, 1, ${sql.json(snapshot as never)})`;
  } finally {
    await sql.end();
  }
  await demo.linkTo(id);
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    // Unpublished and moved out of the way; versions are never deleted while their theme is there.
    await sql`update commerce.design_presets set published = false, slug = null where id = ${id}`;
  } finally {
    await sql.end();
  }
  await demo.putAway();
});

test("a theme's page shows the theme large on its own content, its presets as swatches, and the two ways to use it (D275)", async ({ page }) => {
  const response = await page.goto(`/themes/${SLUG}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Fjord" })).toBeVisible();
  await expect(page.getByText("Cool and clear.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What you get" })).toBeVisible();
  await expect(page.getByText("Light and dark", { exact: true })).toBeVisible();
  // Its own pictures, and a share picture drawn from its colours (it has no main picture).
  await expect(page.getByRole("img", { name: "E2E Fjord, picture 1" })).toHaveAttribute("src", "/demo/mug.svg");
  const share = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  expect(share).toMatch(new RegExp(`/themes/${SLUG}/og\\.png$`));
  const card = await page.request.get(`/themes/${SLUG}/og.png`);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");

  // Structured data: a free creative work, no price.
  const data = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
  expect(data).toMatchObject({ "@type": "CreativeWork", name: "E2E Fjord", isAccessibleForFree: true });
  expect(JSON.stringify(data)).not.toMatch(/price|offers/i);

  // The details are folded away for Lisa: the changelog is there once opened.
  await expect(page.getByText("The first version.")).toBeHidden();
  await page.getByText("Details", { exact: true }).click();
  await expect(page.getByText("The first version.")).toBeVisible();

  // The two buttons and the quiet link, for the theme's own look.
  await expect(page.getByRole("link", { name: "Use this theme" })).toHaveAttribute("href", `/sign-up?theme=${id}`);
  await expect(page.getByRole("link", { name: /^Preview/ })).toHaveAttribute("href", `/themes/${SLUG}/preview`);
  await expect(page.getByRole("link", { name: "Already have a store? Add it to your store" })).toHaveAttribute("href", `/themes/${SLUG}/try`);
  await expect(page.getByText("Sample content: your own words, pictures and products take its place.")).toBeVisible();
  await expect(page.getByText(/demo store/i)).toHaveCount(0);

  // The frames: the public preview on the theme's own content, inert and not for search engines.
  await expect(page.locator('iframe[title="E2E Fjord on a phone"]')).toHaveAttribute("src", new RegExp(`starter=${demo.starter}`));
  await expect(page.locator('iframe[title="E2E Fjord on a computer"]')).toBeVisible();
  const phone = page.frameLocator('iframe[title="E2E Fjord on a phone"]');
  await expect(phone.locator("[data-design-preview]").first()).toBeAttached();
  const previewResponse = await page.request.get(`/admin/account/themes/${id}/preview`);
  expect(previewResponse.status()).toBe(200);
  expect(await previewResponse.text()).toMatch(/noindex/);

  // A preset is a swatch: choosing it changes the frames and the buttons, and the address keeps it.
  await page.getByRole("list", { name: "Presets" }).getByRole("link", { name: "Coast" }).click();
  await expect(page.locator('iframe[title="E2E Fjord · Coast on a phone"]')).toHaveAttribute("src", /preset=coast/);
  await expect(page).toHaveURL(new RegExp(`/themes/${SLUG}\\?preset=coast$`));
  await expect(page.getByRole("link", { name: "Use this theme" })).toHaveAttribute("href", `/sign-up?theme=${id}&preset=coast`);
  await expect(page.getByRole("link", { name: /^Preview/ })).toHaveAttribute("href", `/themes/${SLUG}/preview?preset=coast`);
  await expect(page.getByRole("link", { name: "Already have a store? Add it to your store" })).toHaveAttribute("href", `/themes/${SLUG}/try?preset=coast`);
  // A shared link opens on that look.
  await page.reload();
  await expect(page.locator('iframe[title="E2E Fjord · Coast on a computer"]')).toHaveAttribute("src", /preset=coast/);

  const start = page.getByRole("link", { name: "Use this theme" });
  await start.click();
  await expect(page).toHaveURL(new RegExp(`/sign-up\\?theme=${id}&preset=coast$`));
  await expect(page.getByRole("heading", { level: 1, name: "Start your store" })).toBeVisible();
});

test("the full-screen preview has a slim bar: back, presets, Home or A product, computer or phone, and Use this theme (D275)", async ({ page }) => {
  await page.goto(`/themes/${SLUG}?preset=coast`);
  await page.getByRole("link", { name: /^Preview/ }).click();
  await expect(page).toHaveURL(new RegExp(`/themes/${SLUG}/preview\\?preset=coast$`));
  // No site header or footer: only the bar and the store under it.
  await expect(page.locator("footer")).toHaveCount(0);
  const computer = page.locator('iframe[title="E2E Fjord · Coast on a computer"]');
  await expect(computer).toHaveAttribute("src", new RegExp(`/admin/account/themes/${id}/preview\\?starter=${demo.starter}&preset=coast&embed=1&show=home$`));
  await expect(page.frameLocator('iframe[title="E2E Fjord · Coast on a computer"]').locator("[data-shot=front]").first()).toBeAttached();

  await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "A product" }).click();
  await expect(page).toHaveURL(new RegExp(`/themes/${SLUG}/preview\\?preset=coast&show=product$`));
  await expect(computer).toHaveAttribute("src", /show=product$/);
  const product = page.frameLocator('iframe[title="E2E Fjord · Coast on a computer"]');
  await expect(product.locator("[data-shot=product]").first()).toBeAttached();
  await expect(product.locator("[data-shot=front]")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Screen" }).getByRole("link", { name: "Phone" }).click();
  await expect(page.locator('iframe[title="E2E Fjord · Coast on a phone"]')).toHaveAttribute("src", /show=product$/);

  // The theme's own look, from its swatch; the button follows it.
  await page.getByRole("list", { name: "Presets" }).getByRole("link", { name: "E2E Fjord" }).click();
  await expect(page).toHaveURL(new RegExp(`/themes/${SLUG}/preview\\?show=product&device=phone$`));
  await expect(page.getByRole("link", { name: "Use this theme" })).toHaveAttribute("href", `/sign-up?theme=${id}`);
  await page.getByRole("link", { name: "E2E Fjord", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/themes/${SLUG}$`));
});

test("an address that is no theme is not found, and the list's filters are links", async ({ page }) => {
  expect((await page.goto("/themes/no-such-theme-here"))?.status()).toBe(404);
  await page.goto("/themes");
  await expect(page.getByRole("heading", { level: 1, name: "Themes" })).toBeVisible();
  const filters = page.getByRole("navigation", { name: "Filter themes" });
  // One bar of small menus: open Style, choose Bold; the menu closes and names it, and the bar can clear it.
  await filters.getByText("Style", { exact: true }).click();
  await filters.getByRole("link", { name: "Bold" }).click();
  await expect(page).toHaveURL(/\/themes\?style=bold$/);
  await expect(filters.locator("summary").filter({ hasText: "Style" })).toContainText("Bold");
  await expect(filters.getByRole("link", { name: "Bold" })).toBeHidden();
  await filters.getByText("Style", { exact: true }).click();
  await expect(filters.getByRole("link", { name: "Bold" })).toHaveAttribute("aria-current", "page");
  await filters.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/themes$/);
});
