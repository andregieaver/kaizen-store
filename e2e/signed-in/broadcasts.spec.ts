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
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Broadcasts') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Broadcasts', null)`;
    });
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
  // The page becomes the send's report at once. Exact, or the test's "A test went to …" above would match before the send is saved.
  await expect(page.getByText("Went to", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Went to", { exact: true })).toBeVisible();
  await expect(page.getByText("Presses on its links")).toBeVisible();

  await page.goto(`/admin/${STORE}/broadcasts`);
  await expect(page.getByRole("list", { name: "Broadcasts" }).getByRole("link", { name: `Autumn ${RUN}` })).toBeVisible();
});

test("a sent broadcast's report says how many people on the list pressed each link and the orders after it (M1.3 and M1.4, D754, D761)", async ({ page }) => {
  const sql = testDb();
  let id = "";
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const content = { "nb-NO": { subject: "Vinter", preview: "", blocks: [{ type: "button", text: "Se vinteren", url: "/products" }] } };
    const [made] = await sql`
      insert into commerce.broadcasts (store_id, title, audience, content) values (${store.id}, ${`Winter ${RUN}`}, 'everyone', ${sql.json(content)}) returning id`;
    id = String(made.id);
    const people: string[] = [];
    for (const who of ["ola", "kari"]) {
      const [s] = await sql`
        insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
        values (${store.id}, ${`${who}-${RUN}@example.com`}, 'nb-NO', 'subscribed', 'form', 'Ja takk', now(), ${(who + RUN + "c".repeat(43)).slice(0, 43)}) returning id`;
      people.push(String(s.id));
    }
    // A broadcast moves draft → sending → sent, and its recipients start queued while it sends, as the tables' rules allow. It went two days ago.
    await sql`update commerce.broadcasts set status = 'sending', started_at = now() - interval '2 days', recipient_count = 2 where id = ${id}`;
    for (const [i, who] of ["ola", "kari"].entries()) {
      await sql`insert into commerce.broadcast_recipients (store_id, broadcast_id, subscriber_id, email, locale, market_code)
        values (${store.id}, ${id}, ${people[i]}, ${`${who}-${RUN}@example.com`}, 'nb-NO', 'NO')`;
      await sql`update commerce.broadcast_recipients set status = 'sent', sent_at = now() - interval '2 days' where broadcast_id = ${id} and subscriber_id = ${people[i]}`;
    }
    await sql`update commerce.broadcasts set status = 'sent', finished_at = now() - interval '2 days' where id = ${id}`;
    // Five presses, three of them by the two people on the list (Ola twice), two by mail apps that check links.
    await sql`insert into commerce.broadcast_link_clicks (store_id, broadcast_id, link, clicks) values (${store.id}, ${id}, 'nb-NO.0', 5)`;
    for (const subscriber of [people[0], people[0], people[1]]) {
      await sql`insert into commerce.email_clicks (store_id, subscriber_id, broadcast_id, link) values (${store.id}, ${subscriber}, ${id}, 'nb-NO.0')`;
    }
    // Kari paid for an order a day after the email: it counts for this broadcast.
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
        total_minor, billing_address, shipping_address, placed_at)
      values (${store.id}, ${`W${RUN}`}, 'NO', 'NOK', 'nb-NO', ${`kari-${RUN}@example.com`}, 'paid', 49900, 0, 0, 9980, 49900, '{}'::jsonb, '{"name":"Kari"}'::jsonb,
        now() - interval '1 day')
      returning id`;
    await sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${`cs_w${RUN}`}, 49900, 'NOK', 'captured')`;
  } finally {
    await sql.end();
  }
  await page.goto(`/admin/${STORE}/broadcasts/${id}`);
  await expect(page.getByText("People on your list who pressed a link: 2")).toBeVisible();
  const row = page.getByRole("row", { name: /Se vinteren/ });
  await expect(row.getByRole("cell").nth(2)).toHaveText("5");
  await expect(row.getByRole("cell").nth(3)).toHaveText("2");
  await expect(page.getByText("Orders after it")).toBeVisible();
  await expect(page.getByText(/499[.,]00.*placed within a week of its email/)).toBeVisible();
  await page.screenshot({ path: "test-results/broadcast-report.png", fullPage: true });

  // Analytics → Marketing: the same order, under Broadcasts.
  await page.goto(`/admin/${STORE}/analytics/marketing`);
  const card = page.locator("[data-message-orders]");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText(/Broadcasts\s*[1-9]\d* orders?/);
  await card.screenshot({ path: "test-results/marketing-messages.png" });
});
