import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** The latest code emailed to an address (emails are recorded when Resend is not set up). */
async function latestCode(email: string, kind = "account.code"): Promise<string> {
  const db = testDb();
  try {
    for (let i = 0; i < 20; i++) {
      const [row] = await db`
        select text from commerce.email_messages
        where kind = ${kind} and to_address = ${email} order by created_at desc limit 1`;
      const code = row ? /\b(\d{6})\b/.exec(String(row.text))?.[1] : undefined;
      if (code) return code;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    await db.end();
  }
  throw new Error("no code was emailed");
}

test("a shopper signs in with an emailed code, keeps their details and signs out", async ({ page }) => {
  const email = `kunde-${Date.now().toString(36)}@example.com`;
  await page.goto("/s/demo/no");
  await page.getByRole("link", { name: "Min konto" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Min konto" })).toBeVisible();

  await page.getByLabel("E-post").fill(email);
  await page.getByRole("button", { name: "Send kode" }).click();
  await expect(page.getByText(`Vi har sendt en kode til ${email}`)).toBeVisible();

  await page.getByLabel("Kode").fill("000000");
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByText("Koden stemmer ikke eller er utløpt.")).toBeVisible();

  await page.getByLabel("Kode").fill(await latestCode(email));
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hei!" })).toBeVisible();
  await expect(page.getByText(`Logget inn som ${email}`)).toBeVisible();
  await expect(page.getByText("Du har ingen bestillinger ennå.")).toBeVisible();

  await page.getByLabel("Navn").fill("Kari Nordmann");
  await page.getByLabel("Postnummer").fill("0155");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page.getByText("Lagret.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Hei, Kari!" })).toBeVisible();

  await page.getByRole("button", { name: "Logg ut" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Min konto" })).toBeVisible();
});

test("the password sign-in says nothing about which addresses have accounts", async ({ page }) => {
  await page.goto("/s/demo/no/account");
  await page.getByRole("button", { name: "Logg inn med passord" }).click();
  await page.getByLabel("E-post").fill("ingen-her@example.com");
  await page.getByLabel("Passord").fill("et helt feil passord");
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByText("E-post eller passord stemmer ikke.")).toBeVisible();
});

test("a shopper creates an account with a password and is signed in at once", async ({ page }) => {
  const email = `ny-${Date.now().toString(36)}@example.com`;
  await page.goto("/s/demo/no/account");
  await page.getByRole("tab", { name: "Opprett konto" }).click();
  await expect(page.getByRole("tab", { name: "Opprett konto" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Navn").fill("Nora Ny");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord").fill("kort");
  await page.getByRole("button", { name: "Opprett konto" }).click();
  // Too short: the browser asks for more before anything is sent.
  await expect(page.getByLabel("Passord")).toHaveJSProperty("validity.tooShort", true);

  await page.getByLabel("Passord").fill("blå fjord seiler stille");
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hei, Nora!" })).toBeVisible();

  await page.getByRole("button", { name: "Logg ut" }).click();
  await page.getByRole("button", { name: "Logg inn med passord" }).click();
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord").fill("blå fjord seiler stille");
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hei, Nora!" })).toBeVisible();
});

test("an email that has shopped before chooses a new password, and sees its orders", async ({ page }) => {
  const email = `tidligere-${Date.now().toString(36)}@example.com`;
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

  await page.goto("/s/demo/no/account?tab=register");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord").fill("blå fjord seiler stille");
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByText("Du har handlet her før med denne e-posten.")).toBeVisible();

  await page.getByRole("button", { name: "Send kode" }).click();
  await expect(page.getByText(`Vi har sendt en kode til ${email}`)).toBeVisible();
  await page.getByLabel("Kode").fill(await latestCode(email, "account.reset"));
  await page.getByLabel("Nytt passord").fill("grønn elg danser sakte");
  await page.getByRole("button", { name: "Lagre og logg inn" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hei!" })).toBeVisible();
  await expect(page.getByText(`Ordre ${number}`)).toBeVisible();
});
