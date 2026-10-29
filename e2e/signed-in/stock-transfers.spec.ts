import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * Locations and a stock transfer in a browser (wave 11 unit D, D383; row catalogue.inventory-transfers-and-purchase-orders). The rules are held by
 * stock-documents.int.test.ts; this holds the screens as an owner uses them: the Locations page's online switch, and a transfer made from a SKU,
 * sent and counted in, with the stock where it went.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-transfers";
const SKU = "DEMO-TOTE";
const SECOND = "Bergen e2e";

const levels = async () => {
  const sql = testDb();
  try {
    const rows = await sql`
      select loc.name, l.on_hand from commerce.inventory_levels l
      join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
      join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      join commerce.stores s on s.id = l.store_id
      where s.slug = ${STORE} and v.sku = ${SKU}`;
    return Object.fromEntries(rows.map((r) => [String(r.name), Number(r.on_hand)]));
  } finally {
    await sql.end();
  }
};

let main = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Transfers') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Transfers', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const [first] = await sql`select id, name from commerce.inventory_locations where store_id = ${store.id} and active order by priority, created_at limit 1`;
    main = String(first.name);
    let [second] = await sql`select id from commerce.inventory_locations where store_id = ${store.id} and name = ${SECOND} and active`;
    if (!second) [second] = await sql`insert into commerce.inventory_locations (store_id, name, country, priority) values (${store.id}, ${SECOND}, 'NO', 50) returning id`;
    await sql`update commerce.inventory_locations set fulfils_online = true where store_id = ${store.id}`;
    const [variant] = await sql`select id from commerce.product_variants where store_id = ${store.id} and sku = ${SKU}`;
    for (const [location, onHand] of [[first.id, 10], [second.id, 0]] as const) {
      await sql`
        insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${store.id}, ${variant.id}, ${location}, ${onHand})
        on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand`;
    }
  } finally {
    await sql.end();
  }
});

test("the owner keeps a location out of online orders and takes it back", async ({ page }) => {
  await page.goto(`/admin/${STORE}/inventory/locations`);
  await expect(page.getByRole("heading", { level: 1, name: "Stock locations" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: SECOND });
  await expect(row).toContainText("Takes online orders");
  await row.getByRole("button", { name: `Stop online orders from ${SECOND}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `${SECOND} no longer takes online orders.` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: SECOND })).toContainText("Not for online orders");
  await page.getByRole("row").filter({ hasText: SECOND }).getByRole("button", { name: `Take online orders from ${SECOND}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `${SECOND} takes online orders again.` })).toBeVisible();
});

test("a transfer is made from a SKU, sent and counted in, and the stock moves with it", async ({ page }) => {
  await page.goto(`/admin/${STORE}/inventory/transfers`);
  await expect(page.getByRole("heading", { level: 1, name: "Stock transfers" })).toBeVisible();
  const form = page.getByRole("form", { name: "New transfer" });
  await form.getByLabel("From", { exact: true }).selectOption({ label: main });
  await form.getByLabel("To", { exact: true }).selectOption({ label: SECOND });
  await form.getByLabel("SKU", { exact: true }).fill(SKU);
  await form.getByLabel("Units", { exact: true }).fill("3");
  await form.getByRole("button", { name: "Save as a draft" }).click();

  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/inventory/transfers/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Stock transfer: ${main} → ${SECOND}` })).toBeVisible();
  // A draft moves nothing.
  expect((await levels())[main]).toBe(10);

  await page.getByRole("button", { name: "Send it" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sent." })).toBeVisible();
  await expect.poll(async () => (await levels())[main]).toBe(7);

  await page.getByRole("spinbutton", { name: `Count in: ${SKU}` }).fill("3");
  await page.getByRole("button", { name: "Count them in" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 units counted in." })).toBeVisible();
  await expect(page.getByText("Everything has arrived.")).toBeVisible();
  expect(await levels()).toMatchObject({ [main]: 7, [SECOND]: 3 });
});
