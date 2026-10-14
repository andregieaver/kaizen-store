import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { testDb, testStore } from "./db";

/**
 * Pickup and local delivery as the shopper sees them (wave 3 shipping methods, D237, `docs/wave-3-shipping-methods.md` 2.4 and 6.2): the cart says the delivery
 * price is chosen at checkout while a pickup place may change it, and the order page of a pickup order says where to collect it, the place's hours and
 * instructions as the order kept them, and where it stands (ready, collected); a local delivery shows its area, information and the buyer's note.
 *
 * The checkout's own delivery choice needs a Stripe session, which the end-to-end server has no keys for: it is held by `delivery-choice.test.ts` (the groups,
 * the note, the refusals' words), `pickup.int.test.ts`, `local-delivery.int.test.ts` and the scenarios of `checkout-kinds.int.test.ts` (cart and order agree,
 * kroner and euro). Orders are written with SQL the way `placeOrder()`, `markReadyForPickup()` and `markCollected()` write them (staff's screens need a signed-in
 * admin, which these tests do not have).
 */

const WEEK = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
  sat: { open: "10:00", close: "14:00" },
  sun: null,
};

type Place = { storeId: string; slug: string; locationId: string };

/** A store selling in Norway alone (no country in its addresses, D181) with a shop where customers can collect for free, usually ready in 3 hours. */
async function storeWithPickup(): Promise<Place> {
  const store = await testStore("hent");
  const db = testDb();
  try {
    const [place] = await db`
      insert into commerce.store_locations (store_id, kind, name, street, postal_code, city, country, hours)
      values (${store.id}, 'shop', 'Butikken på Løkka', 'Thorvald Meyers gate 1', '0555', 'Oslo', 'NO', ${db.json({ week: WEEK, exceptions: [] })})
      returning id`;
    await db`
      insert into commerce.pickup_options (store_id, location_id, market_code, currency, amount_minor, ready_in_hours, instructions)
      values (${store.id}, ${place.id}, 'NO', 'NOK', 0, 3, 'Ring på ved bakdøra.')`;
    return { storeId: store.id, slug: store.slug, locationId: place.id };
  } finally {
    await db.end();
  }
}

type OrderFixture = { orderId: string; key: string; lineId: string; number: string };

/** A paid order of 2 × Ullgenser to collect at the place, as `placeOrder()` keeps it: the method, the place and a snapshot of it (address, hours, instructions). */
async function paidPickupOrder(p: Place): Promise<OrderFixture> {
  const db = testDb();
  const number = `HE-${Date.now().toString(36).toUpperCase()}`;
  const key = `cs_e2e_${number.toLowerCase()}`;
  try {
    const [variant] = await db`
      select v.id, v.sku from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${p.storeId} and p.kind = 'goods' and v.delivery = 'physical' order by v.sku limit 1`;
    const delivery = db.json({
      kind: "pickup",
      label: "Butikken på Løkka",
      locationId: p.locationId,
      name: "Butikken på Løkka",
      street: "Thorvald Meyers gate 1",
      postalCode: "0555",
      city: "Oslo",
      country: "NO",
      hours: { week: WEEK, exceptions: [] },
      instructions: "Ring på ved bakdøra.",
      readyInHours: 3,
    });
    const billing = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate, delivery_method, pickup_location_id, delivery)
      values (${p.storeId}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', 50000, 0, 0, 10000, 50000, ${billing}, ${db.json({})}, 0.25,
        'pickup', ${p.locationId}, ${delivery})
      returning id`;
    const [line] = await db`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${p.storeId}, ${order.id}, ${variant.id}, ${variant.sku}, 'Ullgenser', 2, 25000, 0, 50000, 10000, 0.25, 'txcd_99999999', 'physical')
      returning id`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${p.storeId}, ${order.id}, 'stripe', ${key}, 50000, 'NOK', 'captured')`;
    return { orderId: order.id, key, lineId: line.id, number };
  } finally {
    await db.end();
  }
}

/** *Ready for pickup* as `markReadyForPickup()` records it. */
async function markReady(p: Place, o: OrderFixture) {
  const db = testDb();
  try {
    await db`update commerce.orders set ready_for_pickup_at = now() - interval '1 hour' where store_id = ${p.storeId} and id = ${o.orderId}`;
  } finally {
    await db.end();
  }
}

/** *Collected* as `markCollected()` records it: a handover of every unit (method `pickup`, no carrier or tracking), the order's state, and the day of receipt. */
async function markCollected(p: Place, o: OrderFixture) {
  const db = testDb();
  try {
    await db.begin(async (tx) => {
      const [shipment] = await tx`
        insert into commerce.shipments (store_id, order_id, carrier, tracking_number, method) values (${p.storeId}, ${o.orderId}, '', '', 'pickup') returning id`;
      await tx`insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity) values (${p.storeId}, ${shipment.id}, ${o.lineId}, 2)`;
      await tx`select commerce.refresh_fulfilment(${p.storeId}::uuid, ${o.orderId}::uuid)`;
      await tx`update commerce.orders set delivered_at = now() where store_id = ${p.storeId} and id = ${o.orderId}`;
    });
  } finally {
    await db.end();
  }
}

