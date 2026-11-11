import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * SMS marketing as the owner uses it (D565): connecting is asked first; with an account, the store's text messages, who gets them and the
 * account's rules; a new text message shows what each reader gets and how many texts it takes as it is written; staff stop a number. 46elks
 * is never called: the account is a row whose password cannot be read here, so pricing says to connect again. The rules behind it are held by
 * sms.int.test.ts against a stand-in for 46elks.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const page = `/admin/${E2E_STORE}/text-messages`;
let storeId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    await sql`delete from commerce.sms_campaigns where store_id = ${storeId}`;
    await sql`delete from commerce.sms_subscribers where store_id = ${storeId}`;
    await sql`delete from commerce.sms_settings where store_id = ${storeId}`;
  } finally {
    await sql.end();
  }
});

test("asks the owner to connect a 46elks account first", async ({ page: p }) => {
  await p.goto(page);
  await expect(p.getByRole("heading", { level: 1, name: "Text messages" })).toBeVisible();
  const form = p.getByRole("form", { name: "Connect a 46elks account" });
  await expect(form.getByLabel("API username")).toBeVisible();
  await expect(form.getByLabel("API password")).toHaveAttribute("type", "password");
  await expect(form.getByLabel("Sender name")).toHaveAttribute("maxlength", "11");
});

test("shows the store's text messages, who gets them and the rules, and staff stop a number", async ({ page: p }) => {
  const sql = testDb();
  try {
    await sql`
      insert into commerce.sms_settings (store_id, api_username, api_password_encrypted, currency, sender, inbound_key, monthly_cap_units)
      values (${storeId}, 'u_e2e', 'v2.unreadable', 'SEK', 'E2EShop', ${"k".repeat(43)}, 5000000)`;
    const numbers = [
      ["+4791234567", "subscribed", "kari@example.com"],
      ["+46701234567", "subscribed", null],
      ["+4790000777", "pending", null],
    ] as const;
    for (const [phone, status, email] of numbers) {
      await sql`
        insert into commerce.sms_subscribers (store_id, phone, country, email, locale, market_code, status, source, consent_text, consented_at, token)
        values (${storeId}, ${phone}, ${phone.startsWith("+46") ? "SE" : "NO"}, ${email}, 'nb-NO', 'NO', ${status}, 'checkout', 'Send meg tilbud på SMS.', now(),
                ${`${phone.replace("+", "t")}`.padEnd(22, "x").slice(0, 22)})`;
    }
    const [campaign] = await sql`
      insert into commerce.sms_campaigns (store_id, title, text, status, started_at, finished_at, estimate_units)
      values (${storeId}, 'Black Friday', '20 % på alt i dag.', 'sent', now() - interval '1 day', now() - interval '1 day', 8500) returning id`;
    const subscribers = await sql`select id from commerce.sms_subscribers where store_id = ${storeId} and status = 'subscribed'`;
    for (const [i, s] of subscribers.entries()) {
      await sql`
        insert into commerce.sms_messages (store_id, campaign_id, subscriber_id, status, send_after, provider_id, cost_units, parts, sent_at)
        values (${storeId}, ${campaign.id}, ${s.id}, ${i === 0 ? "delivered" : "sent"}, now() - interval '1 day', ${`se2e${i}`}, ${i === 0 ? 5000 : 3500}, 1, now() - interval '1 day')`;
    }
  } finally {
    await sql.end();
  }

  await p.goto(page);
  await expect(p.getByRole("link", { name: "Black Friday" })).toBeVisible();
  await expect(p.getByText("2 numbers get your texts · 1 waits for its order to be paid")).toBeVisible();
  await expect(p.getByText("+47 ••• 567")).toBeVisible();
  // The rules are the owner's: sender, the hours (never the night), the cap.
  const rules = p.getByRole("form", { name: "Account and rules" });
  await expect(rules.getByLabel("Sender name")).toHaveValue("E2EShop");
  await expect(rules.getByLabel("The most a month's texts may cost (SEK)")).toHaveValue("500");

  await p.getByRole("link", { name: "Black Friday" }).click();
  await expect(p.locator("[data-sms-counts]")).toContainText("Delivered");
  await expect(p.getByText("Cost: 0.85 SEK").first()).toBeVisible();
  await p.goBack();

  const row = p.getByRole("listitem").filter({ hasText: "+47 ••• 567" });
  await row.getByRole("button", { name: "Stop texts to this number" }).click();
  await expect(p.getByRole("listitem").filter({ hasText: "+47 ••• 567" })).toContainText("Stopped");
});

test("writes a text message with what each reader gets, and asks to connect again to price it", async ({ page: p }) => {
  await p.goto(`${page}/new`);
  // Typed once the page's scripts hold the form: a field filled before then is reset.
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Name (only you see it)").fill("Weekend offer");
  await p.locator("#sms-text").fill("20 % på alt hele helgen. Bruk koden HELG i kassen.");
  await expect(p.locator("[data-sms-preview]")).toContainText("20 % på alt hele helgen.");
  await expect(p.locator("[data-sms-preview]")).toContainText("Avmeld: https://kaizenaflow.com/sms/");
  await expect(p.getByText("1 text")).toBeVisible();
  await p.locator("#sms-text").fill("x".repeat(200));
  await expect(p.getByText("2 texts each")).toBeVisible();
  await p.locator("#sms-text").fill("20 % på alt hele helgen. Bruk koden HELG i kassen.");
  await p.getByRole("button", { name: "Save draft" }).click();
  await p.waitForURL(/\/text-messages\/[0-9a-f-]{36}$/);
  await p.getByRole("button", { name: "See the price" }).click();
  await expect(p.getByText("Connect the 46elks account again.")).toBeVisible();
});
