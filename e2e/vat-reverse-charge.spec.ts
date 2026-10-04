import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Reverse charge in the cart (D157, docs/wave-1a-tax.md section 6.2): a Swedish store registered for VAT whose number has been
 * checked valid sells to a Danish business, which enters its EU VAT number. VIES is a stand-in server
 * (e2e/fixtures/vies-stub.mjs, started by playwright.config.ts and named by VIES_TEST_URL): valid takes the VAT off the cart,
 * and when it answers 503 the VAT is charged and the shopper can still go on to pay.
 *
 * Needs the app to have been started with the stub's address (playwright.config.ts does it); a server that was already
 * running without it is not honoured, because the check would then ask the real VIES.
 *
 * What it does not do: press Checkout. Paying needs Stripe, which a test database does not have; the order, its totals
 * and Stripe's lines are held by `src/server/vat-engine.int.test.ts` against a fake Stripe.
 */
const STUB = `http://127.0.0.1:${process.env.VIES_STUB_PORT ?? 3911}`;
const SELLER = "SE556677889901";
const mode = (value: "valid" | "invalid" | "down") =>
  fetch(`${STUB}/__mode`, { method: "POST", body: JSON.stringify({ mode: value }) });

/** A store in Sweden registered for VAT with a number VIES has said is valid, selling only to businesses, taking payments. */
async function swedishStore(): Promise<string> {
  const slug = `vatrc-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Firma') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Firma', null) as id`;
    await sql`update commerce.stores set audience = 'businesses', country = 'SE' where id = ${id}`;
    const [check] = await sql`
      insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source)
      values (${id}, 'seller', ${SELLER}, 'SE', 'valid', 'vies') returning id`;
    await sql`
      insert into commerce.store_tax_profile (store_id, vat_registered, vat_number, vat_number_check_id, vat_number_checked_at, vat_number_valid)
      values (${id}, true, ${SELLER}, ${check.id}, now(), true)`;
    // Payments are on for a live account, which needs none of Kaizen's own Stripe keys.
    await sql`update commerce.payment_providers set enabled = true, active_mode = 'live' where store_id = ${id} and provider = 'stripe'`;
    await sql`
      insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
      values (${id}, 'live', ${`acct_${slug.replace(/[^a-zA-Z0-9]/g, "")}`}, 'active', false)`;
  } finally {
    await sql.end();
  }
  return slug;
}

const addNotebook = async (page: import("@playwright/test").Page, slug: string, market: string, add: string) => {
  await page.goto(`/s/${slug}/${market}/p/demo-notatbok`);
  await page.getByRole("button", { name: add, disabled: false }).first().click();
  await expect(page.getByRole("link", { name: /\(1\)/ }).first()).toBeVisible();
  await page.goto(`/s/${slug}/${market}/cart`);
};

test.afterEach(async () => {
  await mode("valid");
});

test("a Danish business enters a VAT number VIES accepts: the cart takes the VAT off and says reverse charge with both numbers", async ({ page }) => {
  await mode("valid");
  const slug = await swedishStore();
  await addNotebook(page, slug, "dk", "Læg i kurven");

  // A business sees amounts without VAT: the notebook 99,00 with VAT is 79,20, shipping 69,00 is 55,20, to pay 168,00 with VAT.
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("168,00");
  await expect(summary).not.toContainText("Omvendt betalingspligt");

  await page.getByLabel("Firmanavn").fill("Kunde ApS");
  await page.getByLabel("CVR-nummer").fill("12345674");
  const number = page.getByLabel("Momsnummer (EU)");
  await number.fill("DK 12345674");
  await page.getByRole("button", { name: "Tjek nummeret" }).click();

  // The sentence under the field, then the cart without VAT.
  await expect(page.getByText("Momsnummeret er godkendt. Der opkræves ikke moms (omvendt betalingspligt).")).toBeVisible();
  await expect(summary).toContainText("Moms (omvendt betalingspligt)");
  await expect(summary).toContainText("Omvendt betalingspligt: der er ikke opkrævet moms.");
  await expect(summary).toContainText(`Sælgers momsnr.: ${SELLER}`);
  await expect(summary).toContainText("Købers momsnr.: DK12345674");
  await expect(summary).toContainText("134,40");
  await expect(summary).not.toContainText("168,00");
  await expect(page.getByRole("button", { name: "Til kassen" })).toBeEnabled();

  // A number VIES does not accept charges the VAT again, and says so.
  await mode("invalid");
  await number.fill("DK 12345675");
  await page.getByRole("button", { name: "Tjek nummeret" }).click();
  await expect(page.getByText("Momsnummeret blev ikke godkendt. Der opkræves moms.")).toBeVisible();
  await expect(summary).toContainText("168,00");
  await expect(summary).not.toContainText("Omvendt betalingspligt");
});

test("VIES being down never blocks the sale and never takes the VAT off", async ({ page }) => {
  await mode("down");
  const slug = await swedishStore();
  await addNotebook(page, slug, "dk", "Læg i kurven");

  await page.getByLabel("Firmanavn").fill("Kunde ApS");
  await page.getByLabel("CVR-nummer").fill("12345674");
  await page.getByLabel("Momsnummer (EU)").fill("DK12345674");
  await page.getByRole("button", { name: "Tjek nummeret" }).click();

  await expect(page.getByText("Momsnummeret kunne ikke tjekkes lige nu. Der opkræves moms. Prøv igen om lidt.")).toBeVisible();
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("168,00");
  await expect(summary).not.toContainText("Omvendt betalingspligt");
  // The way to pay is open.
  await expect(page.getByRole("button", { name: "Til kassen" })).toBeEnabled();

  // And when it is back, the same number is accepted.
  await mode("valid");
  await page.getByRole("button", { name: "Tjek nummeret" }).click();
  await expect(page.getByText("Momsnummeret er godkendt.")).toBeVisible();
  await expect(summary).toContainText("134,40");
});

test("the field is not offered in the seller's own country, and a mistyped number is told, not sent", async ({ page }) => {
  await mode("valid");
  const slug = await swedishStore();

  // Sweden is the seller's own country: a business there pays Swedish VAT, so there is nothing to enter.
  await addNotebook(page, slug, "se", "Lägg i varukorgen");
  await expect(page.getByLabel("Företagsnamn")).toBeVisible();
  await expect(page.getByLabel("Momsnummer (EU)")).toHaveCount(0);

  await addNotebook(page, slug, "dk", "Læg i kurven");
  await page.getByLabel("Firmanavn").fill("Kunde ApS");
  await page.getByLabel("CVR-nummer").fill("12345674");
  await page.getByLabel("Momsnummer (EU)").fill("12");
  await page.getByRole("button", { name: "Tjek nummeret" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Momsnummeret ser ikke rigtigt ud" })).toBeVisible();
  // Pressing Enter in the field checks it; it does not start the checkout.
  await page.getByLabel("Momsnummer (EU)").fill("DK12345674");
  await page.getByLabel("Momsnummer (EU)").press("Enter");
  await expect(page.getByText("Momsnummeret er godkendt.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/dk/cart$`));
});