const orderPage = (p: Place, o: OrderFixture) => `/s/${p.slug}/order/${o.orderId}?session_id=${o.key}`;

test("with a pickup place the cart says the delivery price is chosen at checkout, from the lowest price on offer", async ({ page }) => {
  const p = await storeWithPickup();
  await page.goto(`/s/${p.slug}/p/demo-notatbok`);
  await page.getByRole("button", { name: "Legg i handlekurven", disabled: false }).first().click();
  await expect(page.getByRole("link", { name: /Handlekurv \(1\)/ })).toBeVisible();

  await page.goto(`/s/${p.slug}/cart`);
  const summary = page.getByRole("complementary");
  // Collecting is free, so the cart cannot know the delivery price until the shopper chooses (CRD Art. 6(1)(e)): *From*, and where it is chosen.
  await expect(summary.locator("[data-delivery-price=from]")).toHaveText(/^Fra 0,00/);
  await expect(summary).toContainText("Velg levering i kassen.");
});

test("a pickup order says where to collect it, the hours and instructions it kept, then that it is ready, then collected", async ({ page }) => {
  const p = await storeWithPickup();
  const o = await paidPickupOrder(p);

  await page.goto(orderPage(p, o));
  const block = page.getByRole("region", { name: "Hentes hos Butikken på Løkka" });
  await expect(block).toBeVisible();
  await expect(block).toContainText("Butikken på Løkka, Thorvald Meyers gate 1, 0555 Oslo");
  await expect(block).toContainText("Vanligvis klar om 3 timer.");
  await expect(block.getByRole("heading", { name: "Åpningstider" })).toBeVisible();
  await expect(block).toContainText("Ring på ved bakdøra.");
  await expect(block).toContainText("Ta med ordrenummeret ditt.");
  // The summary's delivery row names the place; nothing was sent to an address.
  await expect(page.getByText("Hentes hos Butikken på Løkka").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leveres til" })).toHaveCount(0);
  expect(describeFindings(await violationsOn(page))).toEqual([]);

  await markReady(p, o);
  await page.reload();
  await expect(block).toContainText(/Klar til henting fra \d+\. \w+ \d{4}/);

  await markCollected(p, o);
  await page.reload();
  await expect(block).toContainText(/Hentet \d+\. \w+ \d{4}/);
  // Collected: the hours and instructions are no longer needed, and the handover is not listed as a parcel.
  await expect(block).not.toContainText("Ring på ved bakdøra.");
  await expect(page.locator("[data-parcel]")).toHaveCount(0);
});

test("a local delivery order shows its area, its information and the buyer's note for the driver", async ({ page }) => {
  const store = await testStore("lokal");
  const db = testDb();
  const number = `LO-${Date.now().toString(36).toUpperCase()}`;
  const key = `cs_e2e_${number.toLowerCase()}`;
  let orderId = "";
  try {
    const [area] = await db`
      insert into commerce.local_delivery_areas (store_id, market_code, currency, name, kind, patterns, amount_minor, info)
      values (${store.id}, 'NO', 'NOK', 'Oslo sentrum', 'postal', ${["01*", "05*"]}, 9900, 'Vi kjører ut mellom 16 og 20.')
      returning id`;
    // A paid local delivery as `placeOrder()` keeps one: the method, the area's snapshot and the buyer's note (only with method `local`).
    const address = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate, delivery_method, delivery, delivery_note)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', 50000, 9900, 0, 11980, 59900, ${address}, ${address}, 0.25,
        'local', ${db.json({ kind: "local", label: "Oslo sentrum", areaId: area.id, name: "Oslo sentrum", postalCode: "0182", info: "Vi kjører ut mellom 16 og 20." })},
        'Kode 1234, tredje etasje')
      returning id`;
    orderId = order.id;
    await db`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${`E2E-${number}`}, 'Ullgenser', 2, 25000, 0, 50000, 10000, 0.25, 'txcd_99999999', 'physical')`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${key}, 59900, 'NOK', 'captured')`;
  } finally {
    await db.end();
  }

  await page.goto(`/s/${store.slug}/order/${orderId}?session_id=${key}`);
  const block = page.getByRole("region", { name: "Lokal levering: Oslo sentrum" });
  await expect(block).toBeVisible();
  await expect(block).toContainText("Vi kjører ut mellom 16 og 20.");
  await expect(block.getByRole("heading", { name: "Din beskjed til sjåføren" })).toBeVisible();
  await expect(block).toContainText("Kode 1234, tredje etasje");
  // The summary's delivery row names the area, and the address is shown as for any delivery.
  await expect(page.getByText("Lokal levering: Oslo sentrum").first()).toBeVisible();
});
