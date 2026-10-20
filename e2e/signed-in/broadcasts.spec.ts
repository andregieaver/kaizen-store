import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The owner's Broadcasts pages (wave 5 unit C, D297; row customers.email-marketing-broadcasts-and-lifecycle-automations). Who gets a broadcast and
 * how often is held by broadcasts.int.test.ts; this holds the screens: writing one, saving it, a test to yourself, sending it and its report.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-broadcasts";
const RUN = Date.now().toString(36).toLowerCase();

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Broadcasts') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Broadcasts', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active' where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    await sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${store.id}, ${`nyhet-${RUN}@example.com`}, 'nb-NO', 'subscribed', 'form', 'Ja takk', now(), ${(RUN + "b".repeat(43)).slice(0, 43)})`;
  } finally {
    await sql.end();
  }
});

test("a broadcast is written, saved, tested and sent, and its page then says what happened", async ({ page }) => {
  await page.goto(`/admin/${STORE}/broadcasts/new`);
  await page.getByLabel("Name").fill(`Autumn ${RUN}`);
  await expect(page.getByRole("status").filter({ hasText: /who want your emails, as of now/ })).toContainText(/goes to [1-9]\d* (person|people)/);
  await page.getByLabel("Subject").fill("Høstnytt");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Nye ting i butikken.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/broadcasts/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Autumn ${RUN}` })).toBeVisible();

  await page.getByRole("button", { name: "Send a test to yourself" }).click();
  await expect(page.getByRole("status").filter({ hasText: "A test went to" })).toContainText(OWNER.email);

  await page.getByRole("button", { name: "Send now" }).click();
  await page.getByRole("button", { name: "Yes, send it" }).click();
  // The page becomes the send's report at once.
  await expect(page.getByText("Went to")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Went to")).toBeVisible();
  await expect(page.getByText("Presses on its links")).toBeVisible();

  await page.goto(`/admin/${STORE}/broadcasts`);
  await expect(page.getByRole("list", { name: "Broadcasts" }).getByRole("link", { name: `Autumn ${RUN}` })).toBeVisible();
});
