import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The *Send* card on an order's page as the owner uses it (wave 3, D174; row orders.fulfilment-workflow-partial-fulfilment): send part
 * of an order in one parcel, see what is left, and send the rest in another; a card opened before a parcel was recorded elsewhere is
 * refused rather than sending twice. `markSent()`, the units still to send and the order's state are held by the fulfilment
 * integration tests; this holds the screen that drives them.
 */

test.use({ storageState: OWNER.state });

/** A store of the owner's own, so the orders and the variants they name are no other spec's (theme-switch.spec.ts reads the shared store's products). */
const STORE = "e2e-send";

const NUMBER = `SEND-${Date.now().toString(36).toUpperCase()}`;
let orderId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Send') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Send', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const address = sql.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate)
      values (${store.id}, ${NUMBER}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', 150000, 0, 0, 30000, 150000, ${address}, ${address}, 0.25)
      returning id`;
    orderId = String(order.id);
    // Two of the store's own goods variants: a line is sent only when it names its variant.
    const [sweater, scarf] = await sql`
      select v.id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
       where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' order by v.sku limit 2`;
    await sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${sweater.id}, ${`${NUMBER}-G`}, 'Ullgenser', 2, 50000, 0, 100000, 20000, 0.25, 'txcd_99999999', 'physical'),
             (${store.id}, ${order.id}, ${scarf.id}, ${`${NUMBER}-S`}, 'Skjerf', 1, 50000, 0, 50000, 10000, 0.25, 'txcd_99999999', 'physical')`;
    await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${`cs_e2e_${NUMBER.toLowerCase()}`}, 150000, 'NOK', 'captured')`;
  } finally {
    await sql.end();
  }
});

async function parcels() {
  const sql = testDb();
  try {
    const [order] = await sql<{ status: string }[]>`select status from commerce.orders where id = ${orderId}`;
    const lines = await sql<{ shipment: string; title: string; quantity: number }[]>`
      select sh.id as shipment, l.title, sl.quantity::int as quantity
        from commerce.shipments sh
        join commerce.shipment_lines sl on sl.shipment_id = sh.id
        join commerce.order_lines l on l.id = sl.order_line_id
       where sh.order_id = ${orderId} and sh.undone_at is null
       order by sh.created_at, l.title`;
    return { status: order.status, parcels: new Set(lines.map((l) => l.shipment)).size, lines: lines.map(({ title, quantity }) => ({ title, quantity })) };
  } finally {
    await sql.end();
  }
}

test("sends one sweater, then the rest in a second parcel, and refuses a card that had not seen the first", async ({ browser }) => {
  const context = await browser.newContext({ storageState: OWNER.state });
  const page = await context.newPage();
  const stale = await context.newPage();
  await page.goto(`/admin/${STORE}/orders/${orderId}`);
  await stale.goto(`/admin/${STORE}/orders/${orderId}`);

  // The first parcel: one of the two sweaters and no scarf, with a tracking number and no email.
  await page.getByLabel("In this parcel: Ullgenser").fill("1");
  await page.getByLabel("In this parcel: Skjerf").fill("0");
  await page.getByLabel(/^Tracking number/).fill("TRACK-1");
  await page.getByRole("checkbox", { name: /^Tell the customer/ }).uncheck();
  await page.getByRole("button", { name: "Send this parcel" }).click();
  await expect(page.getByText("Parcel recorded (2 units are still to send).")).toBeVisible();
  expect(await parcels()).toEqual({ status: "paid", parcels: 1, lines: [{ title: "Ullgenser", quantity: 1 }] });

  // A card opened before that parcel would send the sweaters again: it is refused and nothing is written.
  await stale.getByRole("checkbox", { name: /^Tell the customer/ }).uncheck();
  await stale.getByRole("button", { name: "Send this parcel" }).click();
  await expect(stale.getByText(/^The order changed while you were choosing/)).toBeVisible();
  expect((await parcels()).parcels).toBe(1);

  // Looked at again, the card offers what is left, and the second parcel sends it all.
  await page.reload();
  await expect(page.getByLabel("In this parcel: Ullgenser")).toHaveValue("1");
  await expect(page.getByLabel("In this parcel: Skjerf")).toHaveValue("1");
  await page.getByRole("checkbox", { name: /^Tell the customer/ }).uncheck();
  await page.getByRole("button", { name: "Send another parcel" }).click();
  // With nothing left, the card gives way to the parcels: the second says it sent the rest.
  await expect(page.getByText("Nothing of this order is left to send.")).toBeVisible();
  await expect(page.getByText(/2 units, nothing left to send/)).toBeVisible();
  expect(await parcels()).toEqual({
    status: "fulfilled",
    parcels: 2,
    lines: [
      { title: "Ullgenser", quantity: 1 },
      { title: "Skjerf", quantity: 1 },
      { title: "Ullgenser", quantity: 1 },
    ],
  });
  await context.close();
});
