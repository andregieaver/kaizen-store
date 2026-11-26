import { gunzipSync } from "node:zlib";

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
    // The collector loads after the page; a view shorter than a second is never sent.
    await page.waitForLoadState("networkidle");
    await page.mouse.click(400, 400);
    await page.waitForTimeout(2500);
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

test.describe("the owner's recordings", () => {
  test.use({ storageState: OWNER.state });

  test("record a measured screen with every word hidden, and send nothing from a screen never measured", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "kz_admin_use", value: "hr", url: new URL("/admin", baseURL).toString() }]);
    // This tab is in the recorded half (the share is a coin toss otherwise).
    await page.addInitScript(() => {
      const now = Date.now();
      sessionStorage.setItem("kaizen_replay_admin", JSON.stringify({ v: 1, id: crypto.randomUUID(), seq: 0, sampled: true, started: now - 10_000, lastInput: now, pages: 0, qualified: false }));
    });
    const sent: string[] = [];
    await page.route("**/api/admin-use/rec**", async (route) => {
      const bytes = route.request().postDataBuffer() ?? Buffer.alloc(0);
      sent.push(route.request().url().includes("z=1") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"));
      await route.fulfill({ status: 204 });
    });
    await page.goto(`/admin/${E2E_STORE}/products`);
    await expect(page.getByRole("main")).toBeVisible();
    // The recorder loads after the page; once it records the screen, a click is the interaction it waits for.
    await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem("kaizen_replay_admin") ?? "{}").pages), { timeout: 10_000 }).toBe(1);
    await page.mouse.click(400, 300);
    await expect.poll(() => sent.length, { timeout: 20_000 }).toBeGreaterThan(0);
    const body = JSON.parse(sent[0]) as { meta: { pages: string[] }; events: unknown[] };
    expect(body.meta.pages).toEqual(["s/products"]);
    const text = JSON.stringify(body.events);
    expect(text).toContain("•••");
    // The screen's own words and the store's address are never sent, not even in a heading.
    expect(text).not.toContain(E2E_STORE);
    expect(text).not.toMatch(/"textContent":"[^"•\s][^"]*[a-z]{3}/i);

    const before = sent.length;
    await page.goto(`/admin/${E2E_STORE}/orders`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.mouse.click(400, 300);
    await page.waitForTimeout(6000);
    for (const segment of sent.slice(before)) expect(segment).not.toContain("orders");
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
