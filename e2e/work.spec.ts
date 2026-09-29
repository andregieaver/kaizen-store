import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Work (D122): clients, hours and invoices in the store admin. The admin
 * cannot be signed into here, so this holds what can be seen from outside:
 * its pages are closed to visitors and send nothing of theirs, a new store
 * starts clean with its numbering ready, and the module's switch never
 * changes what a shopper sees. What the pages draw is tested on the server
 * (`work-pages.test.ts`, `work-settings.int.test.ts`).
 */

const WORK_PAGES = [
  "/admin/demo/work",
  "/admin/demo/work/clients",
  "/admin/demo/work/invoices",
  "/admin/demo/work/time",
  "/admin/demo/work/reports",
  "/admin/demo/settings/work",
  "/admin/demo/settings/features",
];

test("the Work pages are closed to visitors without a session", async ({ page, request }) => {
  for (const path of WORK_PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveURL("/admin/sign-in");
  }
  // The redirect runs in the browser, so the response itself must hold none of the page.
  for (const path of WORK_PAGES) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain("/admin/sign-in");
    expect(html, path).not.toContain("text-2xl font-semibold");
    expect(html, path).not.toContain("Unbilled time");
    expect(html, path).not.toContain("Coming in the next step");
  }
});

/** A new store, approved as the platform does. */
async function newStore(): Promise<{ slug: string; id: string }> {
  const slug = `work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Konsulent') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Konsulent', null) as id`;
    return { slug, id: String(id) };
  } finally {
    await sql.end();
  }
}

test("a new store starts clean: Work is off, nothing of Work is copied, its numbering is ready", async () => {
  const { id } = await newStore();
  const sql = testDb();
  try {
    const [store] = await sql`select modules from commerce.stores where id = ${id}`;
    expect(store.modules).not.toContain("work");
    for (const table of [
      "work_settings",
      "work_clients",
      "work_assignments",
      "work_tasks",
      "work_time_entries",
      "work_timers",
      "work_invoices",
      "work_invoice_lines",
      "work_invoice_payments",
      "work_credit_notes",
      "work_recurring_invoices",
      "work_events",
    ]) {
      const [count] = await sql`select count(*)::int as n from ${sql("commerce." + table)} where store_id = ${id}`;
      expect(count.n, table).toBe(0);
    }
    const series = await sql`
      select series, prefix, next_number::int as next from commerce.document_series
      where store_id = ${id} and series like 'work_%' order by series`;
    expect(series.map((s) => [s.series, s.prefix, s.next])).toEqual([
      ["work_credit_note", "WCN-", 1],
      ["work_invoice", "W-", 1],
    ]);
  } finally {
    await sql.end();
  }
});

test("switching Work on changes nothing a shopper sees, and its pages are not store pages", async ({ page }) => {
  const { slug, id } = await newStore();
  const shop = async () => {
    await page.goto(`/s/${slug}/no`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    return {
      heading: await page.getByRole("heading", { level: 1 }).first().innerText(),
      links: await page.locator("header a, footer a").evaluateAll((els) => els.map((el) => el.textContent?.trim())),
    };
  };
  const before = await shop();
  const sql = testDb();
  try {
    await sql`update commerce.stores set modules = array_append(modules, 'work') where id = ${id}`;
  } finally {
    await sql.end();
  }
  // The catalogue's cached reads are per store and tag; a page read fresh shows the same shop.
  const after = await shop();
  expect(after.heading).toBe(before.heading);
  expect(after.links).toEqual(before.links);
  expect(after.links.join(" ").toLowerCase()).not.toContain("work");
  for (const path of ["work", "clients", "invoices"]) {
    const response = await page.goto(`/s/${slug}/no/${path}`);
    expect(response?.status(), path).toBe(404);
  }
});
