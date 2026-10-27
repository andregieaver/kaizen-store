import { expect, test } from "@playwright/test";

import { templateSettings } from "../../src/lib/theme";
import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Changes by the clock and links to share (wave 7 unit F, D340), as the store's owner uses them: a page's draft shared through the builder's
 * *Share*, opened by someone signed out (noindex, no Referer, the draft and not the live page), then revoked so the link opens nothing; a
 * page scheduled with a way back, shown in the pages list; and an earlier look taken back into Design settings as unsaved changes.
 * Everything here is made for this run and taken away after it.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const SLUG = `shared-${RUN}`;
let storeId = "";
let pageId = "";

const content = (heading: string) => ({
  title: `Shared ${RUN}`,
  slug: SLUG,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: [{ id: "row-s", type: "row", layout: "1", columns: [{ id: "col-s", blocks: [{ id: "head-s", type: "heading", text: heading, level: 2 }] }] }],
});

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    // Live: the words everyone sees. Draft: the words only the link shows.
    const [row] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${storeId}, ${SLUG}, ${sql.json(content(`Coming soon ${RUN}`))}, ${sql.json(content(`On the site ${RUN}`))}, now()) returning id`;
    pageId = String(row.id);
    // Two earlier looks of the store, as two saves would have kept them: the minimal theme (no web fonts to fetch) in two accents.
    const settings = templateSettings("minimal");
    const look = (accent: string) => ({ base: "minimal", savedId: null, settings: { ...settings, light: { ...settings.light, accent } } });
    await sql`insert into commerce.look_versions (store_id, kind, theme, created_at) values (${storeId}, 'design', ${sql.json(look("#1d4ed8"))}, now() - interval '2 days')`;
    await sql`insert into commerce.look_versions (store_id, kind, theme, created_at) values (${storeId}, 'theme_tab', ${sql.json(look("#b91c1c"))}, now() - interval '1 day')`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.pages where id = ${pageId}`;
    await sql`delete from commerce.look_versions where store_id = ${storeId} and created_at < now() - interval '12 hours'`;
  } finally {
    await sql.end();
  }
});

test("a page's draft is shared, opened signed out, and the link revoked", async ({ page, browser }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await page.locator("[data-share-button]").click();
  const dialog = page.getByRole("dialog", { name: "Share a preview" });
  await expect(dialog).toBeVisible();
  // A week to start with: Homer only presses the button.
  await expect(dialog.getByLabel("7 days")).toBeChecked();
  await dialog.locator("[data-make-link]").click();
  const field = dialog.locator("[data-made-link]");
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(link).toMatch(/\/admin\/account\/share\/pv_[A-Za-z0-9_-]{43}$/);

  // A visitor signed out: a context made here would otherwise take the signed-in state the file uses.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const shared = await visitor.newPage();
    const response = await shared.goto(link);
    expect(response?.ok()).toBe(true);
    await expect(shared.locator("[data-shared-preview=page]")).toBeVisible();
    // The draft, never the live page.
    await expect(shared.getByText(`Coming soon ${RUN}`)).toBeVisible();
    await expect(shared.getByText(`On the site ${RUN}`)).toHaveCount(0);
    await expect(shared.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(shared.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    expect(await visitor.cookies()).toEqual([]);

    // Revoked, it opens nothing.
    await dialog.getByRole("button", { name: "Revoke" }).first().click();
    await expect(dialog.getByRole("status")).toContainText("revoked");
    await shared.goto(link);
    await expect(shared.locator("[data-shared-preview]")).toHaveCount(0);
    await expect(shared.getByText(`Coming soon ${RUN}`)).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});

test("a page is scheduled with a way back, and the pages list says when", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await page.locator("[data-schedule-button]").click();
  const dialog = page.getByRole("dialog", { name: "Publish it later" });
  await expect(dialog.getByLabel("Time", { exact: true })).toHaveValue("09:00");
  await dialog.getByText("Put the version before back later").click();
  await expect(dialog.getByLabel("Time to put it back")).toHaveValue("09:00");
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Goes back");

  await page.goto(`/admin/${E2E_STORE}/pages`);
  const chip = page.getByRole("listitem").filter({ hasText: `Shared ${RUN}` }).locator("[data-schedule-chip]");
  await expect(chip).toContainText("Publishes");
  await expect(chip).toContainText("Goes back");

  await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
  await page.locator("[data-schedule-button]").click();
  const again = page.getByRole("dialog", { name: "Publish it later" });
  await again.getByRole("button", { name: "Cancel the schedule" }).click();
  await expect(again.getByRole("status")).toContainText("The schedule is cancelled");
});

test("an earlier look is taken back into Design settings as unsaved changes", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/design`);
  await page.locator("[data-look-versions-button]").click();
  const dialog = page.getByRole("dialog", { name: "Earlier looks" });
  const list = dialog.locator("[data-look-versions]");
  await expect(list.getByRole("listitem").first()).toBeVisible();
  await list.getByRole("listitem").filter({ hasText: "Saved in the page builder's Theme tab" }).first().getByRole("button", { name: "Use this version" }).click();
  await expect(dialog).toBeHidden();
  // Nothing is on the store until Save.
  await expect(page.getByText("not on the store yet")).toBeVisible();
});
