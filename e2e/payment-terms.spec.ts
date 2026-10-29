import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Buying on a company's payment terms (D293; wave 11 unit H, D387): a signed-in employee of a company with 30 days to pay chooses *Pay by invoice* at
 * checkout (here the only way, as the end-to-end server takes no payments), places the order with nothing paid, and lands on the order page, which says
 * when the invoice is due; the order keeps its terms and owes its whole total.
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

/** A store of its own selling to businesses, a company on 30 days' terms and an employee of it with a billing address. */
async function termsStore(): Promise<{ slug: string; email: string }> {
  const slug = `faktura-${Date.now().toString(36)}`;
  const email = `ansatt-${slug}@example.com`;
  const db = testDb();
  try {
    const [request] = await db`
      insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', 'Karis Faktura') returning id`;
    const [{ id }] = await db`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Faktura', null) as id`;
    await db`update commerce.stores set audience = 'both', features = features || array['business'] where id = ${id}`;
    const [company] = await db`
      insert into commerce.customer_companies (store_id, name, organisation_number, payment_terms)
      values (${id}, 'Fjord AS', '987654321', 'net_30') returning id`;
    await db`
      insert into commerce.customers (store_id, email, name, phone, email_verified_at, company_id, company_role, address)
      values (${id}, ${email}, 'Ola Ansatt', '+4791234567', now(), ${company.id}, 'employee',
              ${db.json({ line1: "Storgata 1", line2: "", postalCode: "0155", city: "Oslo", country: "NO" })})`;
  } finally {
    await db.end();
  }
  return { slug, email };
}

test("a company's employee chooses Pay by invoice at checkout and places the order with nothing paid", async ({ page }) => {
  const { slug, email } = await termsStore();
  const base = `/s/${slug}/no`;

  await page.goto(`${base}/account`);
  await page.getByLabel("E-post").fill(email);
  await page.getByRole("button", { name: "Send kode" }).click();
  await expect(page.getByText(`Vi har sendt en kode til ${email}`)).toBeVisible();
  await page.getByLabel("Kode").fill(await latestCode(email));
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.getByText(`Logget inn som ${email}`)).toBeVisible();

  await page.goto(`${base}/p/demo-keramikkopp`);
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." })).toBeVisible();

  await page.goto(`${base}/cart`);
  await expect(page.getByText("Betal med faktura").first()).toBeVisible();
  await expect(page.getByText("Fjord AS har 30 dagers betalingsfrist.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Fullfør bestillingen" }).click();

  await expect(page).toHaveURL(/\/order\//, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Betal med faktura" })).toBeVisible();
  await expect(page.getByText("forfaller", { exact: false }).first()).toBeVisible();

  const db = testDb();
  try {
    const [order] = await db`
      select o.status, o.balance_minor, o.total_minor, t.terms, t.paid_at
      from commerce.orders o join commerce.order_payment_terms t on t.store_id = o.store_id and t.order_id = o.id
      join commerce.stores s on s.id = o.store_id where s.slug = ${slug}`;
    expect(order).toMatchObject({ status: "paid", terms: "net_30", paid_at: null });
    expect(Number(order.balance_minor)).toBe(Number(order.total_minor));
    const [captured] = await db`
      select count(*)::int as n from commerce.payments p join commerce.stores s on s.id = p.store_id where s.slug = ${slug} and p.status = 'captured'`;
    expect(captured.n).toBe(0);
  } finally {
    await db.end();
  }
});
