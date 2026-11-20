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
const shots = process.env.FORMS_SHOTS;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Subscribers') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Subscribers', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const token = (RUN + "x".repeat(43)).slice(0, 43);
    const [row] = await sql`
      insert into commerce.marketing_subscribers (store_id, email, name, locale, market_code, status, source, source_ref, consent_text, consented_at, token)
      values (${store.id}, ${email}, 'Kari Nordmann', 'nb-NO', 'NO', 'subscribed', 'form', 'news', 'Send meg nyheter og tilbud.', now(), ${token})
      returning id`;
    id = String(row.id);
    // Two sign-ups by one of the store's forms, on two pages (D850).
    const [form] = await sql`insert into commerce.forms (store_id, kind, name, signup) values (${store.id}, 'signup', ${`E2E Winter list ${RUN}`}, '{}') returning id`;
    for (const [who, path] of [["ola", "/blog/vinter"], ["eva", "/kampanje"]] as const) {
      await sql`
        insert into commerce.marketing_subscribers (store_id, email, locale, status, source, source_ref, source_path, consent_text, consented_at, token)
        values (${store.id}, ${`${who}-${RUN}@example.com`}, 'nb-NO', 'subscribed', 'form', ${String(form.id)}, ${path}, 'Send meg nyheter.', now(), ${(who + RUN + "y".repeat(43)).slice(0, 43)})`;
    }
  } finally {
    await sql.end();
  }
});

test("the page counts who wants the store's emails and lists them, newest first", async ({ page }) => {
  await page.goto(`/admin/${STORE}/subscribers`);
  await expect(page.getByRole("heading", { level: 1, name: "Subscribers" })).toBeVisible();
  await expect(page.getByText("Want your emails", { exact: true })).toBeVisible();
  const list = page.getByRole("list", { name: "Subscribers" });
  await expect(list.getByRole("link", { name: email })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search by email or name" }).fill(`kari-${RUN}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
});

test("each sign-up says its form and page, and the list narrows to either (D850)", async ({ page }) => {
  await page.goto(`/admin/${STORE}/subscribers`);
  const list = page.getByRole("list", { name: "Subscribers" });
  const ola = list.getByRole("listitem").filter({ hasText: `ola-${RUN}@example.com` });
  await expect(ola).toContainText(`E2E Winter list ${RUN} · /blog/vinter`);
  if (shots) await page.screenshot({ path: `${shots}/20-subscribers-sources.png`, fullPage: true });
  await page.locator("[data-subscriber-form-filter]").selectOption({ label: `E2E Winter list ${RUN} (2)` });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.locator("[data-subscriber-page-filter]").selectOption("/kampanje");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText(`eva-${RUN}@example.com`);
  // One subscriber names the form, which opens in its editor, and the page.
  await list.getByRole("link", { name: `eva-${RUN}@example.com` }).click();
  await expect(page.locator("[data-subscriber-form]")).toContainText(`E2E Winter list ${RUN}`);
  await expect(page.locator("[data-subscriber-page]")).toHaveText("/kampanje");
  if (shots) await page.screenshot({ path: `${shots}/21-subscriber-source.png`, fullPage: true });
});

test("one subscriber shows the words they agreed to, and Unsubscribe ends it", async ({ page }) => {
  await page.goto(`/admin/${STORE}/subscribers/${id}`);
  await expect(page.getByText("Send meg nyheter og tilbud.", { exact: true })).toBeVisible();
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
