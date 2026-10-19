import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { testDb } from "../db";
import { ADMIN, OWNER } from "./accounts";

/**
 * Premium themes (D286): the platform admin gives a theme a price on its page; the theme store shows it; an owner adding it to try pays
 * nothing, and making it live on an open store first says what it costs and asks to pay it, then lists it on Billing to be invoiced through
 * Kaizena Flow's billing (no Stripe here, so it stays waiting to be invoiced).
 */

const RUN = Date.now().toString(36);
const TITLE = `E2E Premium ${RUN}`;
const SLUG = `e2e-premium-${RUN}`;
const STORE = "e2e-premium";
let presetId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // A store of the owner's own, open, so applying a theme here never meets another spec's look.
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Premium') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Premium', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    // A published theme of its own for this run, free until the admin prices it.
    const snapshot = LAUNCH_THEMES[0].snapshot;
    const [theme] = await sql`
      insert into commerce.design_presets (title, summary, snapshot, published, published_at, slug, listing)
      values (${TITLE}, 'A theme to sell.', ${sql.json(snapshot as never)}, true, now(), ${SLUG}, ${sql.json({ kinds: [], styles: [], pictures: [] })})
      returning id`;
    presetId = String(theme.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${presetId}, 1, ${sql.json(snapshot as never)})`;
    // Its fonts are on the platform already: nothing is fetched from Google in a test.
    for (const family of Object.values(snapshot.theme.settings.fonts).filter((f): f is string => Boolean(f))) {
      await sql`insert into commerce.fonts (family, slug, category, css, bytes) values (${family}, ${family.toLowerCase().replace(/\s+/g, "-")}, 'sans-serif', '/* e2e */', 0) on conflict (family) do nothing`;
    }
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    // The theme leaves the store; its purchase stays, as every purchase does.
    if (presetId) await sql`update commerce.design_presets set published = false, slug = null where id = ${presetId}`;
  } finally {
    await sql.end();
  }
});

test("a premium theme: priced by the admin, shown in the theme store, agreed to and paid for by the owner (D286)", async ({ browser }) => {
  // The platform admin makes it premium on its page.
  const admin = await browser.newContext({ storageState: ADMIN.state });
  const adminPage = await admin.newPage();
  await adminPage.goto(`/admin/platform/themes/${presetId}`);
  const card = adminPage.getByRole("region", { name: "Price" });
  await card.getByRole("radio", { name: "Premium" }).check();
  for (const [currency, amount] of [["NOK", "1990"], ["SEK", "1990"], ["DKK", "1490"]]) {
    await card.getByRole("textbox", { name: currency }).fill(amount);
  }
  await card.getByRole("button", { name: "Save the price" }).click();
  await expect(card.getByText("The theme is premium.")).toBeVisible();

  // The theme store shows its price.
  await adminPage.goto(`/themes/${SLUG}`);
  await expect(adminPage.locator("[data-theme-price]").first()).toContainText(/NOK\s1,990/);
  await admin.close();

  // The owner: Design settings says what it costs before the button that pays.
  const owner = await browser.newContext({ storageState: OWNER.state });
  const page = await owner.newPage();
  await page.goto(`/admin/${STORE}/settings/design`);
  const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: TITLE, exact: true }) });
  await expect(item.getByText("Premium", { exact: true })).toBeVisible();
  await expect(item.getByText(/NOK\s1,990 excl\. VAT, once, charged now/).first()).toBeVisible();
  await item.getByText(`Apply ${TITLE}…`).click();
  await item.getByRole("button", { name: /^Pay NOK\s1,990 and use it$/ }).click();
  await expect(page.getByText(/Applied\./)).toBeVisible();

  // Now it is the store's: no price is asked again, and Billing lists it waiting to be invoiced.
  await page.goto(`/admin/${STORE}/settings/design`);
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: TITLE, exact: true }) }).getByText("Your store has this theme.").first()).toBeVisible();
  await page.goto(`/admin/${STORE}/billing`);
  const themes = page.getByRole("region", { name: "Themes" });
  const row = themes.getByRole("listitem").filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await expect(row.getByText("Being invoiced")).toBeVisible();
  await owner.close();

  const sql = testDb();
  try {
    const rows = await sql`select p.status, p.currency, p.amount_minor::int as amount from commerce.theme_purchases p join commerce.stores s on s.id = p.store_id where s.slug = ${STORE} and p.preset_id = ${presetId}`;
    expect(rows).toEqual([{ status: "due", currency: "NOK", amount: 199000 }]);
  } finally {
    await sql.end();
  }
});
