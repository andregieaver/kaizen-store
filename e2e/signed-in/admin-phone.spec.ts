import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The admin on a phone (D568; row platform.mobile-admin-app, criterion 4): at 390 px wide an owner opens the orders list, one order, the
 * products, the inventory and the team, and nothing on them scrolls the page sideways or is cut off at the screen's edge. The orders list
 * shows each order's number, customer, payment and sending under it and its total; an order's items show their quantity and total.
 */

test.use({ storageState: OWNER.state, viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-phone";
const NUMBER = `PHONE-${Date.now().toString(36).toUpperCase()}`;
let orderId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Phone') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Phone', null)`;
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
    const [variant] = await sql`
      select v.id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
       where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' order by v.sku limit 1`;
    await sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${variant.id}, ${`${NUMBER}-G`}, 'Ullgenser i merinoull, håndstrikket', 3, 50000, 0, 150000, 30000, 0.25, 'txcd_99999999', 'physical')`;
    await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${`cs_e2e_${NUMBER.toLowerCase()}`}, 150000, 'NOK', 'captured')`;
  } finally {
    await sql.end();
  }
});

/** The page is no wider than the screen, and no element of its main part reaches past the screen's edge outside a box that scrolls. */
async function fitsThePhone(page: Page) {
  await page.waitForLoadState("networkidle");
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const cut: string[] = [];
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      let inside = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") {
          inside = true;
          break;
        }
      }
      if (!inside) cut.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
    }
    return { page: document.documentElement.scrollWidth, screen: vw, cut: cut.slice(0, 5) };
  });
  expect(report.cut, "past the screen's edge").toEqual([]);
  expect(report.page, "the page's width").toBeLessThanOrEqual(report.screen);
}

test("the orders list shows each order's number, customer, states and total on a phone", async ({ page }) => {
  await page.goto(`/admin/${STORE}/orders`);
  const row = page.getByRole("row").filter({ hasText: `#${NUMBER}` });
  await expect(row).toContainText("Kari Nordmann");
  await expect(row).toContainText("Paid");
  await expect(row.getByText("1 500,00 kr")).toBeVisible();
  await fitsThePhone(page);
});

test("an order shows its items' quantity and total without scrolling sideways", async ({ page }) => {
  await page.goto(`/admin/${STORE}/orders/${orderId}`);
  const items = page.getByRole("region", { name: "Items" });
  const line = items.getByRole("row").filter({ hasText: "Ullgenser i merinoull" });
  await expect(line.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  // Scrolled down to, the line's total is whole on the screen: its column is not past the edge.
  await line.getByText("1 500,00 kr").scrollIntoViewIfNeeded();
  await expect(line.getByText("1 500,00 kr")).toBeInViewport({ ratio: 1 });
  await fitsThePhone(page);
});

test("the products, the inventory and the team fit the phone", async ({ page }) => {
  for (const path of ["products", "inventory", "staff"]) {
    await page.goto(`/admin/${STORE}/${path}`);
    await fitsThePhone(page);
  }
});
