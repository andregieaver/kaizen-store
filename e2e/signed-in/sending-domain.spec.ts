import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * *Send from your own address* (D727, step M1.1 of the email plan) as the owner sees it on Settings, Notifications: one field with one
 * button, the records while it waits, the address once verified. Resend is not set up in the test build, so adding answers that in words;
 * the waiting and verified states are written to the database as the server would leave them.
 */

test.use({ storageState: OWNER.state });

const DOMAIN = "e2e-own-mail.no";
const RECORDS = [
  { purpose: "DKIM", type: "TXT", host: `resend._domainkey.${DOMAIN}`, value: "p=MIGfMA0GCSqGSIb3DQEB", status: "not_started" },
  { purpose: "SPF", type: "MX", host: `send.${DOMAIN}`, value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "not_started" },
  { purpose: "SPF", type: "TXT", host: `send.${DOMAIN}`, value: "v=spf1 include:amazonses.com ~all", status: "verified" },
];

async function setDomain(status: "pending" | "verified" | null) {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    await sql`delete from commerce.sending_domains where store_id = ${store.id}`;
    if (status) {
      await sql`
        insert into commerce.sending_domains (store_id, domain, from_local, provider_id, status, records, verified_at, checked_at)
        values (${store.id}, ${DOMAIN}, 'news', 'dom_e2e', ${status}, ${sql.json(RECORDS)}, ${status === "verified" ? sql`now()` : null}, now())`;
    }
  } finally {
    await sql.end();
  }
}

test.afterAll(async () => {
  await setDomain(null);
});

test("an owner sends from their own domain: one field, the records while waiting, the address once verified", async ({ page }) => {
  await setDomain(null);
  await page.goto(`/admin/${E2E_STORE}/settings/notifications`);
  const card = page.getByRole("region", { name: "Send from your own address" });
  await expect(card).toBeVisible();
  await card.getByLabel("Your domain").fill(DOMAIN);
  await card.getByRole("button", { name: "Use this domain" }).click();
  // No Resend in the test build: said plainly, and what was typed stays.
  await expect(card.getByText("Kaizena Flow's email isn't set up yet.")).toBeVisible();
  await expect(card.getByLabel("Your domain")).toHaveValue(DOMAIN);

  await setDomain("pending");
  await page.reload();
  const waiting = page.getByRole("region", { name: `Waiting for ${DOMAIN}` });
  await expect(waiting).toBeVisible();
  await expect(waiting.getByRole("cell", { name: "resend._domainkey", exact: true })).toBeVisible();
  await expect(waiting.getByRole("cell", { name: "send", exact: true })).toHaveCount(2);
  await expect(waiting.getByRole("button", { name: "Check now" })).toBeVisible();

  await setDomain("verified");
  await page.reload();
  const verified = page.getByRole("region", { name: `Your emails go from news@${DOMAIN}` });
  await expect(verified).toBeVisible();
  await expect(verified.getByRole("table")).toHaveCount(0);
  await expect(verified.getByRole("button", { name: "Check now" })).toHaveCount(0);
});
