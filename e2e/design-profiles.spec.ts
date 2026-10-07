import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A design profile's public preview (D176, docs/design-profiles.md section 5): a published profile on a published store template is drawn
 * with the profile's colours and fonts on the template's front page, kept from search engines, and an unpublished profile is not found.
 */
const BACKGROUND = "#fdf6e3";
const ACCENT = "#c2185b";

async function arrange(): Promise<{ published: string; hidden: string; starter: string }> {
  const run = Date.now().toString(36);
  const sql = testDb();
  try {
    // A store template, made as the platform makes one: a copy of the template, marked, described and published.
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`designs-${run}@example.com`}, 'Platform', 'Spa') returning id`;
    const [{ id: store }] = await sql`select commerce.approve_access_request(${request.id}, ${`designs-${run}`}, 'Spa', null) as id`;
    await sql`update commerce.stores set starter = true where id = ${store}`;
    const [{ id: starter }] = await sql`
      insert into commerce.store_starters (store_id, title, category, published) values (${store}, 'Spa', 'appointments', true) returning id`;
    const settings = {
      mode: "light",
      visitorSwitch: false,
      light: { background: BACKGROUND, surface: "#eee8d5", text: "#073642", muted: "#586e75", border: "#d9d2bf", accent: ACCENT, accentText: "#ffffff" },
      dark: { background: "#002b36", surface: "#073642", text: "#eee8d5", muted: "#93a1a1", border: "#0b4452", accent: "#ec407a", accentText: "#002b36" },
      fonts: { heading: "Playfair Display", body: "Lora" },
      headings: { weight: "bold", case: "normal" },
      buttons: { style: "filled", corners: "square" },
      corners: { cards: "none", fields: "none" },
      layout: { width: "normal", headerAlign: "left", headerBackground: "page" },
      productCards: { image: "square", style: "plain", align: "left" },
    };
    const snapshot = { v: 1, theme: { base: "warm", settings }, header: null, footer: null, productLayout: null, css: "" };
    // The fonts are on Kaizen (installed when the source store saved its theme); nothing is fetched from Google in a test.
    for (const [family, slug] of [["Playfair Display", "playfair-display"], ["Lora", "lora"]]) {
      await sql`insert into commerce.fonts (family, slug, category, css, bytes) values (${family}, ${slug}, 'serif', '/* e2e: no files */', 0) on conflict (family) do nothing`;
    }
    const [{ id: published }] = await sql`
      insert into commerce.design_presets (title, snapshot, published) values (${`Solar ${run}`}, ${sql.json(snapshot)}, true) returning id`;
    const [{ id: hidden }] = await sql`
      insert into commerce.design_presets (title, snapshot, published) values (${`Draft ${run}`}, ${sql.json(snapshot)}, false) returning id`;
    return { published, hidden, starter };
  } finally {
    await sql.end();
  }
}

test("a published design profile's preview shows its look on a store template, kept from search engines", async ({ page }) => {
  const { published, starter } = await arrange();
  await page.goto(`/admin/account/design-profiles/${published}/preview?starter=${starter}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("status").filter({ hasText: "nothing is saved or changed" })).toBeVisible();
  const canvas = page.locator("[data-design-preview]");
  await expect(canvas).toHaveCSS("background-color", "rgb(253, 246, 227)");
  await expect(canvas).toHaveCSS("font-family", /Lora/);
  await expect(canvas).toHaveAttribute("style", /Playfair Display/);
  // The template's own front page: its products, drawn in the profile's look.
  await expect(canvas.locator(".product-card").first()).toBeVisible();
  // Nothing in it can be used.
  await expect(canvas).toHaveAttribute("inert", "");
});

test("an unpublished design profile has no public preview", async ({ page }) => {
  const { hidden, starter } = await arrange();
  // The page streams (it reads the address), so a refusal is the not-found page with noindex rather than a 404 status.
  for (const query of [`?starter=${starter}`, `?starter=${starter}&as=admin`]) {
    await page.goto(`/admin/account/design-profiles/${hidden}/preview${query}`);
    await expect(page.locator("[data-design-preview]")).toHaveCount(0);
    await expect(page.getByText("nothing is saved or changed")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  }
});
