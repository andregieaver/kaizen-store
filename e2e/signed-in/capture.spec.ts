import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * Authorise now, capture later on the owner's screens (wave 4 unit B, D289; row checkout.authorize-then-capture): the Orders settings' *Take payment*
 * choice, an order whose card is held (the capture card on its page, *Card held* in the list and its filter, *To send* under *when sent*). Stripe's
 * part (the hold, the capture, less than held, the void, the expiry) is held by payment-capture.int.test.ts; this holds the screens.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

/** A store of the owner's own, so the orders and the setting here are no other spec's. */
const STORE = "e2e-cap";
const RUN = Date.now().toString(36).toUpperCase();
const ids = { byHand: "", whenSent: "" };

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Capture') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Capture', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    await sql`delete from commerce.order_settings where store_id = (select id from commerce.stores where slug = ${STORE})`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const address = sql.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const held = async (key: keyof typeof ids, mode: "by_hand" | "when_sent") => {
      const number = `CAP-${RUN}-${key.toUpperCase()}`;
      const [o] = await sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
          billing_address, shipping_address, shipping_tax_rate, capture_mode, capture_before)
        values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'authorized', 50000, 0, 0, 10000, 50000, ${address}, ${address}, 0.25, ${mode}, now() + interval '5 days')
        returning id`;
      await sql`
        insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${store.id}, ${o.id}, ${`${number}-L`}, 'Ullgenser', 1, 50000, 0, 50000, 10000, 0.25, 'txcd_99999999', 'physical')`;
      await sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
        values (${store.id}, ${o.id}, 'stripe', ${`cs_e2e_${number.toLowerCase()}`}, 50000, 'NOK', 'authorized')`;
      ids[key] = String(o.id);
    };
    await held("byHand", "by_hand");
    await held("whenSent", "when_sent");
  } finally {
    await sql.end();
  }
});

test("the owner chooses when the card is charged, and the choice is kept", async ({ page }) => {
  await page.goto(`/admin/${STORE}/settings/orders`);
  const section = page.getByRole("region", { name: "Take payment" });
  await expect(section.getByRole("radio", { name: /When the order is placed/ })).toBeChecked();
  await section.getByRole("radio", { name: /When you capture it/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Take payment" }).getByRole("radio", { name: /When you capture it/ })).toBeChecked();
});

test("a held card's order shows what is held and until when, with Capture and Cancel and release", async ({ page }) => {
  await page.goto(`/admin/${STORE}/orders/${ids.byHand}`);
  const card = page.getByRole("region", { name: "Card held, to capture" });
  await expect(card.getByText(/is held on the customer's card, not charged/)).toBeVisible();
  await expect(card.getByText("Nothing is charged until you capture it.", { exact: false })).toBeVisible();
  await expect(card.getByLabel(/Amount to capture/)).toHaveValue("500,00");
  await expect(card.getByRole("button", { name: "Capture" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Cancel and release" })).toBeVisible();
  // Captured by hand, it is not sent from the page until it is captured.
  await expect(page.getByRole("region", { name: "Send the order" })).toHaveCount(0);

  await page.goto(`/admin/${STORE}/orders/${ids.whenSent}`);
  await expect(page.getByRole("region", { name: "Card held, to capture" }).getByText("Recording the first parcel or handover captures it.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Send the order" }).getByRole("button", { name: "Capture and send" })).toBeVisible();
});

test("the list says the card is held, filters by it, and counts a held order to send as to send", async ({ page }) => {
  await page.goto(`/admin/${STORE}/orders?pay=authorized&q=${encodeURIComponent(`CAP-${RUN}`)}`);
  await expect(page.getByText(`CAP-${RUN}-BYHAND`)).toBeVisible();
  await expect(page.getByText(`CAP-${RUN}-WHENSENT`)).toBeVisible();
  await expect(page.getByText("Card held").first()).toBeVisible();
  await page.goto(`/admin/${STORE}/orders?ship=to_send&q=${encodeURIComponent(`CAP-${RUN}`)}`);
  await expect(page.getByText(`CAP-${RUN}-WHENSENT`)).toBeVisible();
  await expect(page.getByText(`CAP-${RUN}-BYHAND`)).toHaveCount(0);
});
