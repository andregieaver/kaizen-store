import { expect, test } from "@playwright/test";

/**
 * The product page's variant dropdown works from the keyboard as a select
 * does (a select-only combobox): arrows open and move, Enter chooses,
 * Escape closes without choosing, typing jumps to a variant, and a sold-out
 * variant is shown but cannot be chosen.
 */
test("the variant dropdown works from the keyboard", async ({ page }) => {
  await page.goto("/s/demo/no/p/demo-keramikkopp");
  const variants = page.getByRole("region", { name: "Varianter" });
  const choose = variants.getByRole("combobox", { name: "Velg variant" });
  const list = variants.getByRole("listbox");
  await expect(choose).toContainText("Farge: Svart");

  await choose.focus();
  await page.keyboard.press("ArrowDown");
  await expect(choose).toHaveAttribute("aria-expanded", "true");
  await expect(list).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list.getByRole("option").first().locator("img")).toBeVisible();

  // Escape closes without changing the choice.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(choose).toContainText("Farge: Svart");

  // Down to the other variant and Enter chooses it; focus stays on the dropdown.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(list).toBeHidden();
  await expect(choose).toContainText("Farge: Hvit");
  await expect(choose).toBeFocused();
  // The phone's bottom bar (hidden here) follows the page's choice, so both add the same variant.
  await expect(page.locator('[data-product-bar] [role="option"][aria-selected="true"]')).toContainText("Farge: Hvit");

  // Typing a variant's first letters chooses it while closed.
  await page.keyboard.type("farge: s", { delay: 30 });
  await expect(choose).toContainText("Farge: Svart");
});

test("a sold-out variant is shown but cannot be chosen", async ({ page }) => {
  await page.goto("/s/demo/no/p/demo-notatbok");
  const variants = page.getByRole("region", { name: "Varianter" });
  const choose = variants.getByRole("combobox", { name: "Velg variant" });
  await expect(choose).toContainText("Linjert");
  await choose.click();
  const dotted = variants.getByRole("option", { name: /Prikket/ });
  await expect(dotted).toHaveAttribute("aria-disabled", "true");
  await expect(dotted).toContainText("Utsolgt");
  // Playwright would wait for it to be enabled; a shopper's tap does nothing.
  await dotted.click({ force: true });
  await expect(choose).toContainText("Linjert");
});
