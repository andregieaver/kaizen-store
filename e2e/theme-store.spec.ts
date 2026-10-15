import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../src/lib/launch-themes";
import { testDb } from "./db";

/**
 * The theme store (`docs/theme-phase-3.md` step 1), signed out: a theme's page, published after the site was built, is drawn on its first
 * visit with what it includes, its changelog, structured data without a price and its preview at computer and phone widths (the public
 * preview, inert, `noindex`); *Start with this theme* leads to sign-up with the theme named. The list's filters are plain links.
 */

const SLUG = `e2e-theme-${Date.now().toString(36)}`;
let id = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const snapshot = LAUNCH_THEMES[3].snapshot;
    const [row] = await sql`
      insert into commerce.design_presets (title, summary, description, snapshot, published, published_at, slug, listing)
      values ('E2E Fjord', 'Cool and clear.', 'A theme made by the test.', ${sql.json(snapshot as never)}, true, now(), ${SLUG}, ${sql.json({ kinds: ["home"], styles: ["natural"], pictures: ["/demo/mug.svg"] })})
      returning id`;
    id = String(row.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${id}, 1, ${sql.json(snapshot as never)})`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    // Unpublished and moved out of the way; versions are never deleted while their theme is there.
    await sql`update commerce.design_presets set published = false, slug = null where id = ${id}`;
  } finally {
    await sql.end();
  }
});

test("a theme's page shows what it includes, its previews and its changelog, and leads to sign-up with it", async ({ page }) => {
  const response = await page.goto(`/themes/${SLUG}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Fjord" })).toBeVisible();
  await expect(page.getByText("Cool and clear.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it includes" })).toBeVisible();
  // Its own pictures, and a share picture drawn from its colours (it has no main picture).
  await expect(page.getByRole("img", { name: "E2E Fjord, picture 1" })).toHaveAttribute("src", "/demo/mug.svg");
  const share = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  expect(share).toMatch(new RegExp(`/themes/${SLUG}/og\\.png$`));
  const card = await page.request.get(`/themes/${SLUG}/og.png`);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
  await expect(page.getByRole("link", { name: "Try it in your store" })).toHaveAttribute("href", `/themes/${SLUG}/try`);
  await expect(page.getByText("Light and dark", { exact: true })).toBeVisible();
  await expect(page.getByText("The first version.")).toBeVisible();

  // Structured data: a free creative work, no price.
  const data = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
  expect(data).toMatchObject({ "@type": "CreativeWork", name: "E2E Fjord", isAccessibleForFree: true });
  expect(JSON.stringify(data)).not.toMatch(/price|offers/i);

  // The preview at both widths: the public preview, inert and not for search engines.
  const phone = page.frameLocator('iframe[title="E2E Fjord on a phone"]');
  await expect(phone.locator("[data-theme-preview], main").first()).toBeVisible();
  const previewResponse = await page.request.get(`/admin/account/design-profiles/${id}/preview`);
  expect(previewResponse.status()).toBe(200);
  expect(await previewResponse.text()).toMatch(/noindex/);

  const start = page.getByRole("link", { name: "Start with this theme" });
  await expect(start).toHaveAttribute("href", `/sign-up?theme=${id}`);
  await start.click();
  await expect(page).toHaveURL(new RegExp(`/sign-up\\?theme=${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Start your store" })).toBeVisible();
});

test("an address that is no theme is not found, and the list's filters are links", async ({ page }) => {
  expect((await page.goto("/themes/no-such-theme-here"))?.status()).toBe(404);
  await page.goto("/themes");
  await expect(page.getByRole("heading", { level: 1, name: "Themes" })).toBeVisible();
  const filters = page.getByRole("navigation", { name: "Filter themes" });
  await filters.getByRole("link", { name: "Bold" }).click();
  await expect(page).toHaveURL(/\/themes\?style=bold$/);
  await expect(filters.getByRole("link", { name: "Bold" })).toHaveAttribute("aria-current", "page");
});
