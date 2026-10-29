import { expect, test } from "@playwright/test";

import { testDb } from "./db";
import { paidGoodsOrder } from "./fulfilment-fixtures";

/**
 * Pre-orders (wave 12 unit B, D396, `docs/wave-12-after-the-core.md` B). A store of its own (the template store is no real store) whose demo
 * thermos keeps selling at zero and is put on pre-order until a release date: its card, the product page, its structured data and the cart say so in
 * the market's language, with the date and never "in stock", "sold out" or a number of days. The order page says it for a line sold
 * on pre-order (the order is made with SQL, `fulfilment-fixtures.ts`); placing one is held by `checkout-kinds.int.test.ts` and the Orders list by
 * `order-list.int.test.ts`.
 */

const STORE = "e2e-preorder";
const RUN = Date.now().toString(36);
// The store sells in one country, so its addresses carry none (D181).
const THERMOS = `/s/${STORE}/p/demo-termokopp`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = testDb();
  try {
    if ((await sql`select 1 from commerce.stores where slug = ${STORE}`).length === 0) {
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`preorder-${RUN}@example.com`}, 'E2E', 'E2E Pre-order') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Pre-order', null)`;
    }
    const [store] = await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active' where slug = ${STORE} returning id`;
    await sql`
      update commerce.product_variants v set stock_policy = 'continue', backorder_days = coalesce(v.backorder_days, 7), preorder_until = '2099-06-01'
      from commerce.products p where p.store_id = v.store_id and p.id = v.product_id and v.store_id = ${store.id} and p.handle = 'demo-termokopp'`;
  } finally {
    await sql.end();
  }
});

const offers = async (page: import("@playwright/test").Page): Promise<string[]> => {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((text) => [...text.matchAll(/"availability":"([^"]+)"/g)].map((match) => match[1]));
};

test("its card in the store's products says so with the date", async ({ page }) => {
  await page.goto(`/s/${STORE}/products`);
  const card = page.locator("li").filter({ hasText: "Termokopp" }).filter({ visible: true }).first();
  await expect(card.getByText("Forhåndsbestilling: forventes sendt fra 1. juni 2099")).toBeVisible();
});

test("a variant on pre-order says so with its date on the product page, in its structured data and in the cart", async ({ page }) => {
  await page.goto(THERMOS);
  await expect(page.getByText("Forhåndsbestilling: forventes sendt fra 1. juni 2099").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/restordre|Utsolgt|På lager/).filter({ visible: true })).toHaveCount(0);
  await expect.poll(() => offers(page)).toEqual(["https://schema.org/PreOrder"]);

  await page.getByRole("button", { name: "Legg i handlekurven", disabled: false }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." }).first()).toBeVisible();

  await page.goto(`/s/${STORE}/cart`);
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  await expect(page.getByText("1 forhåndsbestilt: forventes sendt fra 1. juni 2099").filter({ visible: true })).toBeVisible();
  await expect(page.getByText(/restordre/).filter({ visible: true })).toHaveCount(0);
});

test("the order page says which units wait for the release date", async ({ page }) => {
  const f = await paidGoodsOrder();
  const sql = testDb();
  try {
    await sql`update commerce.order_lines set preorder_until = '2099-06-01' where id = ${f.lines.sweater}`;
  } finally {
    await sql.end();
  }
  await page.goto(`/s/${f.slug}/no/order/${f.orderId}?session_id=${f.key}`);
  await expect(page.getByText("3 av 3 forhåndsbestilt: forventes sendt fra 1. juni 2099").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/forhåndsbestilt/).filter({ visible: true })).toHaveCount(1);
});
