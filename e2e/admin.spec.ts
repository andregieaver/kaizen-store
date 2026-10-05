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
  // About sixty page loads in a row: under the full suite's parallel load they outrun the default 30 s.
  test.slow();
  const paths = [
    "/admin/demo",
    "/admin/demo/settings/payments",
    "/admin/demo/settings/seo",
    "/admin/demo/settings/localization",
    "/admin/demo/translate",
    "/admin/platform/languages",
    "/admin/platform/languages/de",
    "/admin/demo/staff",
    // Wave 1 (1e, 1f): the team's roles, the activity logs, the legal pages and the accessibility page.
    "/admin/demo/staff/roles",
    "/admin/demo/activity",
    "/admin/demo/settings/legal",
    "/admin/demo/settings/accessibility",
    "/admin/platform/activity",
    "/admin/demo/website",
    "/admin/demo/settings",
    "/admin/demo/campaigns",
    "/admin/demo/campaigns/new",
    "/admin/demo/experiments",
    "/admin/demo/experiments/new",
    "/admin/demo/experiments/variants",
    "/admin/demo/fields",
    "/admin/demo/fields/new",
    "/admin/account",
    "/admin/platform/seo",
    "/admin/demo/discounts",
    "/admin/platform/discounts",
    "/admin/demo/pages",
    "/admin/demo/pages/new",
    "/admin/demo/pages/categories",
    "/admin/demo/articles",
    "/admin/demo/articles/new",
    "/admin/platform/articles",
    "/admin/platform/stores/demo",
    "/admin/demo/hosts",
    "/admin/hosting",
    "/admin/hosting/demo",
    "/admin/platform/ai/usage",
    "/admin/account/usage",
    // The three levels (D107).
    "/admin",
    "/admin/stores",
    "/admin/account/billing",
    "/admin/platform/requests",
    "/admin/platform/website",
    "/admin/platform/settings",
    "/admin/platform/experiments",
    "/admin/demo/customer-groups",
    "/admin/demo/companies",
    // Invoices and credit notes (D159): the list, its settings and a document's printable view.
    "/admin/demo/invoices",
    "/admin/demo/settings/invoices",
    "/admin/demo/invoices/11111111-1111-4111-8111-111111111111/print",
    "/admin/demo/invoices/credit-notes/11111111-1111-4111-8111-111111111111/print",
    // VAT, OSS and IOSS reports (D161).
    "/admin/demo/analytics/tax",
    "/admin/demo/analytics/tax?view=oss",
    "/admin/demo/analytics/tax?view=ioss",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page).toHaveURL("/admin/sign-in");
  }
});

test("the VAT report's CSV export gives nothing to a visitor without a session (D161)", async ({ request }) => {
  const fields = { kind: "vat", from: "2026-01-01", last: "2026-03-31" };
  const answer = await request.post("/admin/demo/analytics/tax/export", { form: fields, maxRedirects: 0 });
  expect(answer.status()).toBe(404);
  expect(answer.headers()["content-type"] ?? "").not.toContain("text/csv");
  expect(await answer.text()).not.toContain("country");
  // Reading it is no export either: the route answers only to a form.
  expect((await request.get("/admin/demo/analytics/tax/export", { maxRedirects: 0 })).status()).not.toBe(200);
});

