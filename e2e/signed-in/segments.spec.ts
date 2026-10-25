import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The owner's Segments pages (wave 5 unit B, D296; row customers.customer-segments-and-tags). Who a
 * segment holds is held by segments.int.test.ts; this holds the screens: a ready segment chosen, its live count, saving it and its page.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-segments";
const RUN = Date.now().toString(36).toLowerCase();

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Segments') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Segments', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    await sql`delete from commerce.segments where store_id = ${store.id}`;
    await sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${store.id}, ${`nyhet-${RUN}@example.com`}, 'nb-NO', 'subscribed', 'form', 'Ja takk', now(), ${(RUN + "y".repeat(43)).slice(0, 43)})`;
  } finally {
    await sql.end();
  }
});

test("a ready segment is counted as it is chosen, saved, and opened with its people", async ({ page }) => {
  await page.goto(`/admin/${STORE}/segments/new`);
  await page.getByRole("button", { name: /People who want your emails/ }).click();
  await expect(page.getByLabel("Name")).toHaveValue("People who want your emails");
  await expect(page.getByRole("status").filter({ hasText: /want your emails\./ })).toContainText(/[1-9]\d* (person|people), [1-9]\d* of them want your emails/);
  await page.getByRole("button", { name: "Save segment" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/segments/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1, name: "People who want your emails" })).toBeVisible();
  await expect(page.getByRole("list", { name: "People" }).getByText(`nyhet-${RUN}@example.com`)).toBeVisible();

  await page.goto(`/admin/${STORE}/segments`);
  await expect(page.getByRole("list", { name: "Segments" }).getByRole("link", { name: "People who want your emails" })).toBeVisible();
});
