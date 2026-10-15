import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Automation rules as two people see them (wave 3, D238, `docs/wave-3-notifications.md` 2.5; row orders.staff-alerts-for-new-orders-order-automation):
 * the owner makes a rule (a total and a tag), sees the sentence code writes from it in the list, and deletes it; the Read-only member sees the rules
 * but gets no editor. Running rules on paid orders is held by order-rules.int.test.ts.
 */

const base = `/admin/${E2E_STORE}/settings/automation`;

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("makes a rule, finds its sentence in the list and deletes it", async ({ page }) => {
    const name = `E2E big orders ${Date.now()}`;
    await page.goto(`${base}/new`);
    await expect(page.getByRole("heading", { level: 1, name: "New rule" })).toBeVisible();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Add a condition" }).click();
    await page.getByLabel(/^Amount in/).fill("1000");
    await page.getByLabel("Tag", { exact: true }).fill("E2E big");
    await expect(page.getByText(/When an order is paid and the total is at least .*1,000\.00.*, tag "E2E big"\./)).toBeVisible();
    await page.getByRole("button", { name: "Save rule" }).click();

    await expect(page).toHaveURL(new RegExp(`${base}$`));
    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toContainText('tag "E2E big"');
    await row.getByRole("button", { name: `Delete ${name}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  });
});

test.describe("a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("sees the rules and the log but gets no editor", async ({ page }) => {
    await page.goto(base);
    await expect(page.getByRole("heading", { level: 1, name: "Automation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New rule" })).toHaveCount(0);
    await page.goto(`${base}/log`);
    await expect(page.getByRole("heading", { level: 1, name: "Automation log" })).toBeVisible();
    await page.goto(`${base}/new`);
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  });
});
