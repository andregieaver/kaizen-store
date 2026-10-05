import { expect, test } from "@playwright/test";

/**
 * Data in and out (wave 2, D165, docs/wave-2-data.md): the admin's new pages and the routes behind them give a visitor without a session nothing.
 * Signing in to an admin needs Supabase's own sign-in, which the end-to-end tests have no fixture for (the admin signed in is checked by hand, D158),
 * so the signed-in paths (a small export downloaded, a bulk price change confirmed, an import checked) are held by the view tests
 * (`src/components/admin/data/data-views.test.ts`, `bulk-views.test.ts`) and the integration tests of `src/server`, which call the same functions the
 * pages call. What this spec holds is that none of it is reachable, or answers with a file, without a member.
 */

const JOB = "11111111-1111-4111-8111-111111111111";

test("the data pages send a visitor without a session to sign in", async ({ page }) => {
  const paths = [
    "/admin/demo/products/export",
    "/admin/demo/products/import",
    `/admin/demo/products/import/${JOB}`,
    "/admin/demo/products/bulk",
    "/admin/demo/products/bulk?ids=" + JOB,
    "/admin/demo/orders/export",
    "/admin/demo/orders/export?numbers=1001",
    `/admin/demo/orders/export?job=${JOB}`,
    "/admin/demo/customers/export",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page).toHaveURL("/admin/sign-in");
  }
});

test("the export routes answer no file, and no sign of a job, to a visitor without a session", async ({ request }) => {
  const routes = ["/admin/demo/products/export/file", "/admin/demo/orders/export/file", "/admin/demo/customers/export/file"];
  for (const route of routes) {
    const answer = await request.post(route, { form: { dialect: "standard", mode: "range", from: "2026-01-01", to: "2026-12-31" }, maxRedirects: 0 });
    expect(answer.status()).toBe(404);
    expect(answer.headers()["content-type"] ?? "").not.toContain("text/csv");
    // Reading is no export either: the routes answer only to a form.
    expect((await request.get(route, { maxRedirects: 0 })).status()).not.toBe(200);
  }
});

test("a download of a job's file is refused without a session, and makes no signed address", async ({ request }) => {
  for (const route of ["/admin/demo/orders/export/file", "/admin/demo/customers/export/file", "/admin/demo/products/export/file"]) {
    const answer = await request.post(route, { form: { intent: "download", job: JOB, part: "0" }, maxRedirects: 0 });
    expect(answer.status()).toBe(404);
    expect(answer.headers().location ?? "").toBe("");
  }
});

test("the steps of a job page and the import's problems file are refused without a session", async ({ request }) => {
  const routes = [
    `/admin/demo/products/import/${JOB}/tick`,
    `/admin/demo/products/import/${JOB}/problems`,
    `/admin/demo/products/export/${JOB}/tick`,
    `/admin/demo/orders/export/${JOB}/tick`,
    `/admin/demo/customers/export/${JOB}/tick`,
  ];
  for (const route of routes) {
    const answer = await request.post(route, { maxRedirects: 0 });
    expect(answer.status()).toBe(404);
    expect(await answer.text()).not.toContain("status");
  }
});
