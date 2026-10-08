import { expect, test } from "@playwright/test";

/**
 * Onboarding (D178 step 6, `docs/store-features.md` 4f): the setup wizard asks "What will you sell?" first and follows the store's features.
 * Signing in to an admin needs Supabase's own sign-in, which the end-to-end tests have no fixture for (the signed-in admin is checked by hand,
 * D158), so answering the question for a website and the wizard without the shop's steps are held by the integration tests
 * (`src/server/store-features-onboarding.int.test.ts`, which call the same functions the wizard's action calls), the step rules by
 * `src/lib/setup-steps.test.ts`, the form by `src/components/admin/feature-question.test.ts` and the store template cards' "Starts with"
 * by `starter-cards.test.ts` (the sign-up page's cards are cached for hours, so a template made in a test is not seen there). What this
 * spec holds: the wizard's pages, the new ones included, give a visitor without a session nothing.
 */

test("the setup wizard's steps, the question and the bookings step included, send a visitor without a session to sign in", async ({ page }) => {
  for (const path of ["/admin/demo/setup", "/admin/demo/setup/features", "/admin/demo/setup/bookings", "/admin/demo/setup/launch", "/admin/platform/store-templates"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL("/admin/sign-in");
  }
});
