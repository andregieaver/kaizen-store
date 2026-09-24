import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** The latest sign-in code emailed to an address (emails are recorded when SES is not set up). */
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

test("a shopper signs in with an emailed code, keeps their details and signs out", async ({ page }) => {
  const email = `kunde-${Date.now().toString(36)}@example.com`;
  await page.goto("/s/demo/no");
  await page.getByRole("link", { name: "Min konto" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Logg inn" })).toBeVisible();

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
  await expect(page.getByRole("heading", { level: 1, name: "Logg inn" })).toBeVisible();
});

test("the password sign-in says nothing about which addresses have accounts", async ({ page }) => {
  await page.goto("/s/demo/no/account");
  await page.getByRole("button", { name: "Logg inn med passord" }).click();
  await page.getByLabel("E-post").fill("ingen-her@example.com");
  await page.getByLabel("Passord").fill("et helt feil passord");
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByText("E-post eller passord stemmer ikke.")).toBeVisible();
});
