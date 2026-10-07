import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Store templates (D175, D177, docs/store-templates.md): the rules the database holds. A starter is a real store that never takes an order
 * and never stops being a starter; its description is a row of `store_starters`, deleted only while unused; `starter_source()` decides what a
 * new store is copied from (D177: the frozen copy `freeze_starter()` made when it was published); `clone_store()` brings a starter's
 * operational set-up through `clone_starter_setup()`; approval copies the request's starter while it is offered, else the Standard store.
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

  it("describes only a starter store, keeps its store and checks its fields", async () => {
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

  it("approves a request from the starter on it, and from the Standard store once that starter is no longer offered (D177)", async () => {
    const spa = await createStarter("spa-approval", true);
    const request = async (email: string) =>
      (
        await one<{ id: string }>(
          "insert into commerce.access_requests (email, name, store_name, starter_id) values ($1, 'New', 'New', $2) returning id",
          [email, spa.starter],
        )
      ).id;
    const first = await request("new@example.com");
    const { id } = await one<{ id: string }>("select commerce.approve_access_request($1, 'new-spa', 'New spa', null) as id", [first]);
    expect((await one<{ made_from_starter: string }>("select made_from_starter from commerce.stores where id = $1", [id])).made_from_starter).toBe(spa.starter);

    const second = await request("later@example.com");
    await db.query("update commerce.store_starters set published = false where id = $1", [spa.starter]);
    const { id: fallback } = await one<{ id: string }>("select commerce.approve_access_request($1, 'later-spa', 'Later', null) as id", [second]);
    expect(await one("select made_from_starter, modules from commerce.stores where id = $1", [fallback])).toEqual({ made_from_starter: null, modules: [] });
    const audit = await one<{ details: { starterFallback: boolean; starter: string } }>(
      "select details from commerce.audit_log where action = 'platform.access_approved' and store_id = $1",
      [fallback],
    );
    expect(audit.details).toMatchObject({ starterFallback: true, starter: spa.starter });
    // The request still says what was asked for.
    expect((await one<{ starter_id: string }>("select starter_id from commerce.access_requests where id = $1", [second])).starter_id).toBe(spa.starter);
    await db.query("update commerce.store_starters set published = true where id = $1", [spa.starter]);
  });
});

describe("publishing, archiving and deleting a store template (D177)", () => {
  it("freezes its store into a hidden copy that new stores are made from; a later publish closes the copy it replaces", async () => {
    const spa = await createStarter("frozen-spa");
    await db.query("update commerce.stores set audience = 'both' where id = $1", [spa.store]);
    const { id: copy } = await one<{ id: string }>("select commerce.freeze_starter($1, $2) as id", [spa.starter, owner]);
    await db.query("update commerce.store_starters set published = true, published_at = now() where id = $1", [spa.starter]);
    expect(await one("select slug, starter, starter_copy_of, made_from_starter, status, audience from commerce.stores where id = $1", [copy])).toEqual({
      slug: "frozen-spa-v1",
      starter: true,
      starter_copy_of: spa.starter,
      made_from_starter: null,
      status: "active",
      audience: "both",
    });
    expect((await one<{ id: string }>("select published_store_id as id from commerce.store_starters where id = $1", [spa.starter])).id).toBe(copy);
    expect((await one<{ id: string }>("select commerce.starter_source($1) as id", [spa.starter])).id).toBe(copy);

    // A change in the working store reaches no new store until the next publish.
    await db.query("update commerce.stores set audience = 'businesses' where id = $1", [spa.store]);
    const { id: made } = await one<{ id: string }>("select commerce.clone_store(commerce.starter_source($1), 'from-frozen', 'From', $2) as id", [spa.starter, owner]);
    expect(await one("select audience, made_from_starter, starter from commerce.stores where id = $1", [made])).toEqual({
      audience: "both",
      made_from_starter: spa.starter,
      starter: false,
    });

    const { id: second } = await one<{ id: string }>("select commerce.freeze_starter($1, $2) as id", [spa.starter, owner]);
    expect((await one<{ status: string }>("select status from commerce.stores where id = $1", [copy])).status).toBe("closed");
    expect(await one("select slug, audience from commerce.stores where id = $1", [second])).toEqual({ slug: "frozen-spa-v2", audience: "businesses" });
    expect((await one<{ id: string }>("select commerce.starter_source($1) as id", [spa.starter])).id).toBe(second);
  });

  it("publishes only its own frozen copy, and a copy describes no store template", async () => {
    const one1 = await createStarter("own-copy-a");
    const other = await createStarter("own-copy-b");
    const { id: copy } = await one<{ id: string }>("select commerce.freeze_starter($1, $2) as id", [one1.starter, owner]);
    await refused("update commerce.store_starters set published_store_id = $2 where id = $1", [other.starter, copy], /store_starters\.not_copy/);
    await refused("update commerce.store_starters set published_store_id = $2 where id = $1", [other.starter, other.store], /store_starters\.not_copy/);
    await refused("insert into commerce.store_starters (store_id, title, category) values ($1, 'Copy', 'other')", [copy], /store_starters\.not_starter/);
    await refused("update commerce.stores set starter_copy_of = $2 where id = $1", [template, one1.starter], /stores_starter_copy_is_starter/);
  });

  it("is never published or offered while archived", async () => {
    const shelf = await createStarter("archived-spa", true);
    expect((await one<{ id: string | null }>("select commerce.starter_offered_source($1) as id", [shelf.starter])).id).toBe(shelf.store);
    await refused("update commerce.store_starters set archived_at = now() where id = $1", [shelf.starter], /store_starters_archived_unpublished/);
    await db.query("update commerce.store_starters set archived_at = now(), published = false where id = $1", [shelf.starter]);
    expect((await one<{ id: string | null }>("select commerce.starter_offered_source($1) as id", [shelf.starter])).id).toBeNull();
    await refused("select commerce.starter_source($1)", [shelf.starter], /store_starters\.not_offered/);
    await refused("select commerce.freeze_starter($1, $2)", [shelf.starter, owner], /store_starters\.archived/);
  });

  it("is deleted only while no store was made from it and no access request names it; its copies lose the link", async () => {
    const unused = await createStarter("unused-spa");
    const { id: copy } = await one<{ id: string }>("select commerce.freeze_starter($1, $2) as id", [unused.starter, owner]);
    await db.query("update commerce.stores set status = 'closed' where id in ($1, $2)", [unused.store, copy]);
    await db.query("delete from commerce.store_starters where id = $1", [unused.starter]);
    expect(await one("select starter, starter_copy_of, status from commerce.stores where id = $1", [copy])).toEqual({ starter: true, starter_copy_of: null, status: "closed" });

    const used = await createStarter("used-spa", true);
    await one("select commerce.clone_store(commerce.starter_source($1), 'made-from-used', 'Made', $2) as id", [used.starter, owner]);
    await refused("delete from commerce.store_starters where id = $1", [used.starter], /store_starters\.used/);

    const asked = await createStarter("asked-spa", true);
    await db.query("insert into commerce.access_requests (email, name, store_name, starter_id) values ('asker@example.com', 'A', 'A', $1)", [asked.starter]);
    await refused("delete from commerce.store_starters where id = $1", [asked.starter], /store_starters\.requested/);
  });
});
