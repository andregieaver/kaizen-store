import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Store templates (D175, docs/store-templates.md): the rules the database holds. A starter is a real store that never takes an order and
 * never stops being a starter; its description is a row of `store_starters`; `starter_source()` decides what a new store is copied from;
 * `clone_store()` brings a starter's operational set-up through `clone_starter_setup()`; approval copies the request's starter.
 */
let db: PGlite;
let template: string;
let owner: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function refused(sql: string, params: unknown[], reason: RegExp): Promise<void> {
  await expect(db.query(sql, params)).rejects.toThrow(reason);
}

async function createStore(slug: string): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name) values ($1, $1) returning id", [slug]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [id],
  );
  return id;
}

/** A starter made as the platform makes one: a copy of the template, marked, and described. */
async function createStarter(slug: string, published = false): Promise<{ store: string; starter: string }> {
  const { id: store } = await one<{ id: string }>("select commerce.clone_store(commerce.starter_source(null), $1, $1, $2) as id", [slug, owner]);
  await db.query("update commerce.stores set starter = true where id = $1", [store]);
  const { id: starter } = await one<{ id: string }>(
    "insert into commerce.store_starters (store_id, title, category, published) values ($1, $2, 'appointments', $3) returning id",
    [store, slug, published],
  );
  return { store, starter };
}

/** An order (status `pending_payment`), or a copied one (`paid`, history from another store) when `$3` names its original. */
const orderInsert = `insert into commerce.orders (store_id, number, market_code, currency, locale, email,
  subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from, status)
  values ($1, $2, 'NO', 'NOK', 'nb-NO', 'a@example.com', 1000, 0, 0, 200, 1000, '{}', '{}', $3::uuid,
    case when $3::uuid is null then 'pending_payment' else 'paid' end::commerce.order_status)`;

beforeAll(async () => {
  db = await createTestDatabase();
  template = await createStore("tpl-starters");
  await db.query("update commerce.stores set is_template = true where id = $1", [template]);
  ({ id: owner } = await one<{ id: string }>("insert into commerce.accounts (email) values ('platform@example.com') returning id"));
});

afterAll(async () => {
  await db.close();
});

describe("a store template's own rules (D175)", () => {
  it("is never also the template", async () => {
    const { store } = await createStarter("never-both");
    await refused("update commerce.stores set is_template = true where id = $1", [store], /stores_starter_not_template|stores_one_template/);
    await db.query("update commerce.stores set is_template = false where id = $1", [template]);
    await refused("update commerce.stores set is_template = true where id = $1", [store], /stores_starter_not_template/);
    await db.query("update commerce.stores set is_template = true where id = $1", [template]);
  });

  it("refuses every order, a copied one too, and is never open for jobs", async () => {
    const { store } = await createStarter("no-orders");
    await refused(orderInsert, [store, "1001", null], /orders\.store_starter/);
    await refused(orderInsert, [store, "C-1", crypto.randomUUID()], /orders\.store_starter/);
    expect((await one<{ open: boolean }>("select commerce.store_is_active($1) as open", [store])).open).toBe(false);
    expect((await one<{ open: boolean }>("select commerce.store_is_active($1) as open", [template])).open).toBe(true);
  });

  it("stays a starter, and only a store that never sold becomes one", async () => {
    const { store } = await createStarter("stays");
    await refused("update commerce.stores set starter = false where id = $1", [store], /stores\.starter_fixed/);
    const seller = await createStore("has-sold");
    await db.query(orderInsert, [seller, "1001", null]);
    await refused("update commerce.stores set starter = true where id = $1", [seller], /stores\.starter_has_sales/);
  });

  it("describes only a starter store, keeps its store, checks its fields and is never deleted", async () => {
    const plain = await createStore("plain-store");
    await refused("insert into commerce.store_starters (store_id, title, category) values ($1, 'X', 'other')", [plain], /store_starters\.not_starter/);
    const { store, starter } = await createStarter("described");
    await refused("insert into commerce.store_starters (store_id, title, category) values ($1, 'X', 'other')", [store], /store_starters_store_idx|duplicate/);
    await refused("update commerce.store_starters set store_id = $2 where id = $1", [starter, template], /store_starters\.(store_fixed|not_starter)/);
    await refused("update commerce.store_starters set category = 'spa' where id = $1", [starter], /store_starters_category/);
    await refused("update commerce.store_starters set title = '  ' where id = $1", [starter], /store_starters_title/);
    await refused("update commerce.store_starters set picture_url = 'javascript:alert(1)' where id = $1", [starter], /store_starters_picture_url/);
    await refused("update commerce.store_starters set picture_url = '//evil.example/x.png' where id = $1", [starter], /store_starters_picture_url/);
    await db.query("update commerce.store_starters set picture_url = '/media/spa.webp', summary = 'Spa' where id = $1", [starter]);
    await refused("delete from commerce.store_starters where id = $1", [starter], /store_starters\.kept/);
  });
});

