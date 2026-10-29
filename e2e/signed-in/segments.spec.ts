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
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Segments') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Segments', null)`;
    });
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

/**
 * Segments everywhere (wave 11 unit A, D380): a tag put on everyone the Customers list finds, a code limited to a segment in the code editor, and
 * the segment's page saying which code uses it and refusing to delete it while one does.
 */
test("a tag goes on everyone the list finds, a code is limited to a segment, and that segment is kept while the code uses it", async ({ page }) => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    await sql`insert into commerce.customers (store_id, email, name, locale) values (${store.id}, ${`bulk-${RUN}@example.com`}, ${`Bulk ${RUN}`}, 'nb-NO')`;
  } finally {
    await sql.end();
  }

  // Everyone the search finds gets the tag at once.
  await page.goto(`/admin/${STORE}/customers?q=${encodeURIComponent(`bulk-${RUN}`)}`);
  await page.getByRole("textbox", { name: "Tag", exact: true }).fill(`Messe ${RUN}`);
  await page.getByRole("button", { name: "Add the tag" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 person changed." })).toBeVisible();

  // A segment of the tag, and a code for its people.
  await page.goto(`/admin/${STORE}/segments/new`);
  await page.getByLabel("Name").fill(`Messe ${RUN}`);
  await page.getByRole("button", { name: "Save segment" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/segments/[0-9a-f-]{36}$`));
  const segmentUrl = page.url();

  await page.goto(`/admin/${STORE}/discounts/new`);
  const code = `MESSE${RUN}`.toUpperCase();
  await page.getByLabel(/^Code shoppers type/).fill(code);
  await page.getByRole("radio", { name: "People in a segment" }).check();
  await page.getByRole("combobox", { name: /^Segment/ }).selectOption({ label: `Messe ${RUN}` });
  await page.getByRole("button", { name: "Save code" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/discounts$`));

  // The segment's page names the code, and Delete is refused while it does.
  await page.goto(segmentUrl);
  await expect(page.getByText(`Codes: ${code}`)).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "cannot be deleted while a code or campaign is limited to it" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: `Messe ${RUN}` })).toBeVisible();
});
