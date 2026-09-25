import { expect, test } from "@playwright/test";

test("the admin sends visitors without a session to sign in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL("/admin/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to Kaizen" })).toBeVisible();
  await expect(page.locator('head meta[name="robots"]').first()).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("the sign-in form does not reveal who has access", async ({ page }) => {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill("stranger@example.com");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Wrong email or password.");
  await expect(page).toHaveURL("/admin/sign-in");

  // The link button needs no password.
  await page.getByLabel("Password", { exact: true }).fill("");
  await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If that email has access, a sign-in link is on its way.",
  );
});

test("the password can be shown before signing in", async ({ page }) => {
  await page.goto("/admin/sign-in");
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(password).toHaveAttribute("type", "text");
});

test("a forgotten password gets the same reply for any email", async ({ page }) => {
  await page.goto("/admin/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL("/admin/forgot-password");
  await page.getByRole("textbox", { name: "Email" }).fill("stranger@example.com");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If that email has access, we have sent it a link to choose a new password.",
  );
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});

test("admin pages are not reachable without a session", async ({ page }) => {
  const paths = [
    "/admin/demo",
    "/admin/demo/settings/payments",
    "/admin/demo/settings/seo",
    "/admin/demo/staff",
    "/admin/account",
    "/admin/platform/seo",
    "/admin/demo/discounts",
    "/admin/platform/discounts",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page).toHaveURL("/admin/sign-in");
  }
});

test("admin pages send nothing of theirs to a visitor without a session, before the redirect", async ({ request }) => {
  // The redirect runs in the browser, so the response itself must hold none of
  // the page: every admin page's heading has this class, rendered or streamed.
  const paths = [
    "/admin/platform",
    "/admin/platform/customers",
    "/admin/platform/stores",
    "/admin/platform/stores/demo",
    "/admin/platform/plans",
    "/admin/platform/emails",
    "/admin/platform/plan-reminders",
    "/admin/platform/stripe",
    "/admin/platform/seo",
    "/admin/demo/customers",
    "/admin/demo/orders",
    "/admin/demo/wishlists",
    "/admin/demo/wishlists/activity",
  ];
  for (const path of paths) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain("/admin/sign-in");
    expect(html, path).not.toContain("text-2xl font-semibold");
  }
});

test("a sign-in link without a code is rejected", async ({ page }) => {
  await page.goto("/auth/callback");
  await expect(page).toHaveURL("/admin/sign-in?error=link");
  await expect(page.getByText("That link has expired or was already used.")).toBeVisible();
});
