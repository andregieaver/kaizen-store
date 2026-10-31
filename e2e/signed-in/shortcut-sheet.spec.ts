import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/** `?` lists the admin's keyboard shortcuts from any page (PSI UX-07), and a question mark typed in a field stays a question mark. */
test.use({ storageState: OWNER.state });

test("? shows the keyboard shortcuts, and Escape closes them", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}`);
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  // Pressed again until the page's scripts listen.
  await expect(async () => {
    await page.locator("body").press("?");
    await expect(sheet).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(sheet.getByText("Open the AI manager")).toBeVisible();
  await expect(sheet.getByText("Save the draft")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("a question mark typed in a field is typed, not a shortcut", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/company`);
  await page.waitForLoadState("networkidle");
  const search = page.locator("main").getByRole("textbox").first();
  await search.fill("");
  await search.press("?");
  await expect(search).toHaveValue("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
});
