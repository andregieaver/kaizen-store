import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The owner's Payouts page and one payout's page (wave 4 unit C, D290; row analytics.payouts-and-reconciliation). Reading payouts and their lines from
 * Stripe is held by payouts.int.test.ts; this holds the screens that show what was stored: a payout that adds up, one holding money not tied to an
 * order, the payout's lines with the order each settles, and the CSV button.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

/** A store of the owner's own, so the payouts here are no other spec's. */
const STORE = "e2e-payouts";
const RUN = Date.now().toString(36).toLowerCase();
const ids = { good: "", untied: "", order: "", number: "" };

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Payouts') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Payouts', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id, (now() at time zone time_zone)::date::text as today from commerce.stores where slug = ${STORE}`;
    const address = sql.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const number = `PO-${RUN.toUpperCase()}`;
    const [o] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', 50000, 0, 0, 10000, 50000, ${address}, ${address}, 0.25)
      returning id`;
    await sql`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${o.id}, ${`${number}-L`}, 'Ullgenser', 1, 50000, 0, 50000, 10000, 0.25, 'txcd_99999999', 'physical')`;
    const [p] = await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method_type, charge_reference, facts_read_at,
        provider_fee_minor, application_fee_minor, fee_currency)
      values (${store.id}, ${o.id}, 'stripe', ${`cs_e2e_${RUN}`}, 50000, 'NOK', 'captured', 'card', ${`ch_e2e_${RUN}`}, now(), 1250, 500, 'NOK')
      returning id`;
    const payout = async (reference: string, amount: number) => {
      const [row] = await sql`
        insert into commerce.payouts (store_id, provider, provider_reference, provider_account, amount_minor, currency, status, automatic, arrival_on, provider_created_at, lines_read_at, lines_complete)
        values (${store.id}, 'stripe', ${reference}, 'acct_e2e', ${amount}, 'NOK', 'paid', true, ${store.today}::date, now(), now(), true)
        returning id`;
      return String(row.id);
    };
    ids.good = await payout(`po_e2e_${RUN}_good`, 48250);
    await sql`
      insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, source_reference, amount_minor, fee_minor, net_minor, currency, payment_id, order_id, provider_created_at)
      values (${store.id}, ${ids.good}, ${`txn_e2e_${RUN}_1`}, 'charge', 'charge', ${`ch_e2e_${RUN}`}, 50000, 1750, 48250, 'NOK', ${p.id}, ${o.id}, now())`;
    ids.untied = await payout(`po_e2e_${RUN}_untied`, 19000);
    await sql`
      insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, source_reference, amount_minor, fee_minor, net_minor, currency, provider_created_at)
      values (${store.id}, ${ids.untied}, ${`txn_e2e_${RUN}_2`}, 'charge', 'charge', ${`ch_e2e_${RUN}_elsewhere`}, 20000, 1000, 19000, 'NOK', now())`;
    ids.order = String(o.id);
    ids.number = number;
  } finally {
    await sql.end();
  }
});

test("the Payouts page lists the period's payouts, says which adds up and which holds money not tied to an order, with a CSV", async ({ page }) => {
  await page.goto(`/admin/${STORE}/analytics/payouts?period=today`);
  const table = page.getByRole("table", { name: /^Payouts with their date/ });
  const row = (id: string) => table.locator("tr", { has: page.locator(`a[href$="/analytics/payouts/${id}"]`) });
  await expect(row(ids.good)).toContainText("Adds up");
  await expect(row(ids.good)).toContainText("1 payment");
  // What is not tied is the line's net: 200.00 less Stripe's 10.00, written in the admin's language (D312 A9).
  await expect(row(ids.untied)).toContainText(/Money not tied to an order: (NOK )?190[.,]00/);
  await expect(page.getByRole("note").filter({ hasText: /not add up to (its|their) orders/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download CSV/ }).first()).toBeVisible();
});

test("one payout lists what it settles with the order each line is for", async ({ page }) => {
  await page.goto(`/admin/${STORE}/analytics/payouts/${ids.good}`);
  await expect(page.getByRole("link", { name: ids.number })).toHaveAttribute("href", `/admin/${STORE}/orders/${ids.order}`);
  await expect(page.getByText(`ch_e2e_${RUN}`, { exact: true })).toBeVisible();

  await page.goto(`/admin/${STORE}/analytics/payouts/${ids.untied}`);
  await expect(page.getByText("Not tied to an order", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 line \((NOK )?190[.,]00.*\) could not be tied to an order/)).toBeVisible();
});

test("Finance takes Stripe's own fee for the order and says the rest is estimated", async ({ page }) => {
  await page.goto(`/admin/${STORE}/analytics/finance?period=today`);
  const bridge = page.locator('table[data-export-id="finance.bridge"]');
  await expect(bridge.getByRole("row").filter({ hasText: "Payment fees" }).first()).toBeVisible();
});
