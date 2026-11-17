import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { testDb } from "../db";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * An A/B test's guardrails and the sign-up goal (D148 phase 19, D712). A running test of a copy of the about page is seeded with 300
 * visitors in each version who started checkout, ten times as many of version B's with a failed payment: the owner reads that clearly more
 * payments fail in version B and finds every guardrail with its figures under the details (the speed comparison is
 * `experiments.int.test.ts`'s: whether a store counts visits is cached with the store). Kaizena Flow's own store offers sign-ups as its first goal, chosen, and an ordinary
 * store does not offer it at all. With `AB_SHOTS` set it keeps screenshots of what it looked at.
 */

const shots = process.env.AB_SHOTS;
const EXP = randomUUID();
let storeId = "";
let houseId = "";
let plansPage = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    // A page of its own, a copy of the about page, so this test never meets another spec's running test of the same page.
    const [about] = await sql`select published from commerce.pages where store_id = ${storeId} and slug = 'om-oss' and type = 'page'`;
    const own = `speed-${EXP.slice(0, 8)}`;
    const [page] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, type)
      values (${storeId}, ${own}, ${sql.json({ ...about.published, slug: own })}, ${sql.json({ ...about.published, slug: own })}, now(), 'page') returning id, published`;
    const slug = `ab-${EXP.slice(0, 8)}-b`;
    const [copy] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, type)
      values (${storeId}, ${slug}, ${sql.json({ ...page.published, slug })}, ${sql.json({ ...page.published, slug })}, now(), 'variant') returning id`;
    await sql`insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal) values (${EXP}, ${storeId}, 'Bigger pictures', ${page.id}, 'cart')`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${storeId}, ${EXP}, 'a', 'Original', null, 0.5), (${storeId}, ${EXP}, 'b', 'Version B', ${copy.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running', started_at = now() - interval '6 days' where id = ${EXP}`;
    // 300 visitors of each version saw it and started checkout; 6 of the original's had a payment fail, 60 of version B's, and none ordered.
    const visitor = sql`${EXP} || '-' || v.variant || '-' || i`;
    await sql`
      insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant)
      select ${storeId}, ${EXP}, ${visitor}, v.variant from (values ('a'), ('b')) v(variant), generate_series(1, 300) i`;
    await sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select ${storeId}, ${EXP}, ${visitor}, v.variant, 'checkout', '' from (values ('a'), ('b')) v(variant), generate_series(1, 300) i`;
    const [market] = await sql`select code as market_code, currency as native_currency, default_locale as locale from commerce.markets where store_id = ${storeId} and active order by created_at limit 1`;
    for (const [variant, failed] of [["a", 6], ["b", 60]] as const) {
      const cart = sql`md5(${EXP} || ${variant} || i)::uuid`;
      await sql`
        insert into commerce.carts (id, store_id, market_code, currency, locale, expires_at)
        select ${cart}, ${storeId}, ${market.market_code}, ${market.native_currency}, ${market.locale}, now() + interval '1 day' from generate_series(1, ${failed}) i`;
      await sql`
        insert into commerce.experiment_carts (store_id, cart_id, visitor)
        select ${storeId}, ${cart}, ${EXP} || '-' || ${variant} || '-' || i from generate_series(1, ${failed}) i`;
      const orders = await sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, cart_id, subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
        select ${storeId}, 'G-' || ${EXP.slice(0, 8)} || '-' || ${variant} || '-' || i, ${market.market_code}, ${market.native_currency}, ${market.locale}, 'guard@example.com',
          'cancelled', ${cart}, 10000, 0, 2000, 10000, '{}', '{}'
        from generate_series(1, ${failed}) i returning id`;
      await sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
        select ${storeId}, o, 'stripe', 'pi_' || md5(o::text), 10000, ${market.native_currency}, 'failed' from unnest(${sql.array(orders.map((o) => String(o.id)))}::uuid[]) o`;
    }

    // Kaizena Flow's own store, where only the platform's team works, with a published plans page for the sign-up goal.
    const [house] = await sql`select id from commerce.stores where house`;
    houseId = String(house.id);
    const content = { slug: "plans-ab", title: "Plans", rows: [{ id: "row-0", type: "row", layout: "1", columns: [{ id: "column-0", blocks: [{ id: "h", type: "heading", level: 1, text: "Plans" }] }] }] };
    const [plans] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, type)
      values (${houseId}, 'plans-ab', ${sql.json(content)}, ${sql.json(content)}, now(), 'page') returning id`;
    plansPage = String(plans.id);
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    // A test that has run is kept (a rule of the database): it ends discarded, so no running test is left on the page.
    await sql`update commerce.experiments set status = 'stopped', stopped_at = now() where id = ${EXP} and status = 'running'`;
    await sql`update commerce.experiments set status = 'discarded' where id = ${EXP}`;
    if (plansPage) await sql`delete from commerce.pages where id = ${plansPage} and store_id = ${houseId}`;
  } finally {
    await sql.end();
  }
});

test.describe("as the owner", () => {
  test.use({ storageState: OWNER.state });

  test("reads that clearly more payments fail in version B, and finds every guardrail with its figures", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/experiments/${EXP}`);
    await expect(page.getByText("Clearly more payments fail at checkout in version B than in the original.")).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/ab-guardrail-verdict.png` });
    await page.goto(`/admin/${E2E_STORE}/experiments/${EXP}#ab-guardrails`);
    const section = page.locator("#ab-guardrails");
    await expect(section.getByRole("heading", { name: "What keeps it safe" })).toBeVisible();
    const checkout = section.locator('tr[data-guardrail="checkout"]');
    await expect(checkout).toHaveAttribute("data-state", "worse");
    await expect(checkout).toContainText("Clearly worse in Version B");
    await expect(checkout).toContainText("60 of 300");
    await expect(section.locator('tr[data-guardrail="orders"]')).toContainText("Watching until each version has 1,000 visitors");
    await expect(section.locator('tr[data-guardrail="returns"]')).toContainText("Still coming in");
    if (shots) {
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: `${shots}/ab-guardrails.png` });
    }
  });

  test("is not offered sign-ups to Kaizena Flow on an ordinary store", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/experiments/new`);
    await expect(page.locator('[data-goal="orders"]')).toBeVisible();
    await expect(page.locator('[data-goal="signup"]')).toHaveCount(0);
  });
});

test.describe("as the platform admin, in Kaizena Flow's own store", () => {
  test.use({ storageState: ADMIN.state });

  test("is offered sign-ups first, chosen, and no goals of a shop that sells goods", async ({ page }) => {
    await page.goto("/admin/kaizenaflow/experiments/new");
    const signup = page.locator('[data-goal="signup"]');
    await expect(signup).toContainText("More sign-ups to Kaizena Flow");
    await expect(signup.getByRole("radio")).toBeChecked();
    await expect(page.locator('[data-goal="orders"]')).toHaveCount(0);
    if (shots) await page.screenshot({ path: `${shots}/ab-signup-goal.png`, fullPage: true });
  });
});
