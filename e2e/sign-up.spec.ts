import { expect, test, type Page } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { testDb } from "./db";

/**
 * Sign-up one step at a time (D456): the store, its look where the build has themes to choose (Standard is chosen already), then the person.
 * Leaves the page on the last step, its fields filled in.
 */
async function walkSteps(page: Page, { storeName, email }: { storeName: string; email: string }) {
  await page.getByLabel("Store name").fill(storeName);
  await page.getByLabel(/What will you sell/).fill("Keramikk");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /^(Choose a look|About you)$/ })).toBeVisible();
  if (await page.getByRole("heading", { level: 2, name: "Choose a look" }).isVisible()) await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "About you" })).toBeVisible();
  await page.getByLabel("Your name").fill("Kari Nordmann");
  await page.getByLabel("Email").fill(email);
}

test("anyone can ask for a store, and the form does not reveal repeat requests", async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/sign-up");
    await walkSteps(page, { storeName: "Karis Kopper", email });
    await page.getByRole("button", { name: "Request a store" }).click();
    await expect(page.getByRole("status")).toContainText("We have your request.");
  }

  const sql = testDb();
  try {
    const rows = await sql`select status from commerce.access_requests where email = ${email}`;
    expect(rows).toEqual([{ status: "pending" }]);
  } finally {
    await sql.end();
  }
});

test("a refused field is marked, described by its problem and focused, on its own step (PSI ACC-05, D456)", async ({ page }) => {
  await page.goto("/sign-up");
  // Spaces pass the browser's own check; the server's trims them away.
  await walkSteps(page, { storeName: "   ", email: `owner-${Date.now()}@example.com` });
  await page.getByRole("button", { name: "Request a store" }).click();
  // The store's name is on the first step: it comes back, the field marked and focused.
  await expect(page.getByRole("heading", { level: 2, name: "Your store" })).toBeVisible();
  const storeName = page.getByLabel("Store name");
  await expect(storeName).toHaveAttribute("aria-invalid", "true");
  await expect(storeName).toBeFocused();
  const described = await storeName.getAttribute("aria-describedby");
  expect(described).toBeTruthy();
  await expect(page.locator(`[id="${described}"]`)).toBeVisible();
  await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid", "true");

  // What was typed on the later steps is still there.
  await storeName.fill("Karis Kopper");
  await storeName.press("Enter");
  if (await page.getByRole("heading", { level: 2, name: "Choose a look" }).isVisible()) await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Your name")).toHaveValue("Kari Nordmann");
  await page.getByRole("button", { name: "Request a store" }).click();
  await expect(page.getByRole("status")).toContainText("We have your request.");
});

test("sign-up asks one thing at a time: Continue checks the step, Enter continues, going back keeps what was typed (D456)", async ({ page }) => {
  await page.goto("/sign-up");
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(steps.locator('[aria-current="step"]')).toContainText("Your store");
  await expect(page.getByText("Step 1 of")).toBeVisible();
  // Only the first step is shown.
  await expect(page.getByLabel("Your name")).toBeHidden();
  await expect(page.getByRole("button", { name: "Request a store" })).toBeHidden();

  // An empty name stops Continue, at the field.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Store name")).toBeFocused();
  await expect(page.getByRole("heading", { level: 2, name: "Your store" })).toBeVisible();

  // Enter in a field is Continue; the new step's heading has the focus.
  await page.getByLabel("Store name").fill("Karis Kopper");
  await page.getByLabel("Store name").press("Enter");
  const next = page.getByRole("heading", { level: 2, name: /^(Choose a look|About you)$/ });
  await expect(next).toBeFocused();
  if (await page.getByRole("heading", { level: 2, name: "Choose a look" }).isVisible()) {
    // Standard is chosen until another look is; each step is scanned as it is shown (the page's own scan sees the first).
    await expect(page.locator('input[name="design"][value=""]')).toBeChecked();
    expect(describeFindings(await violationsOn(page))).toEqual([]);
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.getByRole("heading", { level: 2, name: "About you" })).toBeVisible();
  await expect(steps.locator('[aria-current="step"]')).toContainText("About you");
  expect(describeFindings(await violationsOn(page))).toEqual([]);

  // The last step repeats the store's name, and Change goes back to it with what was typed.
  await page.getByLabel("Your name").fill("Kari Nordmann");
  await expect(page.getByRole("definition").filter({ hasText: "Karis Kopper" })).toBeVisible();
  await page.getByRole("button", { name: "Change Store" }).click();
  await expect(page.getByLabel("Store name")).toHaveValue("Karis Kopper");
  // A step reached before is one press away in the list of steps.
  await steps.getByRole("button", { name: "About you" }).click();
  await expect(page.getByLabel("Your name")).toHaveValue("Kari Nordmann");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /^(Choose a look|Your store)$/ })).toBeVisible();
});

test.describe("without scripts", () => {
  test.use({ javaScriptEnabled: false });

  test("every step of sign-up is on the one page, with the send button at the end (D456)", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel("Store name")).toBeVisible();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request a store" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Steps" })).toBeHidden();
  });
});

test("the home page leads to sign-up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Start your store" }).click();
  await expect(page).toHaveURL("/sign-up");
  await expect(page.getByRole("heading", { level: 1, name: "Start your store" })).toBeVisible();
});

test("an approved request gets its own copy of the demo store, in preview until opened", async ({ page }) => {
  const slug = `e2e-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Ola', 'Olas Kopper') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Olas Kopper', null)`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${slug}/no`);
  await expect(page.getByRole("link", { name: "Olas Kopper" }).first()).toBeVisible();
  await expect(page.getByText("Forhåndsvisning: Denne butikken er ikke åpnet ennå.")).toBeVisible();
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);

  // The copy has no price history, so no reduction is advertised.
  const mug = page.getByRole("listitem").filter({ hasText: "Demo: Keramikkopp" });
  await expect(mug).toContainText("249,00");
  await expect(mug).not.toContainText("Laveste pris siste 30 dager");

  // Its cart is its own: adding here leaves the demo store's cart empty.
  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  await page.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(page.getByRole("link", { name: "Handlekurv (1)" })).toBeVisible();
  await page.goto("/s/demo/no");
  await expect(page.getByRole("link", { name: "Handlekurv", exact: true })).toBeVisible();
});
