import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** The latest email of a kind to an address: emails are recorded when Resend is not set up. */
async function latestEmail(kind: string, to: string): Promise<{ html: string; text: string }> {
  const db = testDb();
  try {
    for (let i = 0; i < 20; i++) {
      const [row] = await db`
        select html, text from commerce.email_messages
        where kind = ${kind} and to_address = ${to} order by created_at desc limit 1`;
      if (row) return { html: String(row.html), text: String(row.text) };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    await db.end();
  }
  throw new Error(`no ${kind} email to ${to}`);
}

const linkIn = async (kind: string, to: string, pattern: RegExp) => {
  const found = pattern.exec((await latestEmail(kind, to)).html);
  if (!found) throw new Error(`no link in the ${kind} email`);
  return found[1];
};

test("an invitation or sign-in link that does not work says so, and nothing of a company shows without signing in (D108)", async ({ page }) => {
  await page.goto(`/s/demo/no/account/company/invite/${"a".repeat(43)}`);
  await expect(page.getByText("Denne invitasjonen gjelder ikke lenger.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Godta invitasjonen" })).toHaveCount(0);
  await page.goto(`/s/demo/no/account/sign-in/${"b".repeat(43)}`);
  await expect(page.getByText("Lenken er brukt eller utløpt.")).toBeVisible();
  await page.goto("/s/demo/no/account/company");
  await expect(page).toHaveURL("/s/demo/no/account");
});

test("a company's main account invites an employee, who gets the discount until it is taken away (D108)", async ({ page, browser }) => {
  const stamp = Date.now().toString(36);
  const boss = `sjef-${stamp}@example.com`;
  const employee = `ansatt-${stamp}@example.com`;
  const db = testDb();
  try {
    const [store] = await db`select id from commerce.stores where slug = 'demo'`;
    const [tier] = await db`insert into commerce.customer_tiers (store_id, name, percent) values (${store.id}, ${`Grossist ${stamp}`}, 10) returning id`;
    const [company] = await db`
      insert into commerce.customer_companies (store_id, name, tier_id, employee_share_percent)
      values (${store.id}, ${`Acme ${stamp}`}, ${tier.id}, 50) returning id`;
    await db`
      insert into commerce.customers (store_id, email, email_verified_at, company_id, company_role)
      values (${store.id}, ${boss}, now(), ${company.id}, 'owner')`;
  } finally {
    await db.end();
  }

  // The main account signs in with a code and invites the employee.
  await page.goto("/s/demo/no/account");
  await page.getByLabel("E-post").fill(boss);
  await page.getByRole("button", { name: "Send kode" }).click();
  await expect(page.getByText(`Vi har sendt en kode til ${boss}`)).toBeVisible();
  const code = /\b(\d{6})\b/.exec((await latestEmail("account.code", boss)).text)![1];
  await page.getByLabel("Kode").fill(code);
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(`Mitt firma: Acme ${stamp}`) }).click();
  await expect(page).toHaveURL("/s/demo/no/account/company");
  await expect(page.getByText("Du får 10 % rabatt på det du kjøper når du er logget inn.")).toBeVisible();
  await page.getByLabel("E-postadresser").fill(employee);
  await page.getByRole("button", { name: "Send invitasjoner" }).click();
  await expect(page.getByText("1 invitasjon sendt.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: employee })).toContainText("Venter");

  // The employee opens the link in their own browser: nothing changes until the button is pressed.
  const token = await linkIn("company.invite", employee, /account\/company\/invite\/([A-Za-z0-9_-]+)/);
  const theirs = await browser.newContext();
  const other = await theirs.newPage();
  await other.goto(`/s/demo/no/account/company/invite/${token}`);
  await expect(other.getByRole("heading", { name: `Bli med i Acme ${stamp}` })).toBeVisible();
  await expect(other.getByText("Du får 5 % rabatt på det du kjøper.")).toBeVisible();
  await other.reload();
  await expect(other.getByRole("button", { name: "Godta invitasjonen" })).toBeVisible();
  await other.getByRole("button", { name: "Godta invitasjonen" }).click();
  await expect(other.getByText(`Vi har opprettet en konto for ${employee}`)).toBeVisible();

  // The email that follows has a link that signs them in once.
  const link = await linkIn("company.joined", employee, /account\/sign-in\/([A-Za-z0-9_-]+)/);
  await other.goto(`/s/demo/no/account/sign-in/${link}`);
  await other.getByRole("button", { name: "Logg inn" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "Hei!" })).toBeVisible();
  await other.goto(`/s/demo/no/account/sign-in/${link}`);
  await expect(other.getByText("Lenken er brukt eller utløpt.")).toBeVisible();

  // They get half of the company's 10 % in the cart.
  await other.goto("/s/demo/no/p/demo-handlenett");
  await expect(other.getByText("Kunderabatten din er 5 %, og trekkes fra i handlekurven.")).toBeVisible();
  await other.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(other.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();
  await other.goto("/s/demo/no/cart");
  const summary = other.getByRole("complementary");
  await expect(summary).toContainText(`Rabatt (Acme ${stamp} 5 %)`);
  await expect(summary).toContainText("−9,95");

  // The main account takes them out, and the discount is gone at once.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: employee }).filter({ hasText: "Godtatt" })).toBeVisible();
  const account = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Fjern" }), hasText: employee });
  await account.getByRole("button", { name: "Fjern" }).click();
  await expect(account).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: employee }).filter({ hasText: "Fjernet" })).toBeVisible();
  await other.reload();
  await expect(other.getByText("Rabatt (")).toHaveCount(0);
  await theirs.close();
});
