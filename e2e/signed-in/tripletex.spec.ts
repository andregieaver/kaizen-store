import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Tripletex (D453) as an owner meets it before connecting: off "coming soon" on the Integrations list, one guide, one field, one button,
 * and a paste that is not a token answered in plain words with nothing kept. A Read-only member sees the page and cannot connect. Nothing
 * here reaches Tripletex: a real connection is tested against the Tripletex in memory (`tripletex*.int.test.ts`).
 */

test.describe("as the owner", () => {
  test.use({ storageState: OWNER.state });

  test("finds Tripletex on the Integrations list and connects with one paste", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/integrations`);
    const tripletex = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Tripletex" }) });
    await expect(tripletex).not.toContainText("Coming soon");
    await tripletex.getByRole("link", { name: /Set up/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/integrations/tripletex$`));

    await expect(page.getByRole("heading", { name: "Connect Tripletex" })).toBeVisible();
    await expect(page.getByText("Press New token, choose Kaizena Flow as the application")).toBeVisible();
    await page.getByLabel("Token from Tripletex").fill("hello");
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("That does not look like a Tripletex token.")).toBeVisible();
    // Nothing was kept: the page still offers to connect.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Connect Tripletex" })).toBeVisible();
  });
});

test.describe("as a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("sees the page but cannot connect", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/integrations/tripletex`);
    await expect(page.getByText("Only the store's owner can connect Tripletex")).toBeVisible();
    await expect(page.getByLabel("Token from Tripletex")).toHaveCount(0);
  });
});
