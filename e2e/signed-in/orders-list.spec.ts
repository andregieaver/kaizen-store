import { expect, type Page, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The Orders page as the owner uses it (wave 3, D173; row orders.order-list-search-filters-saved-views-bulk): search, page through
 * more orders than fit on a page, filter from the bar, save the list as a view and open it again, and act on many orders at once,
 * on a page and on "all matching". The conditions, the paging and the bulk rules are held by the order-list, order-views and
 * order-bulk integration tests; this holds the screen that drives them.
 */

test.use({ storageState: OWNER.state });

/** A store of the owner's own, so the orders and the variants they name are no other spec's (theme-switch.spec.ts reads the shared store's products). */
const STORE = "e2e-orders";
test.setTimeout(180_000);

const RUN = Date.now().toString(36);
const MARK = `ol${RUN}`;
const ORDERS = 60;
const TO_SEND = 7;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Orders') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Orders', null)`;
    }
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const address = sql.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    // One of the store's own goods variants for the parcels: a line is sent only when it names its variant.
    const [variant] = await sql`
      select v.id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
       where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' order by v.sku limit 1`;
    for (let i = 0; i < ORDERS; i++) {
      // The first seven have a parcel to send; the rest are downloads, with nothing to ship.
      const physical = i < TO_SEND;
      const number = `${MARK.toUpperCase()}-${String(i).padStart(2, "0")}`;
      const [order] = await sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
          billing_address, shipping_address, shipping_tax_rate)
        values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', ${`${MARK}-${i}@example.com`}, 'paid', 50000, 0, 0, 10000, 50000, ${address}, ${address}, 0.25)
        returning id`;
      await sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${store.id}, ${order.id}, ${physical ? variant.id : null}, ${`SKU-${number}`}, ${physical ? "Ullgenser" : "Strikkeoppskrift"}, 1, 50000, 0, 50000, 10000, 0.25, 'txcd_99999999', ${physical ? "physical" : "digital"})`;
      await sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
        values (${store.id}, ${order.id}, 'stripe', ${`cs_e2e_${number.toLowerCase()}`}, 50000, 'NOK', 'captured')`;
    }
  } finally {
    await sql.end();
  }
});

/** The order numbers the table shows, read from each row's tick box. */
async function numbersShown(page: Page): Promise<string[]> {
  const boxes = page.getByRole("checkbox", { name: new RegExp(`^Select order ${MARK.toUpperCase()}-`) });
  const labels = await boxes.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  return labels.map((label) => label.replace("Select order ", ""));
}

async function ordersOfRun<T extends Record<string, unknown>>(query: (sql: ReturnType<typeof testDb>) => Promise<T[]>): Promise<T[]> {
  const sql = testDb();
  try {
    return await query(sql);
  } finally {
    await sql.end();
  }
}

test("searches, pages, filters, saves a view and acts on many orders at once", async ({ page }) => {
  // Search: the run's orders, 50 on the first page and the other 10 behind *Next*, none lost or repeated.
  await page.goto(`/admin/${STORE}/orders`);
  const search = page.getByRole("search", { name: "Search and filter the orders" });
  await search.getByLabel("Search").fill(MARK);
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(`${ORDERS} orders`, { exact: true })).toBeVisible();
  const first = await numbersShown(page);
  expect(first).toHaveLength(50);

  const pages = page.getByRole("navigation", { name: "Pages" });
  await pages.getByRole("link", { name: "Next 50 orders" }).click();
  await expect(pages.getByRole("link", { name: "Back to the first page" })).toBeVisible();
  const second = await numbersShown(page);
  expect(second).toHaveLength(ORDERS - 50);
  expect(new Set([...first, ...second]).size).toBe(ORDERS);

  // A filter from the bar: only the orders with a parcel to send, said in a chip that takes it away again.
  await page.getByText("Filters, sorting and columns").click();
  await search.getByRole("checkbox", { name: "To send", exact: true }).check();
  await search.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(`${TO_SEND} orders`, { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Filters that are on" }).getByRole("link", { name: /^Remove filter: / }).first()).toBeVisible();
  expect((await numbersShown(page)).sort()).toEqual(Array.from({ length: TO_SEND }, (_, i) => `${MARK.toUpperCase()}-${String(i).padStart(2, "0")}`));
  const filtered = page.url();

  // Saved as a view, which opens the same list from the view bar.
  const title = `To send ${RUN}`;
  await page.getByText("Save this list as a view").click();
  await page.getByLabel(/^Name of the view/).fill(title);
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByRole("status").filter({ hasText: title })).toBeVisible();
  await page.goto(`/admin/${STORE}/orders`);
  await page.getByRole("navigation", { name: "Order views" }).getByRole("link", { name: title }).click();
  await expect(page.getByText(`${TO_SEND} orders`, { exact: true })).toBeVisible();

  // On the page: tick them all, tag them, then mark them sent without emailing anyone.
  await page.goto(filtered);
  await page.getByRole("checkbox", { name: "Select all orders on this page" }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar.getByText(`${TO_SEND} orders selected`)).toBeVisible();
  const tag = `bulk${RUN}`;
  await bar.getByLabel(/^Tags/).fill(tag);
  await bar.getByRole("button", { name: "Add tags" }).click();
  const result = page.getByRole("status", { name: "Result of the bulk action" });
  await expect(result.getByText(`Applied to ${TO_SEND} of ${TO_SEND} orders`)).toBeVisible();
  const tagged = await ordersOfRun((sql) => sql`
    select count(distinct t.order_id)::int as n from commerce.order_tags t join commerce.orders o on o.id = t.order_id
     where o.number like ${`${MARK.toUpperCase()}-%`} and t.label = ${tag}`);
  expect(tagged[0].n).toBe(TO_SEND);

  await page.getByRole("checkbox", { name: "Select all orders on this page" }).check();
  await bar.getByRole("button", { name: "Mark as sent" }).click();
  const confirm = bar.getByRole("group", { name: "Confirm mark as sent" });
  await confirm.getByRole("checkbox", { name: "Tell the customers" }).uncheck();
  await expect(confirm.getByText("No emails are sent.")).toBeVisible();
  await confirm.getByRole("button", { name: "Mark as sent" }).click();
  // Every order of this list was sent, so the list of orders to send is empty now.
  await expect(page.getByText(`No order matches “${MARK}” with these filters.`)).toBeVisible();
  const sent = await ordersOfRun((sql) => sql`
    select count(*)::int as n from commerce.orders o
     where o.number like ${`${MARK.toUpperCase()}-%`} and o.status = 'fulfilled'
       and exists (select 1 from commerce.shipments sh where sh.order_id = o.id and sh.undone_at is null)`);
  expect(sent[0].n).toBe(TO_SEND);

  // All matching: the whole search, beyond the page, archived in one press and gone from the list.
  await page.goto(`/admin/${STORE}/orders?q=${MARK}`);
  await page.getByRole("checkbox", { name: "Select all orders on this page" }).check();
  await page.getByRole("button", { name: `Select all ${ORDERS} matching` }).click();
  await expect(page.getByText(`All ${ORDERS} matching orders are selected.`)).toBeVisible();
  await bar.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(result.getByText(`Applied to ${ORDERS} of ${ORDERS} orders`)).toBeVisible();
  const archived = await ordersOfRun((sql) => sql`
    select count(*)::int as n from commerce.orders where number like ${`${MARK.toUpperCase()}-%`} and archived_at is not null`);
  expect(archived[0].n).toBe(ORDERS);
  // Archived orders leave the list (a search still finds them, as an order is looked up by its number whatever its state).
  await page.goto(`/admin/${STORE}/orders`);
  await expect(page.getByRole("checkbox", { name: new RegExp(`^Select order ${MARK.toUpperCase()}-`) })).toHaveCount(0);
  await page.goto(`/admin/${STORE}/orders?q=${MARK}`);
  await expect(page.getByText(`${ORDERS} orders`, { exact: true })).toBeVisible();
});
