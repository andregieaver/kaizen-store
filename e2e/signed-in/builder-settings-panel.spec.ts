import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The settings panel (D631): one button's style is copied onto another with the panel's menu, and from one button's settings to
 * the next the panel keeps the tab, how far it was scrolled and which folds are open; a component just added opens on Content to
 * be filled, and the trail leads to the column it is in.
 */
test.use({ storageState: OWNER.state, viewport: { width: 1600, height: 900 } });

test("a button's style pastes onto another button, and the panel keeps its tab, depth and folds from one to the next", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add button", exact: true }).press("Enter");
  const panel = page.locator("[data-settings-panel]");
  const body = panel.locator("[data-panel-body]");
  await expect(panel.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("textbox", { name: "Text", exact: true }).click();
  await page.keyboard.type("Shop now");

  // Its look: an outline. Nothing is copied yet, so Paste style waits.
  await panel.getByRole("tab", { name: "Design" }).click();
  await panel.getByText("Outline", { exact: true }).click();
  await expect(panel.getByRole("radio", { name: "Outline" })).toBeChecked();
  await panel.getByRole("button", { name: "More actions" }).click();
  await expect(panel.getByRole("menuitem", { name: "Paste style" })).toBeDisabled();
  await panel.getByRole("menuitem", { name: "Copy style" }).click();
  await expect(panel.getByText("Style copied. Open another button and choose Paste style.")).toBeVisible();

  // Spacing opened, and the tab scrolled down to it.
  await panel.getByRole("button", { name: /^Spacing/ }).click();
  await expect(panel.getByRole("group", { name: "Outside (margin)" })).toBeVisible();
  await body.evaluate((el) => el.scrollTo({ top: 400 }));
  const depth = await body.evaluate((el) => el.scrollTop);
  expect(depth).toBeGreaterThan(100);

  // A second button: just added, it opens on Content to be filled.
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Add button", exact: true }).press("Enter");
  await expect(panel.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("textbox", { name: "Text", exact: true }).click();
  await page.keyboard.type("Read more");

  // Its Design opens where the first button's was left: the same depth, Spacing open.
  await panel.getByRole("tab", { name: "Design" }).click();
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(depth);
  await expect(panel.getByRole("group", { name: "Outside (margin)" })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Filled" })).toBeChecked();

  // Paste style gives it the first button's outline, and says Undo takes it back.
  await panel.getByRole("button", { name: "More actions" }).click();
  await panel.getByRole("menuitem", { name: "Paste style" }).click();
  await expect(panel.getByRole("radio", { name: "Outline" })).toBeChecked();
  await expect(panel.getByText("Style pasted. Undo takes it back.")).toBeVisible();

  // The trail leads to its column, whose settings open on the tab last chosen.
  await panel.getByRole("navigation", { name: "Where it is" }).getByRole("button", { name: /^Column/ }).click();
  await expect(panel.getByRole("heading", { name: "Column" })).toBeVisible();
  await expect(panel.getByRole("tab", { name: "Design" })).toHaveAttribute("aria-selected", "true");
});
