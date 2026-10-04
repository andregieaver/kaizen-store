import { expect, test, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";

import { testDb } from "./db";

/**
 * The shopper's invoice (D159, docs/wave-1b-invoices.md 2.2 and 6.1): a paid order in a store whose seller details are complete gets its
 * invoice from the payment itself; the order page lists it, the hosted page draws it from its snapshot in the order's language, the PDF is
 * made by the browser on the server from the same view, and nothing is set or kept in the visitor's browser. A test-mode order says it has
 * no invoice. The server needs PLAYWRIGHT_CHROMIUM_PATH (or a Chromium of its own) to make the PDF.
 */

let seq = 0;

type Fixture = { slug: string; storeId: string; orderId: string; key: string; number: string };

/** A new store with the seller's details and a tax profile, and one paid order of 125,00 kr (25 % VAT) paid through `complete_order_payment()`. */
async function paidOrder(options: { testMode?: boolean } = {}): Promise<Fixture> {
  const n = `${Date.now().toString(36)}${++seq}`;
  const slug = `faktura-${n}`;
  const db = testDb();
  try {
    const [request] = await db`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Test', 'Fakturabutikk') returning id`;
    const [{ id: storeId }] = await db`select commerce.approve_access_request(${request.id}, ${slug}, 'Fakturabutikk', null) as id`;
    await db`
      update commerce.stores set country = 'NO', legal_name = 'Fakturabutikk AS', organisation_number = '923456789',
        postal_address = 'Storgata 1, 0155 Oslo', contact_email = 'post@faktura.example', time_zone = 'Europe/Oslo'
      where id = ${storeId}`;
    await db`
      insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${storeId}, true, 'NO923456789MVA')
      on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456789MVA'`;
    await db`
      insert into commerce.invoice_settings (store_id, enabled) values (${storeId}, true)
      on conflict (store_id) do update set enabled = true`;
    const account = options.testMode ? `acct_TESTE2E${n}` : null;
    if (account) await db`insert into commerce.stripe_accounts (store_id, mode, account_id) values (${storeId}, 'test', ${account})`;

    const number = `INV-${n.toUpperCase()}`;
    const key = `cs_e2e_${n}`;
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
        total_minor, billing_address, shipping_address, shipping_tax_rate)
      values (${storeId}, ${number}, 'NO', 'NOK', 'nb-NO', ${`${slug}@example.com`}, 'pending_payment', 12500, 0, 0, 2500, 12500,
        ${db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" })},
        ${db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" })}, 0.25)
      returning id`;
    await db`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${storeId}, ${order.id}, ${`E2E-${n}`}, 'Ullgenser', 1, 12500, 0, 12500, 2500, 0.25, 'txcd_99999999', 'physical')`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${storeId}, ${order.id}, 'stripe', ${key}, ${account}, 12500, 'NOK', 'pending')`;
    await db`select commerce.complete_order_payment(${order.id}::uuid, ${key})`;
    await db`update commerce.payments set status = 'captured', provider_reference = ${key} where order_id = ${order.id}`;
    return { slug, storeId, orderId: order.id, key, number };
  } finally {
    await db.end();
  }
}

async function invoiceOf(orderId: string): Promise<{ document_number: string; public_token: string } | undefined> {
  const db = testDb();
  try {
    const [row] = await db`select document_number, public_token from commerce.invoices where order_id = ${orderId}`;
    return row as { document_number: string; public_token: string } | undefined;
  } finally {
    await db.end();
  }
}

const orderPage = (f: Fixture) => `/s/${f.slug}/no/order/${f.orderId}?session_id=${f.key}`;
const cookieNames = async (page: Page) => (await page.context().cookies()).map((c) => c.name).sort();

test("a shopper finds the invoice on the order page, reads it, and downloads it as a PDF that holds its number and its total", async ({ page, browser }) => {
  const f = await paidOrder();
  const invoice = await invoiceOf(f.orderId);
  expect(invoice?.document_number).toBe("F-1");

  await page.goto(orderPage(f));
  const documents = page.locator('section[aria-labelledby="documents-heading"]');
  await expect(documents.getByRole("heading", { name: "Dokumenter" })).toBeVisible();
  await expect(documents).toContainText("Faktura F-1");

  // The hosted page: the invoice in the order's language, with the seller, the buyer, the VAT per rate and the total.
  await documents.getByRole("link", { name: /^Vis/ }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${f.slug}/no/account/documents/inv_[A-Za-z0-9_-]{43}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Faktura F-1" })).toBeVisible();
  const document = page.getByRole("article", { name: "Faktura F-1" });
  await expect(document).toContainText("Fakturabutikk AS");
  await expect(document).toContainText("923456789 MVA");
  await expect(document).toContainText("NO923456789MVA");
  await expect(document).toContainText("Kari Nordmann");
  await expect(document).toContainText("Ullgenser");
  await expect(document).toContainText("Mva. per sats");
  await expect(document).toContainText(/125,00\s*kr/);
  await expect(document).toContainText(/25,00\s*kr/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  // Reading it sets no cookie and keeps nothing in the browser: a visitor with a fresh browser who follows the link gets neither.
  const link = page.url();
  const fresh = await browser.newContext();
  try {
    const visitor = await fresh.newPage();
    await visitor.goto(link);
    await expect(visitor.getByRole("heading", { level: 1, name: "Faktura F-1" })).toBeVisible();
    await visitor.waitForTimeout(500);
    expect(await cookieNames(visitor)).toEqual([]);
    expect(await visitor.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  } finally {
    await fresh.close();
  }

  // The PDF: a file named after the invoice, whose text layer holds the number and the total.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Last ned PDF" }).click()]);
  expect(download.suggestedFilename()).toBe("F-1.pdf");
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = new Uint8Array(await readFile(path));
  expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  const flat = String(text).replace(/[\s  ]+/g, " ");
  expect(flat).toContain("Faktura F-1");
  expect(flat).toContain("Fakturabutikk AS");
  expect(flat).toMatch(/125,00 kr/);
});

test("the PDF route answers with a PDF, and a token that is not this store's, or not a token at all, is the same not-found", async ({ page, request }) => {
  const f = await paidOrder();
  const other = await paidOrder();
  const invoice = (await invoiceOf(f.orderId))!;
  const theirs = (await invoiceOf(other.orderId))!;

  const response = await request.get(`/s/${f.slug}/no/account/documents/${invoice.public_token}/pdf`, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(response.headers()["content-disposition"]).toContain('filename="F-1.pdf"');
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
  expect((await response.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Another store's token, and nothing that looks like one: the PDF route answers 404, and the page (which streams, so its status line is
  // sent before the lookup, as Work's hosted invoice) draws no document and is not indexed.
  for (const token of [theirs.public_token, "inv_short", "crn_" + "x".repeat(43), "not-a-token"]) {
    await page.goto(`/s/${f.slug}/no/account/documents/${token}`);
    await expect(page.getByRole("article"), token).toHaveCount(0);
    await expect(page.getByText("Ullgenser"), token).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first(), token).toHaveAttribute("content", /noindex/);
    expect((await request.get(`/s/${f.slug}/no/account/documents/${token}/pdf`, { maxRedirects: 0 })).status(), token).toBe(404);
  }
});

test("where the PDF cannot be made, the hosted page opens the browser's own print dialog once and takes ?print=1 off the address", async ({ page }) => {
  const f = await paidOrder();
  const invoice = (await invoiceOf(f.orderId))!;
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.goto(`/s/${f.slug}/no/account/documents/${invoice.public_token}?print=1`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/documents/${invoice.public_token}$`));
  // A reload does not print again; the button does.
  await page.reload();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(0);
  await page.getByRole("button", { name: "Skriv ut" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
});

test("an order paid in Stripe's test mode has no invoice and says so", async ({ page }) => {
  const f = await paidOrder({ testMode: true });
  expect(await invoiceOf(f.orderId)).toBeUndefined();
  await page.goto(orderPage(f));
  await expect(page.getByRole("heading", { name: "Dokumenter" })).toBeVisible();
  await expect(page.getByText("Testbestilling: ingen faktura.")).toBeVisible();
  await expect(page.getByRole("link", { name: /^PDF/ })).toHaveCount(0);
});
