import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
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
  // My account opens on its overview (D480); each tab's content is in the page, the open one alone shown.
  await expect(page.getByRole("tab", { name: "Oversikt" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").getByText("Du har ingen bestillinger ennå.")).toBeVisible();

  // The details are under Profile, which opens at once and puts itself in the address, so a reload keeps it.
  // Pressed before the page has woken up, a tab is a plain link and the page loads again: while it streams in, its parts wait hidden
  // in the document, so the fields are found in the open tab alone.
  const profile = page.getByRole("tabpanel", { name: "Profil" });
  await page.getByRole("tab", { name: "Profil" }).click();
  await expect(page).toHaveURL(/\/account\?tab=profile$/);
  await expect(profile).toBeVisible();
  await profile.getByLabel("Navn").fill("Kari Nordmann");
  await profile.getByLabel("Postnummer").fill("0155");
  await profile.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page.getByText("Lagret.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Hei, Kari!" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Profil" })).toHaveAttribute("aria-selected", "true");
  await expect(profile.getByLabel("Navn")).toHaveValue("Kari Nordmann");

  // Back goes to the tab before, and the arrow keys move along the row.
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Oversikt" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Oversikt" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Innstillinger" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Passord" })).toBeVisible();

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
  await expect(page.getByRole("tabpanel").getByText(`Ordre ${number}`)).toBeVisible();
});

test("every tab of My account passes the accessibility scan, on a phone too (D480)", async ({ page }) => {
  const email = `faner-${Date.now().toString(36)}@example.com`;
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/s/demo/no/account");
  await page.getByLabel("E-post").fill(email);
  await page.getByRole("button", { name: "Send kode" }).click();
  await expect(page.getByText(`Vi har sendt en kode til ${email}`)).toBeVisible();
  await page.getByLabel("Kode").fill(await latestCode(email));
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Oversikt" })).toHaveAttribute("aria-selected", "true");

  for (const tab of ["Oversikt", "Bestillinger", "Profil", "Innstillinger"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tabpanel", { name: tab })).toBeVisible();
    // The four tabs fit a narrow phone: nothing reaches past the screen's edge.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), tab).toBe(true);
    // The store's phone bar is every page's, not My account's: its menu button says Meny but is named Åpne menyen (a separate fix).
    expect(describeFindings(await violationsOn(page, { exclude: ["[data-open-menu]"] })), tab).toEqual([]);
  }
});
