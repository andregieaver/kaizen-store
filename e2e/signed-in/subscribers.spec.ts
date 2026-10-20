import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The owner's Subscribers page (wave 5 unit A, D295; rows customers.signup-forms-and-popups-building-a-list and
 * storefront.signup-and-contact-forms-feeding-customers-and-consent). Joining and leaving the list are held by marketing-subscribers.int.test.ts;
 * this holds the screens: the counts, the list, one subscriber's consent and history, Unsubscribe and the owner's export.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-subscribers";
const RUN = Date.now().toString(36).toLowerCase();
const email = `kari-${RUN}@example.com`;
let id = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Subscribers') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Subscribers', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const token = (RUN + "x".repeat(43)).slice(0, 43);
    const [row] = await sql`
      insert into commerce.marketing_subscribers (store_id, email, name, locale, market_code, status, source, source_ref, consent_text, consented_at, token)
      values (${store.id}, ${email}, 'Kari Nordmann', 'nb-NO', 'NO', 'subscribed', 'form', 'news', 'Send meg nyheter og tilbud.', now(), ${token})
      returning id`;
    id = String(row.id);
  } finally {
    await sql.end();
  }
});

test("the page counts who wants the store's emails and lists them, newest first", async ({ page }) => {
  await page.goto(`/admin/${STORE}/subscribers`);
  await expect(page.getByRole("heading", { level: 1, name: "Subscribers" })).toBeVisible();
  await expect(page.getByText("Want your emails")).toBeVisible();
  const list = page.getByRole("list", { name: "Subscribers" });
  await expect(list.getByRole("link", { name: email })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search by email or name" }).fill(RUN);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
});

test("one subscriber shows the words they agreed to, and Unsubscribe ends it", async ({ page }) => {
  await page.goto(`/admin/${STORE}/subscribers/${id}`);
  await expect(page.getByText("Send meg nyheter og tilbud.")).toBeVisible();
  await expect(page.getByText("No: the form's confirmation was switched off")).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByText("Staff, for them", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Unsubscribe" })).toHaveCount(0);
});

test("the owner exports the list with its consent facts", async ({ page }) => {
  await page.goto(`/admin/${STORE}/subscribers`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^subscribers-e2e-subscribers-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  expect(text.split("\r\n")[0]).toContain("consent_text");
  expect(text).toContain(email);
});
