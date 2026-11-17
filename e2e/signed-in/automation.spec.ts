import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Automation rules as two people see them (wave 3, D238, `docs/wave-3-notifications.md` 2.5; row orders.staff-alerts-for-new-orders-order-automation),
 * since they were folded into workflows (ecosystem plan E3.3, D718): a new rule is made as a workflow, so the rules' addresses lead to Workflows
 * while the store has no rule left, and the rules' log stays; everything that runs by itself is on Settings → Automatic. Moving rules and running
 * the workflows they became on paid orders is held by rules-to-workflows.int.test.ts.
 */

const base = `/admin/${E2E_STORE}/settings/automation`;

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("is taken to the workflows to make a new rule, and finds what runs by itself in one place", async ({ page }) => {
    await page.goto(`${base}/new`);
    await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/settings/workflows$`));
    await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
    await page.goto(`/admin/${E2E_STORE}/settings/automatic`);
    await expect(page.getByRole("heading", { level: 1, name: "Automatic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "When an order is paid" })).toBeVisible();
    await expect(page.getByText("The customer gets the order confirmation email.")).toBeVisible();
  });
});

test.describe("a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("is taken to the workflows from the rules, and still sees their log", async ({ page }) => {
    await page.goto(base);
    await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
    await page.goto(`${base}/log`);
    await expect(page.getByRole("heading", { level: 1, name: "Automation log" })).toBeVisible();
    await page.goto(`/admin/${E2E_STORE}/settings/automatic`);
    await expect(page.getByRole("heading", { level: 1, name: "Automatic" })).toBeVisible();
  });
});