test("admin pages send nothing of theirs to a visitor without a session, before the redirect", async ({ request }) => {
  // The redirect runs in the browser, so the response itself must hold none of
  // the page: every admin page's heading has this class, rendered or streamed.
  const paths = [
    "/admin/platform",
    "/admin/platform/customers",
    "/admin/platform/stores",
    "/admin/platform/stores/demo",
    // A route with parameters no build knows, served from a prerendered shell.
    "/admin/platform/stores/demo/invoices/00000000-0000-0000-0000-000000000000",
    "/admin/platform/plans",
    "/admin/platform/emails",
    "/admin/platform/plan-reminders",
    "/admin/platform/stripe",
    "/admin/platform/seo",
    "/admin/platform/ai/usage",
    "/admin/platform/experiments",
    "/admin/account/usage",
    "/admin/account/billing",
    "/admin/platform/requests",
    "/admin/stores",
    "/admin/demo/customer-groups",
    "/admin/demo/companies",
    "/admin/demo/customers",
    "/admin/demo/orders",
    "/admin/demo/wishlists",
    "/admin/demo/wishlists/activity",
    "/admin/demo/invoices",
    "/admin/demo/settings/invoices",
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

test("the AI manager answers only a signed-in owner or platform admin (D94, D103)", async ({ page, request }) => {
  const turn = await request.post("/admin/demo/assistant/turn", { data: { conversationId: null, message: "Hei" } });
  expect(turn.status()).toBe(404);
  const platform = await request.post("/admin/platform/assistant/turn", { data: { conversationId: null, message: "Hei" } });
  expect(platform.status()).toBe(404);
  // Voice mode's speech (D104) too.
  expect((await request.post("/admin/demo/assistant/speak", { data: { text: "Hei" } })).status()).toBe(404);
  expect((await request.post("/admin/platform/assistant/speak", { data: { text: "Hei" } })).status()).toBe(404);
  // Live voice calls (D105) too.
  for (const path of ["live", "live/delegate", "live/transcript"]) {
    expect((await request.post(`/admin/demo/assistant/${path}`, { data: {} })).status(), path).toBe(404);
    expect((await request.post(`/admin/platform/assistant/${path}`, { data: {} })).status(), path).toBe(404);
  }
  await page.goto("/admin/demo/assistant");
  await expect(page).toHaveURL("/admin/sign-in");
  await page.goto("/admin/platform/assistant");
  await expect(page).toHaveURL("/admin/sign-in");
});

test("an app asking to sign someone in with Kaizen Store sends them to sign in first, and back (D95)", async ({ page }) => {
  await page.goto("/admin/oauth/consent?authorization_id=abc12345xyz");
  await expect(page).toHaveURL(/\/admin\/sign-in\?next=%2Fadmin%2Foauth%2Fconsent%3Fauthorization_id%3Dabc12345xyz$/);
  // The way back is kept through the sign-in form.
  await expect(page.locator('input[type="hidden"][name="next"]').first()).toHaveValue("/admin/oauth/consent?authorization_id=abc12345xyz");
  // Kaizen Life's button shows only once it is set up.
  await expect(page.getByRole("button", { name: "Sign in with Kaizen Life" })).toHaveCount(0);
  await page.goto("/admin/oauth/consent");
  await expect(page.getByRole("heading", { name: "This sign-in could not be read" })).toBeVisible();
});

test("someone from Kaizen Life without a store asks for one with what Kaizen Life knows (D95)", async ({ page }) => {
  await page.goto("/sign-up?via=kaizen-life&email=kari%40example.com&name=Kari%20Nordmann");
  await expect(page.getByText("No Kaizen Store account uses kari@example.com yet.")).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Kari Nordmann");
  await expect(page.getByLabel("Email")).toHaveValue("kari@example.com");
  await page.goto("/sign-up");
  await expect(page.getByLabel("Email")).toHaveValue("");
});

test("the admin opens in the light or dark someone chose, before it is drawn (D99)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/admin/sign-in");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-color-mode", /./);
  await page.evaluate(() => localStorage.setItem("kaizen_admin_color_mode", "dark"));
  await page.reload();
  await expect(html).toHaveAttribute("data-color-mode", "dark");
  expect(await html.evaluate((el) => getComputedStyle(el).getPropertyValue("--background").trim())).toBe("#141927");
  // Dark by choice on a light device, and light by choice on a dark one.
  await page.evaluate(() => localStorage.setItem("kaizen_admin_color_mode", "light"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await html.evaluate((el) => getComputedStyle(el).getPropertyValue("--background").trim())).toMatch(/^#f{3}(f{3})?$/);
});
