import { expect, test } from "@playwright/test";

test("the admin sends visitors without a session to sign in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL("/admin/sign-in");
  await expect(page.getByRole("heading", { name: "Kaizen Store admin" })).toBeVisible();
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("the sign-in form does not reveal who has access", async ({ page }) => {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill("stranger@example.com");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If that email has access, a sign-in link is on its way.",
  );
});

test("admin pages are not reachable without a session", async ({ page }) => {
  for (const path of ["/admin/settings/payments", "/admin/staff"]) {
    await page.goto(path);
    await expect(page).toHaveURL("/admin/sign-in");
  }
});

test("a sign-in link without a code is rejected", async ({ page }) => {
  await page.goto("/auth/callback");
  await expect(page).toHaveURL("/admin/sign-in?error=link");
  await expect(page.getByText("That sign-in link has expired or was already used.")).toBeVisible();
});
