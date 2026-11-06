import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

test.use({ storageState: OWNER.state });

/**
 * Changing the business behind the store (B8, D473) as an owner does it on Settings → Company: plans it with the name alone (the day
 * defaults to the next 1 January and the number may come later), sees what is missing and the checklist, ticks a step off and calls the
 * change off again. The store is left as it was found.
 */
test("an owner plans a change of the business behind the store, ticks a step off and calls it off", async ({ page }) => {
  const run = Date.now().toString(36);
  const name = `E2E Holding AS ${run}`;
  await page.goto(`/admin/${E2E_STORE}/settings/company`);
  const section = page.getByRole("region", { name: "Changing the business behind the store" });
  // A change left by an earlier run that stopped half-way is called off first.
  const leftOver = section.getByRole("button", { name: "Call off the change" });
  if (await leftOver.isVisible()) {
    await leftOver.click();
    await expect(section.getByText("Plan a change of business")).toBeVisible({ timeout: 30_000 });
  }

  await section.getByText("Plan a change of business").click();
  await section.getByLabel("The new business's legal name").fill(name);
  await section.getByRole("button", { name: "Plan the change" }).click();
  await expect(section.getByText(new RegExp(`Your business becomes ${name} on`))).toBeVisible({ timeout: 30_000 });
  await expect(section.getByText("Add the new business's organisation number.")).toBeVisible();
  await expect(section.getByRole("heading", { name: `What to set up for ${name}` })).toBeVisible();

  await section.getByRole("button", { name: "Mark Kaizena Flow's invoices done" }).click();
  await expect(section.getByRole("button", { name: "Mark Kaizena Flow's invoices not done" })).toBeVisible({ timeout: 30_000 });

  await section.getByRole("button", { name: "Call off the change" }).click();
  await expect(section.getByText("Plan a change of business")).toBeVisible({ timeout: 30_000 });
  await expect(section.getByText(name)).toHaveCount(0);
});
