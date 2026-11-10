import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The Animation component in the builder (D538): a component of its own beside Video, whose settings open as it is added
 * because it is nothing until it has its file; a picture's description and link come once it has one, and whether it goes
 * round is under Style. A header's logo part offers the same one button. This build has no storage, so both say that
 * uploads are off where the button would be.
 */
test.use({ storageState: OWNER.state });

test("an animation is added from the sidebar, opens to be filled, and says how it plays under Style", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add animation", exact: true }).press("Enter");

  // On the page it says what is missing and how to get to it.
  const block = page.locator('[data-builder-item="block"]').filter({ hasText: "No animation yet." });
  await expect(block).toContainText("No animation yet. Double-click or use the wrench.");

  // Its settings are open: where its file goes, and nothing to fill in before it has one.
  const panel = page.getByRole("dialog", { name: "Animation" });
  await expect(panel.getByText("No animation yet", { exact: true })).toBeVisible();
  await expect(panel.getByText("Uploads are not set up on this server.")).toBeVisible();
  await expect(panel.getByRole("textbox", { name: /^Description/ })).toHaveCount(0);

  // Lisa's: its width and place as a picture's, and whether it goes round.
  await panel.getByRole("tab", { name: "Style" }).click();
  await expect(panel.getByRole("checkbox", { name: /^Play again and again/ })).not.toBeChecked();
});
