import { expect, test, type Page } from "@playwright/test";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * The customer notifications and staff alerts as two people see them (wave 3, D238, `docs/wave-3-notifications.md` 2.1 and 2.4; row
 * orders.editable-notification-email-templates): the owner edits the shipping email's Norwegian subject with a placeholder, sees it in the preview,
 * is refused a claim, finds the confirmation without a switch, and goes back to the standard text; the Read-only member reads and cannot save, and
 * gets the 404 on the owner's staff alerts page. The server side is held by notifications.int.test.ts.
 */

const base = `/admin/${E2E_STORE}/settings/notifications`;

/** The Norwegian words when the store offers more than one language (the picker is drawn only then). */
async function chooseNorwegian(page: Page) {
  const nb = page.getByRole("radio", { name: /Norwegian Bokmål/ });
  if (await nb.count()) await nb.first().click();
}

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("finds the order confirmation always on, with no switch, and the carrier emails off", async ({ page }) => {
    await page.goto(base);
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Order confirmation", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Switch (off|on) Order confirmation/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch on Out for delivery \(carrier\)/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Staff alerts" })).toBeVisible();
  });

  test("writes the shipping email's subject with a placeholder, sees it in the preview, is refused a claim, and goes back to the standard text", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(`${base}/order-sent`);
    await expect(page.getByRole("heading", { level: 1, name: "Order sent" })).toBeVisible();
    await chooseNorwegian(page);
    const subject = page.getByLabel(/^Subject/);

    // A claim is refused before it is saved.
    await subject.fill("Beste pris på {order_number}");
    await expect(page.getByText(/^The subject says ".+": .+ offers and claims are marketing\.$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

    // A placeholder the email does not have is refused too.
    await subject.fill("Pakken {nope} er på vei");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

    await subject.fill("Pakken med ordre {order_number} er på vei");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText(/Subject:\s*Pakken med ordre \S+ er på vei/)).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.goto(base);
    await expect(page.getByText(/Norwegian Bokmål: your text/).first()).toBeVisible();

    await page.goto(`${base}/order-sent`);
    await chooseNorwegian(page);
    await page.getByRole("button", { name: "Use standard text" }).click();
    await expect(page.getByRole("status").filter({ hasText: "The standard text is used again." })).toBeVisible();
  });

  test("shows the withdrawal acknowledgement without fields to edit", async ({ page }) => {
    await page.goto(`${base}/return-acknowledgement`);
    await expect(page.getByText("This email is the legal acknowledgement of a withdrawal and cannot be changed.")).toBeVisible();
    await expect(page.getByLabel(/^Subject/)).toHaveCount(0);
  });

  test("opens the staff alerts with the owners chosen for new orders by default", async ({ page }) => {
    await page.goto(`${base}/staff`);
    await expect(page.getByRole("heading", { level: 1, name: "Staff alerts" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: `New order emails to ${OWNER.name}` })).toBeChecked();
  });
});

test.describe("a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("reads the emails but cannot switch or save them, and gets the 404 on the staff alerts", async ({ page }) => {
    await page.goto(base);
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Switch (off|on)/ })).toHaveCount(0);
    await page.goto(`${base}/order-sent`);
    await expect(page.getByText("You can see this email but not change it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await page.goto(`${base}/staff`);
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  });
});
