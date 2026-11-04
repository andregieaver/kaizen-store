import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The AI manager's chat is fetched when its panel is first opened, not with every admin screen (`ai-manager-launcher.tsx`, D444): the
 * screen asks for no more scripts until the button is pressed, and then the panel draws the chat (its message box, or what to set up
 * where the store has no text model) instead of staying on Loading.
 */
test.use({ storageState: OWNER.state });

test("the AI manager's panel fetches its chat when opened and draws it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products`);
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.getByRole("button", { name: /AI manager/ }).first().click();
  const panel = page.getByRole("complementary", { name: "AI manager" });
  await expect(panel.getByRole("textbox").or(panel.getByText("The AI manager uses the store's AI and needs a text model."))).toBeVisible();
  await expect(panel.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
  expect(scripts.length, "the chat's scripts are fetched on opening").toBeGreaterThan(0);
});
