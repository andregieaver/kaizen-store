import { expect, test } from "@playwright/test";

/**
 * The redirect manager's admin (wave 2, second run, D168, docs/wave-2-redirects.md 2.2, 2.3, 5.4): its pages and the routes behind them give a visitor without
 * a session nothing. Signing in to an admin needs Supabase's own sign-in, which the end-to-end tests have no fixture for (the admin signed in is checked by
 * hand, D158), so the signed-in paths (adding, editing and deleting a redirect, a file checked and imported, a missing address redirected in one click) are
 * held by the view tests (`src/components/admin/redirects/redirect-views.test.ts`) and the integration tests of `src/server` (`redirects.int.test.ts`,
 * `redirect-import.int.test.ts`, `not-found.int.test.ts`), which call the same functions the pages call. What this spec holds is that none of it is reachable,
 * or answers with a file, without a member. The serving side is held end to end by `redirects.spec.ts`.
 */

const JOB = "11111111-1111-4111-8111-111111111111";

test("the redirect pages send a visitor without a session to sign in", async ({ page }) => {
  const paths = [
    "/admin/demo/redirects",
    "/admin/demo/redirects?q=shoes&filter=manual&page=2",
    "/admin/demo/redirects/404s",
    "/admin/demo/redirects/404s?days=7&covered=1",
    "/admin/demo/redirects/import",
    `/admin/demo/redirects/import/${JOB}`,
    "/admin/demo/redirects/export",
    `/admin/demo/redirects/export?job=${JOB}`,
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page).toHaveURL("/admin/sign-in");
  }
});

test("the redirect file and the report's file are not served to a visitor without a session", async ({ request }) => {
  for (const route of ["/admin/demo/redirects/export/file", "/admin/demo/redirects/404s/export"]) {
    const answer = await request.post(route, { form: { scope: "all", dialect: "standard", days: "90" }, maxRedirects: 0 });
    expect(answer.status()).toBe(404);
    expect(answer.headers()["content-type"] ?? "").not.toContain("text/csv");
    // Reading is no export either: the routes answer only to a form.
    expect((await request.get(route, { maxRedirects: 0 })).status()).not.toBe(200);
  }
});

test("a download of a redirect job's file is refused without a session, and makes no signed address", async ({ request }) => {
  const answer = await request.post("/admin/demo/redirects/export/file", { form: { intent: "download", job: JOB, part: "0" }, maxRedirects: 0 });
  expect(answer.status()).toBe(404);
  expect(answer.headers().location ?? "").toBe("");
});

test("the steps of a redirect import and its problems file are refused without a session", async ({ request }) => {
  const routes = [`/admin/demo/redirects/import/${JOB}/tick`, `/admin/demo/redirects/import/${JOB}/problems`, `/admin/demo/redirects/export/${JOB}/tick`];
  for (const route of routes) {
    const answer = await request.post(route, { maxRedirects: 0 });
    expect(answer.status()).toBe(404);
    expect(answer.headers()["content-type"] ?? "").not.toContain("text/csv");
    expect(answer.headers()["content-type"] ?? "").not.toContain("application/json");
  }
});
