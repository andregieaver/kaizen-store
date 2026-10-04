import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { testDb } from "./db";

/**
 * Your data (wave 1, 1g, D162): a shopper downloads what the shop holds about them and deletes their account, from My account, with a fresh
 * sign-in. The page is in Norwegian (`/s/demo/no`). The order the shopper bought is kept by the bookkeeping rules: cut loose from them,
 * never relinked.
 */

/** The latest code emailed to an address (emails are recorded when Resend is not set up). */
async function latestCode(email: string): Promise<string> {
  const db = testDb();
  try {
    for (let i = 0; i < 20; i++) {
      const [row] = await db`
        select text from commerce.email_messages
        where kind = 'account.code' and to_address = ${email} order by created_at desc limit 1`;
      const code = row ? /\b(\d{6})\b/.exec(String(row.text))?.[1] : undefined;
      if (code) return code;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    await db.end();
  }
  throw new Error("no code was emailed");
}

async function signInWithCode(page: Page, email: string) {
  await page.goto("/s/demo/no/account");
  await page.getByLabel("E-post").fill(email);
  await page.getByRole("button", { name: "Send kode" }).click();
  await expect(page.getByText(`Vi har sendt en kode til ${email}`)).toBeVisible();
  await page.getByLabel("Kode").fill(await latestCode(email));
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByText(`Logget inn som ${email}`)).toBeVisible();
}

/** Makes this shopper's session older than the ten minutes a download or a deletion allows. */
async function makeSessionStale(email: string) {
  const db = testDb();
  try {
    await db`
      update commerce.customer_sessions set verified_at = now() - interval '1 hour'
      where customer_id in (select id from commerce.customers where lower(email) = ${email})`;
  } finally {
    await db.end();
  }
}

async function confirmItIsYou(page: Page, email: string) {
  await expect(page.getByRole("heading", { name: "Bekreft at det er deg" })).toBeVisible();
  await page.getByRole("button", { name: "Send meg en kode" }).click();
  await expect(page.getByText("Vi har sendt en kode til e-postadressen du er registrert med.")).toBeVisible();
  // The step moves focus to the code field.
  await expect(page.getByLabel("Kode")).toBeFocused();
  await page.getByLabel("Kode").fill(await latestCode(email));
  await page.getByRole("button", { name: "Bekreft", exact: true }).click();
}

test("a shopper downloads their data, confirms it is them when the session is old, and deletes the account", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `data-${Date.now().toString(36)}@example.com`;
  const number = `E2E-${Date.now().toString(36).toUpperCase()}`;
  const db = testDb();
  try {
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
        subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
      select id, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', 19900, 0, 3980, 19900, '{}', '{}'
      from commerce.stores where slug = 'demo' returning id, store_id`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${order.store_id}, ${order.id}, 'stripe', ${`cs_${number}`}, 19900, 'NOK', 'captured')`;
  } finally {
    await db.end();
  }

  // A fresh sign-in: My account offers Your data, and the page offers the download.
  await signInWithCode(page, email);
  await expect(page.getByText(`Ordre ${number}`)).toBeVisible();
  await page.getByRole("link", { name: /Dine data/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dine data" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Last ned dataene mine" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^demo-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync((await file.path()) as string, "utf8"));
  expect(data.schema).toBe("kaizen.customer-export");
  expect(data.subject.email).toBe(email);
  expect(JSON.stringify(data.sections.orders)).toContain(number);
  expect(data.counts.orders).toBe(1);
  // Never a secret: no password hash, no token.
  expect(JSON.stringify(data)).not.toMatch(/password_hash|token_hash|passwordHash/);

  // An older session gets nothing until the shopper confirms it is them.
  await makeSessionStale(email);
  await page.goto("/s/demo/no/account/privacy");
  await expect(page.getByRole("button", { name: "Last ned dataene mine" })).toHaveCount(0);
  await confirmItIsYou(page, email);
  await expect(page.getByRole("button", { name: "Last ned dataene mine" })).toBeVisible();

  // Deleting: the page says what stays and until when, then one button.
  await page.getByRole("link", { name: "Gå videre til sletting" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Slett kontoen din" })).toBeVisible();
  await expect(page.getByText("Dette beholdes")).toBeVisible();
  await expect(page.getByText(/1 bestilling beholdes av butikken til 1\. januar 20\d\d, fordi bokføringsloven krever det/)).toBeVisible();
  await expect(page.getByText("Dette kan ikke angres.")).toBeVisible();
  await page.getByRole("button", { name: "Slett kontoen min" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Kontoen din er slettet" })).toBeVisible();
  await expect(page.getByText(/Én bestilling beholdes til 1\. januar 20\d\d på grunn av bokføringsloven/)).toBeVisible();
  // The address carries counts and a day, never a name, an email or an address.
  expect(page.url()).not.toContain("example.com");

  // Signed out; the account is gone; the order the law keeps is cut loose from the person.
  await page.goto("/s/demo/no/account");
  await expect(page.getByRole("heading", { level: 1, name: "Min konto" })).toBeVisible();
  const check = testDb();
  try {
    const customers = await check`select id from commerce.customers where lower(email) = ${email}`;
    expect(customers).toHaveLength(0);
    const [kept] = await check`select customer_id, restricted_at, anonymised_at, email from commerce.orders where number = ${number}`;
    expect(kept.customer_id).toBeNull();
    expect(kept.restricted_at).not.toBeNull();
    expect(kept.anonymised_at).toBeNull();
  } finally {
    await check.end();
  }

  // Coming back with the same address starts empty: the kept order is not relinked.
  await signInWithCode(page, email);
  await expect(page.getByText("Du har ingen bestillinger ennå.")).toBeVisible();
  await expect(page.getByText(`Ordre ${number}`)).toHaveCount(0);
});

test("a signed-out visitor to Your data is sent to My account, and a download from another site is refused", async ({ page, request }) => {
  await page.goto("/s/demo/no/account/privacy");
  await expect(page).toHaveURL(/\/s\/demo\/no\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Min konto" })).toBeVisible();

  const refused = await request.post("/s/demo/no/account/privacy/export", { headers: { origin: "https://evil.example" }, maxRedirects: 0 });
  expect(refused.status()).toBe(403);
  const signedOut = await request.post("/s/demo/no/account/privacy/export", { maxRedirects: 0 });
  expect(signedOut.status()).toBe(303);
  expect(signedOut.headers()["content-disposition"]).toBeUndefined();
  expect(signedOut.headers()["cache-control"]).toBe("no-store");
});

test("the delete page's result is not for search engines", async ({ page }) => {
  await page.goto("/s/demo/no/account/privacy/confirm?done=1&kept=0&until=&mail=0");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("the delete page's result in Swedish and English says the same things in the shopper's own words", async ({ page }) => {
  await page.goto("/s/demo/se/account/privacy/confirm?done=1&kept=2&until=2033-01-01&mail=1");
  await expect(page.getByRole("heading", { level: 1, name: "Ditt konto är raderat" })).toBeVisible();
  await expect(page.getByText(/2 beställningar sparas till 1 januari 2033 på grund av bokföringslagen/)).toBeVisible();
  await page.goto("/s/demo/no-en/account/privacy/confirm?done=1&kept=1&until=2033-01-01&mail=0");
  await expect(page.getByRole("heading", { level: 1, name: "Your account is deleted" })).toBeVisible();
  await expect(page.getByText("One order is kept until 1 January 2033 because of bookkeeping law, with no link to you.")).toBeVisible();
  await expect(page.getByText("We have sent you a confirmation")).toHaveCount(0);
});
