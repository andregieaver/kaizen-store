import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Shipping settings and the handover buttons (wave 3, D237, `docs/wave-3-shipping-methods.md`) as two people see them: the owner saves a
 * country's flat rate and adds a shipping method with a flat price through the method editor; a pickup order is marked collected and a
 * local-delivery order out for delivery from the order page; the Read-only member sees the same pages with nothing to press. The pricing,
 * zones, profiles and handovers themselves are held by the shipping-methods and pickup integration tests.
 */

const METHOD = "E2E Express";
const settings = `/admin/${E2E_STORE}/settings/shipping`;

type Kind = "pickup" | "local";

/** A paid order of one demo product in Norway, to be collected at one of the store's places or delivered by its own driver. */
async function paidOrder(kind: Kind): Promise<string> {
  const db = testDb();
  try {
    const [store] = await db`select id from commerce.stores where slug = ${E2E_STORE}`;
    const [owner] = await db`select account_id from commerce.store_members where store_id = ${store.id} and role = 'owner' limit 1`;
    const [variant] = await db`
      select v.id, v.sku from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' and p.status = 'active' and v.active order by v.sku limit 1`;
    const [place] = await db`select id from commerce.inventory_locations where store_id = ${store.id} and active order by priority, created_at limit 1`;
    const number = `XH-${kind === "pickup" ? "P" : "L"}-${Date.now().toString(36).toUpperCase()}`;
    const address = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO", phone: "+4790000000" });
    const delivery =
      kind === "pickup"
        ? { kind: "pickup", label: "Pickup in the shop", locationId: String(place.id), name: "The shop", street: "Storgata 1", postalCode: "0182", city: "Oslo", country: "NO", hours: null, instructions: "Ask at the counter.", readyInHours: 2 }
        : { kind: "local", label: "Local delivery", areaId: "00000000-0000-4000-8000-000000000002", name: "Oslo centre", postalCode: "0182", info: "" };
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate, return_cost_payer, delivery_method, pickup_location_id, delivery)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', 59900, 0, 0, 11980, 59900, ${address}, ${address}, 0.25, 'shopper',
        ${kind}, ${kind === "pickup" ? place.id : null}, ${db.json(delivery)})
      returning id`;
    await db`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${variant.id}, ${variant.sku}, 'Ullgenser – S', 1, 59900, 0, 59900, 11980, 0.25, 'txcd_99999999', 'physical')`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method, recorded_by, received_on)
      values (${store.id}, ${order.id}, 'manual', ${`manual_${number}`}, 59900, 'NOK', 'captured', 'bank_transfer', ${owner.account_id}, current_date)`;
    return String(order.id);
  } finally {
    await db.end();
  }
}

async function flatRate(): Promise<{ amount: number | null; free: number | null }> {
  const db = testDb();
  try {
    const [row] = await db`
      select r.amount_minor, r.free_over_minor from commerce.shipping_rates r join commerce.stores s on s.id = r.store_id
      where s.slug = ${E2E_STORE} and r.market_code = 'NO'`;
    return { amount: row ? Number(row.amount_minor) : null, free: row?.free_over_minor == null ? null : Number(row.free_over_minor) };
  } finally {
    await db.end();
  }
}

let before: { amount: number | null; free: number | null };

