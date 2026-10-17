import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * A theme's own sections in the page builder (D272, `docs/signature-themes.md` step 4): with a signature theme live, the Rows tab offers
 * its sections, and a press puts one on the page in words for any store. A store of the owner's own for this test, so the theme switch
 * tests never see it change theme.
 */

const STORE = "e2e-sections";
const atelier = LAUNCH_THEMES.find((theme) => theme.key === "atelier")!;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Sections') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Sections', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    // A stand-in for Atelier as Kaizena Flow keeps it (no workspace: no browser test syncs the launch themes), live on the store; the
    // sections are offered by the live theme's key.
    await sql`
      insert into commerce.design_presets (title, snapshot, launch_key) values ('Atelier', ${sql.json(atelier.snapshot as never)}, 'atelier')
      on conflict (launch_key) do nothing`;
    const [preset] = await sql`select id from commerce.design_presets where launch_key = 'atelier'`;
    const [live] = await sql`select preset_id from commerce.store_theme_installs where store_id = ${store.id} and live`;
    if (live?.preset_id !== preset.id) {
      await sql`update commerce.store_theme_installs set live = false, look = '{}'::jsonb where store_id = ${store.id} and live`;
      await sql`insert into commerce.store_theme_installs (store_id, preset_id, title, live) values (${store.id}, ${preset.id}, 'Atelier', true)`;
    }
  } finally {
    await sql.end();
  }
});

test.describe("the owner, with a signature theme live", () => {
  test.use({ storageState: OWNER.state });

  test("finds the theme's sections on the Rows tab and adds one to the page in words for any store", async ({ page }) => {
    await page.goto(`/admin/${STORE}/pages/new`);
    await page.getByRole("tab", { name: "Rows" }).click();
    const sections = page.getByRole("region", { name: `From ${atelier.title}` });
    await expect(sections).toBeVisible({ timeout: 20_000 });
    await expect(sections.getByRole("button", { name: "Add the section Three collections" })).toBeVisible();
    await sections.getByRole("button", { name: "Add the section Still life" }).click();
    // The hero's words for any store, on the canvas; never the demo store's.
    await expect(page.getByText("Say what you make in a few", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Ostra Studio")).toHaveCount(0);
  });
});
