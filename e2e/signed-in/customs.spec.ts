import { expect, test } from "@playwright/test";

import { testDb, testStore } from "../db";
import { ADMIN, OWNER } from "./accounts";

/**
 * Customs and duties as the owner and the platform's admin meet them (wave 7 unit I, D343; row orders.customs-and-duties). The owner, in a store
 * of their own based in Norway and selling in several countries (the shared store has no country, so it is told to say where its goods are
 * sent from), sees the countries its goods cross a customs border into (Sweden and Denmark, not Norway) and switches Denmark to duties
 * collected at checkout and back; the platform's admin adds a duty rate of a destination no real row uses, marks it verified and removes
 * it. The money is held by duties.test.ts, customs.int.test.ts and the euro scenario in checkout-kinds.int.test.ts; this holds the screens.
 *
 * Shared data: none; the rate row is this spec's own destination (XQ), removed after.
 */

test.describe.configure({ mode: "serial" });

const DEST = "XQ";

let store = { slug: "", id: "" };

test.beforeAll(async () => {
  store = await testStore("toll-eier", ["countries"]);
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = now(), country = 'NO' where id = ${store.id}`;
    await sql`
      insert into commerce.store_members (store_id, account_id, role, kind)
      select ${store.id}, a.id, 'owner', 'staff' from commerce.accounts a where lower(a.email) = ${OWNER.email}
      on conflict (store_id, account_id) do update set role = 'owner'`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.duty_rates where destination = ${DEST}`;
  } finally {
    await sql.end();
  }
});

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("chooses who pays duties in a country the goods cross a border into, and puts it back", async ({ page }) => {
    await page.goto(`/admin/${store.slug}/settings/customs`);
    await expect(page.getByRole("heading", { name: "Duties and import VAT", level: 1 })).toBeVisible();
    await expect(page.getByText("Your goods are sent from Norway.")).toBeVisible();
    const countries = page.getByRole("list", { name: "Who pays duties and import VAT" });
    // Norway is the store's own country: nothing to choose there.
    // (by the row's title: every row's VAT scheme tick names VOEC in Norway)
    await expect(countries.getByRole("listitem").filter({ has: page.getByText("Norway", { exact: true }) })).toHaveCount(0);
    const denmark = countries.getByRole("listitem").filter({ hasText: "Denmark" });
    const mode = denmark.getByTestId("customs-mode-DK");
    await expect(mode).toHaveValue("dap");

    await mode.selectOption("ddp");
    await denmark.getByRole("button", { name: "Save" }).click();
    await expect(denmark.getByText("Saved.")).toBeVisible();
    // The page is drawn again from what was saved.
    await page.reload();
    await expect(page.getByTestId("customs-mode-DK")).toHaveValue("ddp");
    await expect(countries.getByRole("listitem").filter({ hasText: "Denmark" })).toContainText("DDP");

    // Back to the carrier collecting on delivery, as the store had it.
    const again = page.getByRole("list", { name: "Who pays duties and import VAT" }).getByRole("listitem").filter({ hasText: "Denmark" });
    await again.getByTestId("customs-mode-DK").selectOption("dap");
    await again.getByRole("button", { name: "Save" }).click();
    await expect(again.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("customs-mode-DK")).toHaveValue("dap");
  });
});

test.describe("the platform's admin", () => {
  test.use({ storageState: ADMIN.state });

  test("keeps the duty rates: each row with its source, verified by a person, removed when wrong", async ({ page }) => {
    await page.goto("/admin/platform/duty-rates");
    await expect(page.getByRole("heading", { name: "Duty rates", level: 1 })).toBeVisible();
    const table = page.getByTestId("duty-rates");
    // The starter rows cite their sources and start unverified.
    await expect(table.getByRole("link", { name: "https://www.gov.uk/goods-sent-from-abroad/tax-and-duty" })).toBeVisible();

    await page.getByLabel("Destination").fill(DEST);
    await page.getByLabel("HS heading").fill("610910");
    await page.getByLabel("Duty rate (%)").fill("12");
    await page.getByLabel("Source (an https address)").fill("https://www.trade-tariff.service.gov.uk/commodities/6109100010");
    await page.getByLabel("Read on").fill("2026-10-27");
    await page.getByRole("button", { name: "Save the row" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    const row = table.getByRole("row").filter({ hasText: DEST });
    await expect(row).toContainText("12 %");
    await expect(row).toContainText("Unverified");
    await row.getByRole("button", { name: "Mark verified" }).click();
    await expect(table.getByRole("row").filter({ hasText: DEST })).toContainText("Verified");

    await table.getByRole("row").filter({ hasText: DEST }).getByRole("button", { name: "Remove" }).click();
    await expect(table.getByRole("row").filter({ hasText: DEST })).toHaveCount(0);
  });
});
