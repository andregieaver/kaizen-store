import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Heatmaps and recordings of how owners use the admin (D895 phase 3b), as a store owner meets them once the platform's switch is open: asked
 * once on the store's home, with the short notice and a link to the privacy notice; their choice kept and changeable in account settings;
 * a staff member never asked. The switch is opened here in the database, as the platform owner would once the lawyer has answered.
 */

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.platform_settings set admin_signals_open = true`;
    await sql`delete from commerce.platform_admin_heat_days`;
    await sql`delete from commerce.platform_admin_click_cells`;
    await sql`delete from commerce.platform_admin_signal_choices where account_id in (select id from commerce.accounts where email in (${OWNER.email}, ${READER.email}))`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.platform_settings set admin_signals_open = false`;
    await sql`delete from commerce.platform_admin_signal_choices where account_id in (select id from commerce.accounts where email = ${OWNER.email})`;
  } finally {
    await sql.end();
  }
});

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("is asked once, chooses heatmaps only, and sees the choice in account settings", async ({ page }, info) => {
    await page.goto(`/admin/${E2E_STORE}`);
    const ask = page.getByRole("region", { name: "Help us make the admin easier" });
    await expect(ask).toBeVisible();
    await expect(ask.getByText("Orders, customers, messages, documents and invoices are never recorded")).toBeVisible();
    await expect(ask.getByRole("link", { name: "Read the privacy notice" })).toHaveAttribute("href", "/privacy");
    await page.screenshot({ path: info.outputPath("admin-use-ask.png"), fullPage: false });

    await ask.getByLabel(/Allow heatmaps/).check();
    await ask.getByRole("button", { name: "Save my choice" }).click();
    await expect(page.getByRole("region", { name: "Help us make the admin easier" })).toHaveCount(0);
    expect((await page.context().cookies()).find((c) => c.name === "kz_admin_use")?.value).toBe("h");

    await page.goto("/admin/account");
    const section = page.getByRole("region", { name: "Help us make the admin easier" });
    await expect(section.getByLabel(/Allow heatmaps/)).toBeChecked();
    await expect(section.getByLabel(/Also allow recordings/)).not.toBeChecked();
  });

  test("their screen views reach the admin heatmaps' totals under the screen's key, never the store's address", async ({ page, baseURL }) => {
    // The first test chose heatmaps; its browser cookie is set again here, as the choice left it (each test has its own browser).
    await page.context().addCookies([{ name: "kz_admin_use", value: "h", url: new URL("/admin", baseURL).toString() }]);
    await page.goto(`/admin/${E2E_STORE}/products`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.mouse.click(400, 400);
    await page.waitForTimeout(1500);
    // Leaving the screen ends its view and sends its summary.
    await page.goto(`/admin/${E2E_STORE}/orders`);
    await expect
      .poll(
        async () => {
          const sql = testDb();
          try {
            return (await sql`select screen, views from commerce.platform_admin_heat_days where screen like 's%' order by screen`).map((r) => `${r.screen}:${r.views}`);
          } finally {
            await sql.end();
          }
        },
        { timeout: 10_000 },
      )
      .toContain("s/products:1");
    const sql = testDb();
    try {
      // The orders screen is never measured, and no row names the store.
      expect((await sql`select count(*)::int as n from commerce.platform_admin_heat_days where screen like '%orders%' or screen like ${`%${E2E_STORE}%`}`)[0].n).toBe(0);
    } finally {
      await sql.end();
    }
  });
});

test.describe("a staff member", () => {
  test.use({ storageState: READER.state });

  test("is never asked", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("region", { name: "Help us make the admin easier" })).toHaveCount(0);
  });
});
