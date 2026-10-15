import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * The exchange on a return's page as two people see it (wave 3, D239, `docs/wave-3-exchanges.md` 2.2, 6.1 criterion 1): the owner opens an approved voluntary return,
 * adds a replacement with the product picker, reads the server's summary (the credit, the replacement priced, the outcome), creates a link to share (shown once)
 * and finds the proposal out with the customer, with *Send again*, the agreement and *Withdraw*; the Read-only member sees the card and nothing to press. The money,
 * processing and documents are held by `exchanges.int.test.ts`; the customer's page by `e2e/exchange.spec.ts`.
 */

const SWEATER = 59_900;

/** A paid order of one demo product in Norway (paid by bank transfer, recorded by the owner, so Kaizen can refund it) and an approved return of it. */
async function approvedReturn(): Promise<{ returnId: string; number: string }> {
  const db = testDb();
  try {
    const [store] = await db`select id from commerce.stores where slug = ${E2E_STORE}`;
    const [owner] = await db`select account_id from commerce.store_members where store_id = ${store.id} and role = 'owner' limit 1`;
    const [variant] = await db`
      select v.id, v.sku from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' and p.status = 'active' and v.active order by v.sku limit 1`;
    const number = `XA-${Date.now().toString(36).toUpperCase()}`;
    const address = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate, return_cost_payer)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', ${SWEATER}, 0, 0, 11980, ${SWEATER}, ${address}, ${address}, 0.25, 'shopper')
      returning id`;
    const [line] = await db`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${variant.id}, ${variant.sku}, 'Ullgenser – S', 1, ${SWEATER}, 0, ${SWEATER}, 11980, 0.25, 'txcd_99999999', 'physical')
      returning id`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method, recorded_by, received_on)
      values (${store.id}, ${order.id}, 'manual', ${`manual_${number}`}, ${SWEATER}, 'NOK', 'captured', 'bank_transfer', ${owner.account_id}, current_date)`;
    const [ret] = await db`insert into commerce.returns (store_id, order_id, kind, status) values (${store.id}, ${order.id}, 'return', 'approved') returning id, number`;
    await db`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${store.id}, ${ret.id}, ${line.id}, 1, 'accept')`;
    return { returnId: ret.id, number: ret.number };
  } finally {
    await db.end();
  }
}

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("builds an exchange with the picker, reads the server's summary and shares the proposal", async ({ page }) => {
    const { returnId, number } = await approvedReturn();
    await page.goto(`/admin/${E2E_STORE}/returns/${returnId}`);
    await expect(page.getByRole("heading", { level: 1, name: `Return ${number}` })).toBeVisible();
    const card = page.locator("section[aria-labelledby=exchange]");
    await expect(card.getByRole("heading", { name: "Exchange", exact: true })).toBeVisible();
    await expect(card.getByRole("heading", { name: "Propose an exchange" })).toBeVisible();
    // The credit is the server's working before anything is chosen.
    await expect(card.getByText("The customer's credit")).toBeVisible();

    await card.getByLabel(/Search by title or SKU/).fill("demo");
    await card.getByRole("list", { name: "Products found" }).getByRole("button").first().click();
    await expect(card.getByRole("list", { name: "Replacements" }).getByRole("listitem")).toHaveCount(1);

    // The summary is asked of the server a moment after the change: the outcome is one of its three sentences.
    await expect(card.getByRole("status").filter({ hasText: /^(Refund due to the customer|Payment to collect|Even exchange)/ })).toBeVisible();
    await expect(card.getByText("credit note for the returned items")).toBeVisible();

    await card.getByRole("button", { name: "Create a link to share" }).click();
    const link = card.getByRole("textbox", { name: "The link to the exchange" });
    await expect(link).toBeVisible();
    await expect(link).toHaveValue(/\/account\/exchange\/[A-Za-z0-9_-]{43}$/);

    await page.reload();
    await expect(card.getByRole("heading", { name: /Proposal 1/ })).toBeVisible();
    await expect(card.getByText("Proposed", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Send again" })).toBeVisible();
    await expect(card.getByText("Record the customer's agreement")).toBeVisible();
    await expect(card.getByRole("button", { name: "Withdraw the proposal" })).toBeVisible();
    // No second builder while the proposal is out.
    await expect(card.getByRole("heading", { name: "Propose another exchange" })).toHaveCount(0);

    await card.getByRole("button", { name: "Withdraw the proposal" }).click();
    // The card is drawn afresh: the proposal is cancelled, says how the return goes on, and the builder is back for another one.
    const ended = card.getByRole("region", { name: /Proposal 1\s*Cancelled/ });
    await expect(ended).toBeVisible();
    await expect(ended.getByText("The exchange was cancelled: refund the return as usual.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Withdraw the proposal" })).toHaveCount(0);
    await expect(card.getByRole("heading", { name: "Propose another exchange" })).toBeVisible();
  });
});

test.describe("the read-only member", () => {
  test.use({ storageState: READER.state });

  test("sees the return's exchange card with nothing to press", async ({ page }) => {
    const { returnId } = await approvedReturn();
    await page.goto(`/admin/${E2E_STORE}/returns/${returnId}`);
    const card = page.locator("section[aria-labelledby=exchange]");
    await expect(card.getByRole("heading", { name: "Exchange", exact: true })).toBeVisible();
    await expect(card.getByText(/No exchange has been proposed/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Send to the customer" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Create a link to share" })).toHaveCount(0);
  });
});