test.beforeAll(async () => {
  before = await flatRate();
  const db = testDb();
  try {
    const [store] = await db`select id from commerce.stores where slug = ${E2E_STORE}`;
    await db`delete from commerce.shipping_method_rates where method_id in (select id from commerce.shipping_methods where name = ${METHOD} and store_id = ${store.id})`;
    await db`delete from commerce.shipping_methods where name = ${METHOD} and store_id = ${store.id}`;
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = testDb();
  try {
    const [store] = await db`select id from commerce.stores where slug = ${E2E_STORE}`;
    await db`delete from commerce.shipping_method_rates where method_id in (select id from commerce.shipping_methods where name = ${METHOD} and store_id = ${store.id})`;
    await db`delete from commerce.shipping_methods where name = ${METHOD} and store_id = ${store.id}`;
    if (before.amount !== null) {
      await db`update commerce.shipping_rates set amount_minor = ${before.amount}, free_over_minor = ${before.free} where store_id = ${store.id} and market_code = 'NO'`;
    }
  } finally {
    await db.end();
  }
});

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("saves a country's flat rate and adds a shipping method with a flat price", async ({ page }) => {
    await page.goto(settings);
    await expect(page.getByRole("heading", { level: 1, name: "Shipping" })).toBeVisible();
    await page.getByLabel(/^Shipping price to .*, NOK$/).fill("79");
    await page.getByLabel(/^Free shipping to .* from, NOK$/).fill("");
    await page.getByRole("button", { name: "Save flat rates" }).click();
    await expect.poll(flatRate).toEqual({ amount: 7900, free: null });

    await page.goto(`${settings}/methods?market=NO`);
    await page.getByRole("link", { name: "Add a method" }).click();
    await page.getByLabel("Name, as shoppers see it").fill(METHOD);
    await page.getByLabel("How General is priced").first().selectOption("flat");
    await page.getByLabel(/^Price \(NOK\)$/).first().fill("129");
    await page.getByRole("button", { name: "Add method" }).click();
    await page.waitForURL(/\/settings\/shipping\/methods\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("button", { name: "Save method" })).toBeVisible();

    await page.goto(`${settings}/methods?market=NO`);
    await expect(page.getByRole("list", { name: /^Methods in / }).getByText(METHOD)).toBeVisible();
    const db = testDb();
    try {
      const [rate] = await db`
        select r.basis, r.amount_minor from commerce.shipping_method_rates r join commerce.shipping_methods m on m.id = r.method_id
        join commerce.stores s on s.id = m.store_id where s.slug = ${E2E_STORE} and m.name = ${METHOD}`;
      expect({ basis: rate?.basis, amount: Number(rate?.amount_minor) }).toEqual({ basis: "flat", amount: 12900 });
    } finally {
      await db.end();
    }
  });

  test("marks a pickup order collected and a local-delivery order out for delivery", async ({ page }) => {
    const pickup = await paidOrder("pickup");
    await page.goto(`/admin/${E2E_STORE}/orders/${pickup}`);
    const handover = page.locator("section[aria-labelledby=handover]");
    await expect(handover.getByRole("heading", { name: "Pickup" })).toBeVisible();
    await expect(handover.getByText("Collect at The shop")).toBeVisible();
    // The form goes once the order is collected, so what the page then says is the answer.
    await handover.getByRole("button", { name: "Collected" }).click();
    await expect(handover.getByText(/^Collected on \d{4}-\d{2}-\d{2}\.$/)).toBeVisible();

    const local = await paidOrder("local");
    await page.goto(`/admin/${E2E_STORE}/orders/${local}`);
    const section = page.locator("section[aria-labelledby=handover]");
    await expect(section.getByRole("heading", { name: "Local delivery" })).toBeVisible();
    await section.getByRole("button", { name: "Out for delivery" }).click();
    await expect(section.getByText(/^Out for delivery /)).toBeVisible();

    const db = testDb();
    try {
      const rows = await db`select id, status, delivered_at from commerce.orders where id in (${pickup}, ${local})`;
      const byId = Object.fromEntries(rows.map((r) => [String(r.id), r]));
      expect(byId[pickup]).toMatchObject({ status: "fulfilled" });
      expect(byId[pickup].delivered_at).not.toBeNull();
      expect(byId[local]).toMatchObject({ status: "fulfilled", delivered_at: null });
    } finally {
      await db.end();
    }
  });
});

test.describe("the Read-only member", () => {
  test.use({ storageState: READER.state });

  test("sees the shipping settings and a pickup order with nothing to change", async ({ page }) => {
    await page.goto(settings);
    await expect(page.getByRole("heading", { level: 1, name: "Shipping" })).toBeVisible();
    await expect(page.getByLabel(/^Shipping price to .*, NOK$/)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save flat rates" })).toHaveCount(0);
    await page.goto(`${settings}/methods?market=NO`);
    await expect(page.getByRole("link", { name: "Add a method" })).toHaveCount(0);

    const pickup = await paidOrder("pickup");
    await page.goto(`/admin/${E2E_STORE}/orders/${pickup}`);
    const handover = page.locator("section[aria-labelledby=handover]");
    await expect(handover.getByRole("heading", { name: "Pickup" })).toBeVisible();
    await expect(handover.getByRole("button")).toHaveCount(0);
  });
});
