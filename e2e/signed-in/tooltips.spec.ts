import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The admin's hints (PSI UX-10): an element's title shows as a tip on hover and on keyboard focus, which a native title never is; the
 * element keeps its name (a title that was its only name becomes its label meanwhile), Escape hides the tip, and the title comes back.
 */
test.use({ storageState: OWNER.state });

test("a title shows as a tip on hover and on keyboard focus, and Escape hides it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}`);
  await expect(page.locator("main").first()).toBeVisible();
  // A plain icon button whose title is its only name, as many in the admin are.
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "tip-probe";
    button.title = "Remove this row";
    button.textContent = "";
    button.style.cssText = "width:24px;height:24px";
    document.querySelector("main")?.prepend(button);
  });
  const probe = page.locator("#tip-probe");
  const tip = page.getByRole("tooltip");

  await expect(async () => {
    await probe.hover();
    await expect(tip).toHaveText("Remove this row", { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Remove this row" })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  await expect(probe).toHaveAttribute("title", "Remove this row");

  await page.keyboard.press("Shift");
  await probe.focus();
  await expect(tip).toHaveText("Remove this row");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(probe).toHaveAttribute("title", "Remove this row");
});
