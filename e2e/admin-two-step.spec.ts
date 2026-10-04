import { expect, test } from "@playwright/test";

/**
 * Two-step sign-in's pages (wave 1, 1f, docs/wave-1-trust.md 2.6), as far as a test without a Supabase session can see them: someone who has
 * not signed in has nothing to do on any of them and is sent to sign in, and the sign-in page says what happened after a recovery code. The
 * challenge itself, enrolling and the gate need a real Supabase Auth and are held by the integration tests with a stand-in client; the
 * platform admin's real enrolment in production is a manual check the lead records.
 */

for (const path of ["/admin/sign-in/two-step", "/admin/sign-in/two-step/set-up", "/admin/sign-in/two-step/recovery"]) {
  test(`${path} sends someone who has not signed in to sign in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL("/admin/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in to Kaizen" })).toBeVisible();
  });
}

test("the pages keep a `next` out of other sites", async ({ page }) => {
  await page.goto("/admin/sign-in/two-step?next=https://evil.example/");
  await expect(page).toHaveURL("/admin/sign-in");
});

test("after a recovery code the sign-in page says the second step was taken away and will be asked for again", async ({ page }) => {
  await page.goto("/admin/sign-in?notice=recovered");
  await expect(page.getByRole("status").filter({ hasText: "recovery code worked" })).toContainText("you will be asked to set it up once more");
  // The sign-in form is still there.
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("the second step's pages are not indexed", async ({ page }) => {
  await page.goto("/admin/sign-in/two-step/set-up");
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});
