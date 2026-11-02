import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * A dual heading (D425): a heading's second part, in the same heading, with a look of its own, side by side with the first or
 * one under it.
 */
test.use({ storageState: OWNER.state });

test("a heading with a second part draws both in one heading, side by side or one under the other, each with its own look", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add heading", exact: true }).press("Enter");

  // The new heading's settings are open: its words, then the second part's.
  await page.getByRole("textbox", { name: "Heading", exact: true }).click();
  await page.keyboard.type("We are");
  await expect(page.getByRole("checkbox", { name: /^One under the other/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Second part", exact: true }).click();
  await page.keyboard.type("Kaizena Flow");

  // One heading to a screen reader, its two parts each marked for its own look.
  const heading = page.locator('[data-builder-item="block"]').getByRole("heading", { name: "We are Kaizena Flow" });
  await expect(heading).toBeVisible();
  const second = heading.locator("[data-kz-text=second]");
  await expect(second).toHaveText("Kaizena Flow");
  await expect(heading.locator("[data-kz-text=first]")).toHaveText("We are");
  expect(await second.evaluate((el) => getComputedStyle(el).display)).toBe("inline");

  await page.getByRole("checkbox", { name: /^One under the other/ }).check();
  await expect.poll(() => second.evaluate((el) => getComputedStyle(el).display)).toBe("block");
  await page.getByRole("checkbox", { name: /^One under the other/ }).uncheck();
  await expect.poll(() => second.evaluate((el) => getComputedStyle(el).display)).toBe("inline");

  // Each part's look is its own, under Style.
  await page.getByRole("tab", { name: "Style" }).click();
  await expect(page.getByText("First part", { exact: true })).toBeVisible();
  await expect(page.getByText("Second part", { exact: true })).toBeVisible();
});
