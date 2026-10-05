import { expect, test } from "@playwright/test";

/**
 * The CSV of an analytics table (wave 2, D165, docs/wave-2-data.md 2.8): a visitor without a session gets no file, and no sign that a table exists. Signing in to
 * an admin needs Supabase's own sign-in, which the end-to-end tests have no fixture for (the signed-in admin is checked by hand, D158), so what the signed-in member
 * gets (the page's own rows, the previous-period columns, the left-out currency, the formula escape, the roles) is held by `src/server/analytics-export.int.test.ts`,
 * which calls the functions the route calls, and by the view tests of the button. What this spec holds is that the route answers only to a member, only to a POST
 * from the admin itself, and never with a file to anyone else.
 */

const TABLES = ["products.table", "overview.net_revenue", "customers.top", "settings.targets", "tax.vat", "nope"];

test("the analytics export route answers no file to a visitor without a session, whatever the table", async ({ request }) => {
  for (const table of TABLES) {
    const answer = await request.post("/admin/demo/analytics/export", { form: { table, query: "period=7d&compare=previous" }, maxRedirects: 0 });
    expect(answer.status(), table).toBe(404);
    expect(answer.headers()["content-type"] ?? "", table).not.toContain("text/csv");
    expect(await answer.text(), table).not.toMatch(/period_from|net_revenue/);
  }
});

test("reading the route is no export: a link or a crawler gets nothing", async ({ request }) => {
  const answer = await request.get("/admin/demo/analytics/export?table=products.table", { maxRedirects: 0 });
  expect(answer.status()).not.toBe(200);
  expect(answer.headers()["content-type"] ?? "").not.toContain("text/csv");
});

test("a request from another site is refused, and the analytics pages send a visitor to sign in", async ({ page, request }) => {
  const foreign = await request.post("/admin/demo/analytics/export", { form: { table: "products.table" }, headers: { origin: "https://evil.example" }, maxRedirects: 0 });
  expect([403, 404]).toContain(foreign.status());
  for (const path of ["/admin/demo/analytics", "/admin/demo/analytics/products", "/admin/demo/analytics/traffic?period=7d&compare=none"]) {
    await page.goto(path);
    await expect(page).toHaveURL("/admin/sign-in");
  }
});
