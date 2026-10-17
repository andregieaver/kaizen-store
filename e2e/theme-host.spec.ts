import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../src/lib/launch-themes";
import { demoStoreOf, testDb } from "./db";

/**
 * The theme store on its own host (`docs/theme-phase-3.md` step 3). Needs a build with the host set, as CI's `hosts` job makes, where it is a
 * name under the store domain (the case that must never be taken for a store's host):
 *
 *   NEXT_PUBLIC_STORE_DOMAIN=localhost:3000 NEXT_PUBLIC_THEMES_HOST=themes.localhost:3000 pnpm build
 *   NEXT_PUBLIC_STORE_DOMAIN=localhost:3000 NEXT_PUBLIC_THEMES_HOST=themes.localhost:3000 pnpm exec playwright test e2e/theme-host.spec.ts
 */
const host = process.env.NEXT_PUBLIC_THEMES_HOST;
test.skip(!host, "needs a build with NEXT_PUBLIC_THEMES_HOST set");

const themes = (path = "/") => `http://${host}${path}`;
const SLUG = `e2e-host-${Date.now().toString(36)}`;
let id = "";
let demo: Awaited<ReturnType<typeof demoStoreOf>>;

test.beforeAll(async () => {
  // Shown on a demo store, as the theme store shows only looks on one (D274).
  demo = await demoStoreOf("beauty");
  const sql = testDb();
  try {
    const snapshot = LAUNCH_THEMES[0].snapshot;
    const [row] = await sql`
      insert into commerce.design_presets (title, summary, description, snapshot, published, published_at, slug, listing)
      values ('E2E Hosted', 'On its own host.', 'A theme made by the test.', ${sql.json(snapshot as never)}, true, now(), ${SLUG}, ${sql.json({ pack: "beauty" })})
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
    await sql`update commerce.design_presets set published = false, slug = null where id = ${id}`;
  } finally {
    await sql.end();
  }
  await demo.putAway();
});

test("the list and a theme answer at the host's root, linking back to Kaizena Flow in full", async ({ page, baseURL }) => {
  const list = await page.goto(themes("/"));
  expect(list?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Themes" })).toBeVisible();
  // Next.js writes the root's canonical address without its slash.
  expect(await page.locator("link[rel=canonical]").getAttribute("href")).toBe(themes("/").replace(/\/$/, ""));

  const response = await page.goto(themes(`/${SLUG}`));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Hosted" })).toBeVisible();
  expect(page.url()).toBe(themes(`/${SLUG}`));
  expect(await page.locator("link[rel=canonical]").getAttribute("href")).toBe(themes(`/${SLUG}`));
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Themes" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Start with this theme" })).toHaveAttribute("href", `${baseURL}/sign-up?theme=${id}`);
  await expect(page.getByRole("link", { name: "Try it in your store" })).toHaveAttribute("href", `${baseURL}/themes/${SLUG}/try`);
  await expect(page.locator(`iframe[title="E2E Hosted on a phone"]`)).toHaveAttribute("src", `${baseURL}/admin/account/themes/${id}/preview?starter=${demo.starter}&embed=1`);
});

test("Kaizena Flow's own addresses of the theme store move there; the try route stays", async ({ page, request }) => {
  await page.goto(`/themes/${SLUG}`);
  await expect(page).toHaveURL(themes(`/${SLUG}`));
  const moved = await request.get("/themes", { maxRedirects: 0 });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toBe(themes("/"));
  // The try route still answers on Kaizena Flow's host: signed out, to sign in and back.
  await page.goto(`/themes/${SLUG}/try`);
  await page.waitForURL(/\/admin\/sign-in\?next=/);
});

test("an address on the host that is no theme is Kaizena Flow's own", async ({ page, baseURL }) => {
  await page.goto(themes("/sign-up"));
  await expect(page).toHaveURL(`${baseURL}/sign-up`);
  await page.goto(themes("/admin/sign-in"));
  await expect(page).toHaveURL(`${baseURL}/admin/sign-in`);
});

test("the host has its own sitemap and rules for crawlers, and Kaizena Flow's sitemap leaves the theme store to it", async ({ page, request }) => {
  // Through the browser: only Chromium sends `*.localhost` to this machine.
  const sitemap = await page.goto(themes("/sitemap.xml"));
  expect(sitemap?.status()).toBe(200);
  expect(await sitemap?.text()).toContain(`<loc>${themes("/")}</loc>`);
  const robots = await page.goto(themes("/robots.txt"));
  expect(await robots?.text()).toContain(`Sitemap: ${themes("/sitemap.xml")}`);
  const platform = await request.get("/sitemap-kaizen.xml");
  expect(await platform.text()).not.toContain("/themes");
});
