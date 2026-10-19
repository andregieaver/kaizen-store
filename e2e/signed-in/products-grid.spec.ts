import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The bulk grid as the owner uses it (wave 2, D165; row catalogue.bulk-editing, criterion 2): open the chosen products' variants
 * as a table, change a SKU, a price and a cost, review every changed cell before and after, apply, and undo. The server side
 * (conflicts, limits, invalid cells, the audit entry) is held by bulk-edit.int.test.ts; this holds the screen that drives it.
 */

test.use({ storageState: OWNER.state });

/** A store of the owner's own, so no other spec changes these products while the grid is open (products-bulk.spec.ts lowers prices in the shared one). */
const STORE = "e2e-grid";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Grid') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Grid', null)`;
    }
  } finally {
    await sql.end();
  }
});

type Variant = { productId: string; variantId: string; title: string; sku: string; price: number; cost: number | null };

async function variants(productIds: string[]): Promise<Variant[]> {
  const sql = testDb();
  try {
    const rows = await sql<{ product_id: string; variant_id: string; title: string; sku: string; price: number; cost: number | null }[]>`
      select p.id as product_id, v.id as variant_id, t.title, v.sku, cp.amount_minor::int as price, v.cost_minor::int as cost
        from commerce.products p
        join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
        join commerce.product_variants v on v.product_id = p.id
        join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = 'NO'
       where p.id = any(${productIds})
       order by p.handle`;
    return rows.map((r) => ({ productId: r.product_id, variantId: r.variant_id, title: r.title, sku: r.sku, price: r.price, cost: r.cost }));
  } finally {
    await sql.end();
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("edits a SKU, a price and a cost in the grid, reviews each change before and after, applies it and undoes it", async ({ page }) => {
  // Two goods with one active variant each and a Norwegian price, so each row is one product.
  const sql = testDb();
  const chosen = await sql<{ id: string }[]>`
    select p.id from commerce.products p
      join commerce.stores s on s.id = p.store_id and s.slug = ${STORE}
     where p.kind = 'goods' and p.status = 'active'
       and (select count(*) from commerce.product_variants v where v.product_id = p.id) = 1
       and exists (select 1 from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id
                    where v.product_id = p.id and cp.market_code = 'NO')
     order by p.handle desc limit 2`;
  await sql.end();
  expect(chosen).toHaveLength(2);
  const before = await variants(chosen.map((c) => c.id));
  const [a, b] = before;

  await page.goto(`/admin/${STORE}/products/bulk?ids=${chosen.map((c) => c.id).join(",")}&markets=NO`);
  await expect(page.getByRole("heading", { name: "Edit products in a grid" })).toBeVisible();

  const newSku = `GRID-${Date.now().toString(36)}`.toUpperCase();
  await page.getByLabel(new RegExp(`^SKU, ${escape(a.title)}`)).fill(newSku);
  await page.getByLabel(new RegExp(`^Price NO, ${escape(b.title)}`)).fill("123");
  await page.getByLabel(new RegExp(`^Cost, ${escape(b.title)}`)).fill("45");

  // Nothing is written while editing: the cells stay in the browser until the review.
  expect(await variants(chosen.map((c) => c.id))).toEqual(before);

  await page.getByRole("button", { name: "Review changes (3)" }).click();
  const review = page.getByRole("region", { name: "Review" });
  await expect(review.getByRole("heading", { name: "3 changes in 2 products and 2 variants" })).toBeVisible();
  const changes = review.getByRole("table");
  await expect(changes.getByRole("row").filter({ hasText: a.title }).filter({ hasText: newSku })).toHaveCount(1);
  await expect(changes.getByRole("row").filter({ hasText: b.title }).filter({ hasText: /123/ })).toHaveCount(1);
  await expect(changes.getByRole("row").filter({ hasText: b.title }).filter({ hasText: /45/ })).toHaveCount(1);
  expect(await variants(chosen.map((c) => c.id))).toEqual(before);

  await review.getByRole("button", { name: "Apply" }).click();
  const result = page.getByRole("region", { name: "Result" });
  await expect(result.getByText("2 products: 2 changed, 0 left as they were, 0 failed.")).toBeVisible();
  const applied = await variants(chosen.map((c) => c.id));
  expect(applied.find((v) => v.variantId === a.variantId)?.sku).toBe(newSku);
  expect(applied.find((v) => v.variantId === b.variantId)).toMatchObject({ price: 12300, cost: 4500 });

  // The price went through commerce.set_price, so it has a new entry in the price history.
  const history = testDb();
  const entries = await history<{ n: number }[]>`
    select count(*)::int as n from commerce.prices where variant_id = ${b.variantId} and market_code = 'NO' and amount_minor = 12300`;
  await history.end();
  expect(entries[0].n).toBeGreaterThan(0);

  await result.getByRole("button", { name: "Undo this change" }).click();
  await expect(result.getByRole("status").filter({ hasText: /^Put back 3 changes/ })).toBeVisible();
  expect(await variants(chosen.map((c) => c.id))).toEqual(before);
});
