import { expect, test } from "@playwright/test";

import { testDb } from "./db";

test("anyone can ask for a store, and the form does not reveal repeat requests", async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/sign-up");
    await page.getByLabel("Your name").fill("Kari Nordmann");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Store name").fill("Karis Kopper");
    await page.getByLabel(/What will you sell/).fill("Keramikk");
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

test("the home page leads to sign-up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start your store" }).click();
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