describe("what a new store is copied from", () => {
  it("is the template without a choice, a published starter's store with one, and nothing else", async () => {
    expect((await one<{ id: string }>("select commerce.starter_source(null) as id")).id).toBe(template);
    const hidden = await createStarter("source-hidden");
    await refused("select commerce.starter_source($1)", [hidden.starter], /store_starters\.not_offered/);
    await refused("select commerce.starter_source($1)", [hidden.store], /store_starters\.not_offered/);
    await refused("select commerce.starter_source($1)", [template], /store_starters\.not_offered/);
    const shown = await createStarter("source-shown", true);
    expect((await one<{ id: string }>("select commerce.starter_source($1) as id", [shown.starter])).id).toBe(shown.store);
    await db.query("update commerce.stores set status = 'closed' where id = $1", [shown.store]);
    await refused("select commerce.starter_source($1)", [shown.starter], /store_starters\.not_offered/);
  });

  it("brings a starter's set-up, its drafts with their places, and never its own people", async () => {
    const spa = await createStarter("spa-source", true);
    await db.query(
      `update commerce.stores set modules = array['bookings'], time_zone = 'Europe/Stockholm', audience = 'both', terms_at_checkout = 'checkbox',
         open_cart_on_add = true, custom_css = '.a{}', tracking = '{"x": 1}', legal_name = 'Template AS' where id = $1`,
      [spa.store],
    );
    const { id: page } = await one<{ id: string }>(
      `insert into commerce.pages (store_id, type, slug, draft) values ($1, 'page', 'vilkar', '{"title": "Vilkår", "rows": []}') returning id`,
      [spa.store],
    );
    await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'terms', $2)", [spa.store, page]);
    await db.query("insert into commerce.order_settings (store_id, gift_messages, staff_mark_paid) values ($1, true, true)", [spa.store]);
    await db.query("insert into commerce.customer_tiers (store_id, name, percent) values ($1, 'Members', 10)", [spa.store]);
    await db.query("insert into commerce.store_currencies (store_id, currency, rate) values ($1, 'EUR', 0.085)", [spa.store]);
    await db.query("insert into commerce.customers (store_id, email) values ($1, 'preview@example.com')", [spa.store]);

    const { id: made } = await one<{ id: string }>("select commerce.clone_store(commerce.starter_source($1), 'from-spa', 'From spa', $2) as id", [
      spa.starter,
      owner,
    ]);
    const store = await one<Record<string, unknown>>(
      `select modules, time_zone, audience, terms_at_checkout, open_cart_on_add, custom_css, tracking, legal_name, starter, made_from_starter
       from commerce.stores where id = $1`,
      [made],
    );
    expect(store).toEqual({
      modules: ["bookings"],
      time_zone: "Europe/Stockholm",
      audience: "both",
      terms_at_checkout: "checkbox",
      open_cart_on_add: true,
      custom_css: ".a{}",
      tracking: {},
      legal_name: null,
      starter: false,
      made_from_starter: spa.starter,
    });
    const copied = await one<Record<string, unknown>>(
      `select
         (select p.published_at is null and r.role = 'terms' from commerce.pages p join commerce.page_roles r on r.page_id = p.id
           where p.store_id = $1 and p.slug = 'vilkar') as terms_draft,
         (select gift_messages from commerce.order_settings where store_id = $1) as gifts,
         (select staff_mark_paid from commerce.order_settings where store_id = $1) as staff_paid,
         (select count(*)::int from commerce.customer_tiers where store_id = $1) as tiers,
         (select count(*)::int from commerce.store_currencies where store_id = $1) as currencies,
         (select count(*)::int from commerce.customers where store_id = $1) as customers`,
      [made],
    );
    expect(copied).toEqual({ terms_draft: true, gifts: true, staff_paid: false, tiers: 1, currencies: 1, customers: 0 });
  });

  it("leaves a store copied from the template as it always was", async () => {
    await db.query("update commerce.stores set audience = 'businesses' where id = $1", [template]);
    const { id } = await one<{ id: string }>("select commerce.clone_store(commerce.starter_source(null), 'plain-copy', 'Plain', $1) as id", [owner]);
    expect(await one("select audience, made_from_starter from commerce.stores where id = $1", [id])).toEqual({ audience: "consumers", made_from_starter: null });
    await db.query("update commerce.stores set audience = 'consumers' where id = $1", [template]);
  });

  it("approves a request from the starter on it, and refuses one no longer offered", async () => {
    const spa = await createStarter("spa-approval", true);
    const { id: request } = await one<{ id: string }>(
      "insert into commerce.access_requests (email, name, store_name, starter_id) values ('new@example.com', 'New', 'New', $1) returning id",
      [spa.starter],
    );
    await db.query("update commerce.store_starters set published = false where id = $1", [spa.starter]);
    await refused("select commerce.approve_access_request($1, 'new-spa', 'New spa', null)", [request], /store_starters\.not_offered/);
    expect((await one<{ status: string }>("select status from commerce.access_requests where id = $1", [request])).status).toBe("pending");
    await db.query("update commerce.store_starters set published = true where id = $1", [spa.starter]);
    const { id } = await one<{ id: string }>("select commerce.approve_access_request($1, 'new-spa', 'New spa', null) as id", [request]);
    expect((await one<{ made_from_starter: string }>("select made_from_starter from commerce.stores where id = $1", [id])).made_from_starter).toBe(spa.starter);
  });
});
