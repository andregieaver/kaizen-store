import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The VAT report with data, as the owner reads it (D161, D379; row analytics.tax-and-vat-reports-by-rate-and-jurisdiction): a store of the
 * owner's own with the seller's details and one order of 125,00 kr (25 % VAT) paid through `complete_order_payment()`, which issues its
 * invoice; Analytics → VAT shows Norway at 25 % with the net, the VAT and the invoice, says it is not a tax return, and its reconciliation
 * names no difference. The classification and the arithmetic are held by `tax-reports.int.test.ts`; this holds the page that draws them.
 */

const STORE = "e2e-taxreport";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Tax report') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Tax report', null)`;
    });
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const storeId = store.id;
    await sql`
      update commerce.stores set country = 'NO', legal_name = 'E2E Skatt AS', organisation_number = '923456789',
        postal_address = 'Storgata 1, 0155 Oslo', contact_email = 'post@skatt.example', time_zone = 'Europe/Oslo'
      where id = ${storeId}`;
    await sql`
      insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${storeId}, true, 'NO923456789MVA')
      on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456789MVA'`;
    await sql`insert into commerce.invoice_settings (store_id, enabled) values (${storeId}, true) on conflict (store_id) do update set enabled = true`;
    // One paid order, made once: a rerun on the same database reads the same figures.
    if ((await sql`select 1 from commerce.orders where store_id = ${storeId}`).length > 0) return;
    const n = Date.now().toString(36);
    const key = `cs_e2e_tax_${n}`;
    const address = sql.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
        total_minor, billing_address, shipping_address, shipping_tax_rate)
      values (${storeId}, ${`TAX-${n.toUpperCase()}`}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'pending_payment', 12500, 0, 0, 2500, 12500,
        ${address}, ${address}, 0.25)
      returning id`;
    await sql`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${storeId}, ${order.id}, ${`E2E-TAX-${n}`}, 'Ullgenser', 1, 12500, 0, 12500, 2500, 0.25, 'txcd_99999999', 'physical')`;
    await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}, ${order.id}, 'stripe', ${key}, 12500, 'NOK', 'pending')`;
    await sql`select commerce.complete_order_payment(${order.id}::uuid, ${key})`;
    await sql`update commerce.payments set status = 'captured' where order_id = ${order.id}`;
    const [invoice] = await sql`select document_number from commerce.invoices where order_id = ${order.id}`;
    expect(invoice, "the paid order's invoice").toBeTruthy();
  } finally {
    await sql.end();
  }
});

test("the owner reads VAT by country and rate made from the store's invoices, and a reconciliation with nothing unnamed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: OWNER.state });
  const page = await context.newPage();
  await page.goto(`/admin/${STORE}/analytics/tax?view=vat&period=today`);

  await expect(page.getByText("Not a tax return").first()).toBeVisible();
  // Norway at 25 %: the net and the VAT of the one invoice, in kroner.
  const norway = page.getByRole("table", { name: "VAT by country, rate and basis" }).getByRole("row", { name: /^NO 25\s?%\s+Standard/ });
  await expect(norway).toHaveCount(1);
  await expect(norway).toContainText("NOK 100.00");
  await expect(norway).toContainText("NOK 25.00");
  await expect(norway).toContainText("NOK 125.00");
  await expect(page.getByText(/^Made from \d+ invoices?/).first()).toBeVisible();

  // The reconciliation is drawn and names every difference.
  await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();
  await expect(page.getByText("Does not reconcile")).toHaveCount(0);
  await expect(page.getByText(/^Difference not named/)).toHaveCount(0);
  await context.close();
});
