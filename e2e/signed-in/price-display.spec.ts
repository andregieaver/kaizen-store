import { expect, test } from "@playwright/test";

import { testDb, testStore } from "../db";
import { OWNER } from "./accounts";

/**
 * Prices and quantity as the owner sets them (D429, D430): Homer's three choices on one page, a preview of the price as shoppers will read
 * it, a refusal of words the claims filter finds, and the shop following once saved. The rules are held by the unit and database tests; this
 * holds the screen. Shared data: none; the store is this spec's own.
 */

test.describe.configure({ mode: "serial" });

let store = { slug: "", id: "" };

test.beforeAll(async () => {
  store = await testStore("prisvisning");
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

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("leaves ,00 off whole prices, writes a word before them, and the shop follows", async ({ page }) => {
    await page.goto(`/admin/${store.slug}/settings/prices`);
    await expect(page.getByRole("heading", { name: "Prices and quantity", level: 1 })).toBeVisible();
    // Homer's default: decimals always, no words, − and + on product pages; the depth is folded away.
    await expect(page.getByRole("radio", { name: /Always show the decimals/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /− and \+ beside the number/ })).toBeChecked();
    await expect(page.getByRole("combobox", { name: "Norway" })).toBeHidden();
    await page.locator("summary").filter({ hasText: "Advanced" }).click();
    await expect(page.getByRole("combobox", { name: "Norway" })).toHaveValue("");

    await page.getByRole("radio", { name: /Leave ,00 off whole amounts/ }).check();
    // A claim is refused, and said why.
    await page.getByRole("textbox", { name: "Before the price" }).fill("Beste pris");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/could mislead shoppers/)).toBeVisible();

    await page.getByRole("textbox", { name: "Before the price" }).fill("Kun");
    await expect(page.getByTestId("price-words-preview")).toContainText(/Kun 499\s+kr/);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved. Your shop shows prices this way now.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("radio", { name: /Leave ,00 off whole amounts/ })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Before the price" })).toHaveValue("Kun");

    await page.goto(`/s/${store.slug}/p/demo-handlenett`);
    await expect(page.getByRole("main")).toContainText(/Kun 199\s+kr/);
  });
});
