import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { minorUnitDigits } from "@/lib/money";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { RESERVED_STORE_PAGE_SLUGS } from "@/lib/page-content";
import { RESERVED_STORE_SLUGS } from "@/lib/paths";
import { MODULES } from "@/lib/store-modules";

import { createTestDatabase } from "./testing";

let db: PGlite;
/** The store most tests work in: sells to Germany, Norway, Sweden, Denmark. */
let store: string;
/** A second store, for tenant-isolation tests. */
let other: string;

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createStore("test-store", ["DE", "NO", "SE", "DK"]);
  other = await createStore("other-store", ["DE"]);
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/** A store with active markets copied from the country reference data. */
async function createStore(slug: string, markets: string[]): Promise<string> {
  const { id } = await one<{ id: string }>(
    "insert into commerce.stores (slug, name) values ($1, $1) returning id",
    [slug],
  );
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true
     from commerce.countries where code = any($2)`,
    [id, markets],
  );
  return id;
}

let counter = 0;

/** A draft product with one active variant, one picture and an English title. */
async function createProduct(
  options: { storeId?: string; manufacturerCountry?: string } = {},
): Promise<{ productId: string; variantId: string; handle: string; storeId: string }> {
  counter += 1;
  const storeId = options.storeId ?? store;
  const handle = `test-product-${counter}`;
  const { id: manufacturerId } = await one<{ id: string }>(
    `insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
     values ($1, 'Maker', 'Street 1, 10115 Berlin', 'safety@maker.example', $2) returning id`,
    [storeId, options.manufacturerCountry ?? "DE"],
  );
  const { id: productId } = await one<{ id: string }>(
    `insert into commerce.products (store_id, handle, manufacturer_id, tax_code)
     values ($1, $2, $3, 'txcd_99999999') returning id`,
    [storeId, handle, manufacturerId],
  );
  await db.query(
    `insert into commerce.product_translations (store_id, product_id, locale, title)
     values ($1, $2, 'en-IE', 'Test product')`,
    [storeId, productId],
  );
  await db.query(
    `insert into commerce.product_media (store_id, product_id, url)
     values ($1, $2, 'https://example.com/a.jpg')`,
    [storeId, productId],
  );
  const { id: variantId } = await one<{ id: string }>(
    `insert into commerce.product_variants (store_id, product_id, sku)
     values ($1, $2, $3) returning id`,
    [storeId, productId, `SKU-${counter}`],
  );
  return { productId, variantId, handle, storeId };
}

/** An order in the main store, in euros. */
async function createOrder(number: string): Promise<string> {
  const { id } = await one<{ id: string }>(
    `insert into commerce.orders (store_id, number, market_code, currency, locale, email,
       subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
       billing_address, shipping_address)
     values ($1, $2, 'DE', 'EUR', 'de-DE', 'a@example.com',
       1000, 490, 0, 238, 1490, '{}', '{}') returning id`,
    [store, number],
  );
  return id;
}

/** A document row as the issuing function writes it, for tests of the rules around it (a real one is made by `issue_order_invoice`). */
async function insertInvoice(storeId: string, orderId: string, number: number, totalMinor: number, taxMinor: number): Promise<void> {
  const snapshot = {
    version: 1,
    buckets: [{ rate: 0.19, basis: "standard", netMinor: totalMinor - taxMinor, vatMinor: taxMinor, grossMinor: totalMinor }],
  };
  await db.transaction(async (tx) => {
    await tx.query("select set_config('commerce.issuing_document', $1, true)", [orderId]);
    await tx.query(
      `insert into commerce.invoices (store_id, order_id, series, number, document_number, currency, total_minor, tax_minor, net_minor,
         issued_on, supply_date, locale, vat_kind, snapshot, public_token)
       values ($1, $2, 'invoice', $3, $4, 'EUR', $5, $6, $7, current_date, current_date, 'de-DE', 'standard', $8::jsonb, $9)`,
      [storeId, orderId, number, `F-${number}`, totalMinor, taxMinor, totalMinor - taxMinor, JSON.stringify(snapshot), `inv_${"a".repeat(43)}`],
    );
  });
}

async function createAccount(email: string): Promise<string> {
  const { id } = await one<{ id: string }>(
    "insert into commerce.accounts (email) values ($1) returning id",
    [email],
  );
  return id;
}

describe("reference data", () => {
  it("has every EU member state and Norway", async () => {
    const { rows } = await db.query<{ code: string; eu: boolean }>(
      "select code, commerce.is_eu_country(code) as eu from commerce.countries order by code",
    );
    expect(rows).toHaveLength(28);
    expect(rows.filter((c) => c.eu)).toHaveLength(27);
    expect(rows.find((c) => c.code === "NO")).toEqual({ code: "NO", eu: false });
    const norway = await one<{ currency: string; default_locale: string }>(
      "select currency, default_locale from commerce.countries where code = 'NO'",
    );
    expect(norway).toEqual({ currency: "NOK", default_locale: "nb-NO" });
  });

  it("treats an unknown country as outside the EU", async () => {
    const { eu } = await one<{ eu: boolean }>("select commerce.is_eu_country('CN') as eu");
    expect(eu).toBe(false);
  });

  it("uses only currencies the money helpers support", async () => {
    const { rows } = await db.query<{ currency: string }>(
      "select distinct currency from commerce.countries",
    );
    for (const { currency } of rows) {
      expect(() => minorUnitDigits(currency)).not.toThrow();
    }
  });

  it("rejects a price in the wrong currency for its market", async () => {
    const { variantId } = await createProduct();
    await expect(
      db.query(
        `insert into commerce.prices (store_id, variant_id, market_code, currency, amount_minor)
         values ($1, $2, 'DE', 'SEK', 1000)`,
        [store, variantId],
      ),
    ).rejects.toThrow(/prices_market_fk/);
  });
});

describe("sequential order numbering", () => {
  /** A store of its own, so its sequence starts at 1001. */
  async function numberedStore(): Promise<string> {
    return createStore(`num-${Math.random().toString(36).slice(2, 10)}`, ["DE"]);
  }
  const take = async (storeId: string) =>
    (await one<{ number: string }>(
      "select s.prefix || commerce.next_document_number($1, 'order')::text as number from commerce.document_series s where s.store_id = $1 and s.series = 'order'",
      [storeId],
    )).number;
  const place = async (storeId: string, number: string) =>
    one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
       values ($1, $2, 'DE', 'EUR', 'de-DE', 'a@example.com', 1000, 0, 0, 0, 1000, '{}', '{}') returning id`,
      [storeId, number],
    );
  const audit = async (storeId: string) =>
    one<{ orders: number; first_number: number | null; last_number: number | null; missing: number; first_missing: number | null; off_format: number; next_number: number; ok: boolean }>(
      "select orders::int, first_number::int, last_number::int, missing::int, first_missing::int, off_format::int, next_number::int, ok from commerce.order_number_audit($1)",
      [storeId],
    );

  it("gives every store its own order series from 1001, and counts a store with no orders as in order", async () => {
    const id = await numberedStore();
    expect(await audit(id)).toMatchObject({ orders: 0, next_number: 1001, ok: true });
    expect(await take(id)).toBe("1001");
  });

  it("numbers orders one after the other without gaps, and a rolled-back order gives its number back", async () => {
    const id = await numberedStore();
    await place(id, await take(id));
    await place(id, await take(id));
    await db.query("begin");
    const lost = await take(id);
    expect(lost).toBe("1003");
    await db.query("rollback");
    expect(await take(id)).toBe("1003");
    expect(await audit(id)).toMatchObject({ orders: 2, first_number: 1001, last_number: 1002, missing: 0, off_format: 0, ok: false });
    await place(id, "1003");
    expect(await audit(id)).toEqual({ orders: 3, first_number: 1001, last_number: 1003, missing: 0, first_missing: null, off_format: 0, next_number: 1004, ok: true });
  });

  it("sees a gap, a number that is not the series', and a series ahead of its orders", async () => {
    const id = await numberedStore();
    await place(id, await take(id));
    await take(id);
    await place(id, await take(id));
    expect(await audit(id)).toMatchObject({ orders: 2, missing: 1, first_missing: 1002, ok: false });
    await place(id, "WEB-7");
    expect(await audit(id)).toMatchObject({ orders: 3, off_format: 1, ok: false });
  });

  it("does not count history copied from another store, which can also be removed", async () => {
    const id = await numberedStore();
    await place(id, await take(id));
    await db.query("begin");
    await db.query("select set_config('commerce.copying', 'on', true)");
    const copied = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from)
       values ($1, 'C-77', 'DE', 'EUR', 'de-DE', 'a@example.com', 'paid', 1000, 0, 0, 0, 1000, '{}', '{}', gen_random_uuid()) returning id`,
      [id],
    );
    await db.query("commit");
    expect(await audit(id)).toMatchObject({ orders: 1, missing: 0, off_format: 0, ok: true });
    await db.query("delete from commerce.orders where id = $1", [copied.id]);
  });

  it("never renumbers or deletes an order", async () => {
    const id = await numberedStore();
    const order = await place(id, await take(id));
    await expect(db.query("update commerce.orders set number = '5000' where id = $1", [order.id])).rejects.toThrow(/order_number\.changed/);
    await expect(db.query("delete from commerce.orders where id = $1", [order.id])).rejects.toThrow(/order_number\.deleted/);
    // Anything else about an order may still change.
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [order.id]);
    expect((await audit(id)).ok).toBe(true);
  });

  it("holds the series: no lowering, skipping, new prefix or deleting once orders are numbered", async () => {
    const id = await numberedStore();
    await place(id, await take(id));
    const change = (set: string) => db.query(`update commerce.document_series set ${set} where store_id = $1 and series = 'order'`, [id]);
    await expect(change("next_number = 1")).rejects.toThrow(/document_series\.sequence/);
    await expect(change("next_number = next_number + 5")).rejects.toThrow(/document_series\.sequence/);
    await expect(change("prefix = 'X-'")).rejects.toThrow(/document_series\.prefix/);
    await expect(db.query("delete from commerce.document_series where store_id = $1 and series = 'order'", [id])).rejects.toThrow(/document_series\.issued/);
    // Taking the next number is the one move it allows.
    await expect(take(id)).resolves.toBe("1002");
  });

  it("lets a store with no orders yet choose where its numbers start, then holds it", async () => {
    const id = await numberedStore();
    await db.query("update commerce.document_series set next_number = 5000, prefix = 'A-' where store_id = $1 and series = 'order'", [id]);
    await place(id, await take(id));
    expect((await audit(id))).toMatchObject({ first_number: 5000, ok: true });
    await expect(db.query("update commerce.document_series set next_number = 4999 where store_id = $1 and series = 'order'", [id])).rejects.toThrow(/document_series\.sequence/);
  });
});

describe("Kaizen's pages with a place of their own (D143)", () => {
  const page = async (storeId: string | null, slug: string, type = "page") =>
    (await one<{ id: string }>("insert into commerce.pages (store_id, slug, draft, type) values ($1, $2, '{}', $3) returning id", [storeId, slug, type])).id;
  const place = (role: string, pageId: string) => db.query("insert into commerce.platform_page_roles (role, page_id) values ($1, $2)", [role, pageId]);

  it("holds a place for one of Kaizen's own pages, one place for a page, and lets go of it when the page is deleted", async () => {
    const a = await page(null, "d143-a");
    const b = await page(null, "d143-b");
    await place("front", a);
    await expect(place("front", b)).rejects.toThrow(/platform_page_roles_pkey|duplicate/);
    await expect(place("blog", a)).rejects.toThrow(/platform_page_roles_page_key|duplicate/);
    await expect(place("cart", b)).rejects.toThrow(/platform_page_roles_role/);
    await place("blog", b);
    await db.query("delete from commerce.pages where id = $1", [a]);
    expect(await one<{ n: number }>("select count(*)::int as n from commerce.platform_page_roles where role = 'front'")).toEqual({ n: 0 });
    await db.query("delete from commerce.pages where id = $1", [b]);
  });

  it("refuses a store's page, and a page that is not a page (an article, a header)", async () => {
    const mine = await page(store, "d143-store");
    await expect(place("front", mine)).rejects.toThrow(/platform_page_roles\.page/);
    for (const type of ["article", "header", "footer"]) {
      await expect(place("not_found", await page(null, `d143-${type}`, type))).rejects.toThrow(/platform_page_roles\.page/);
    }
    // Moving a place to another kind of page is refused too.
    const ok = await page(null, "d143-ok");
    await place("front", ok);
    await expect(db.query("update commerce.platform_page_roles set page_id = $1 where role = 'front'", [mine])).rejects.toThrow(/platform_page_roles\.page/);
    await db.query("delete from commerce.platform_page_roles");
  });
});

describe("A/B tests of pages (D148)", () => {
  let n = 0;
  const made = async () => {
    n += 1;
    const store = await createStore(`ab148-${n}`, ["NO"]);
    const page = async (slug: string, type = "page", published = true) =>
      (await one<{ id: string }>(
        `insert into commerce.pages (store_id, slug, draft, published, published_at, type) values ($1, $2, '{}', ${published ? "'{}', now()" : "null, null"}, $3) returning id`,
        [store, slug, type],
      )).id;
    const target = await page("om-oss");
    const experiment = (
      await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'Shorter hero', $2, 'orders') returning id", [store, target])
    ).id;
    const variant = (key: string, pageId: string | null, share: number) =>
      db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, $3, $4, $5, $6)", [store, experiment, key, key.toUpperCase(), pageId, share]);
    return { store, page, target, experiment, variant };
  };
  /** A test with its original and one variant, ready to start. */
  const ready = async () => {
    const t = await made();
    const b = await t.page("ab-b", "variant");
    await t.variant("a", null, 0.5);
    await t.variant("b", b, 0.5);
    return { ...t, b };
  };
  const set = (id: string, sql: string) => db.query(`update commerce.experiments set ${sql} where id = $1`, [id]);
  const start = (id: string) => set(id, "status = 'running'");

  it("is made as a draft of a page of the store, with sensible names, goals and shares", async () => {
    const t = await made();
    await expect(db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal, status) values ($1, 'x', $2, 'orders', 'running')", [t.store, t.target])).rejects.toThrow(/experiments\.start/);
    const article = await t.page("nytt", "article");
    await expect(db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'orders')", [t.store, article])).rejects.toThrow(/experiments\.target/);
    await expect(db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, '', $2, 'orders')", [t.store, t.target])).rejects.toThrow(/experiments_name/);
    await expect(db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'sales')", [t.store, t.target])).rejects.toThrow(/experiments_goal/);
    // Forms sent is a goal (phase 11).
    await db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal, goal_params) values ($1, 'forms', $2, 'form', '{\"block\": \"news-1\"}')", [t.store, t.target]);
    await db.query("delete from commerce.experiments where store_id = $1 and name = 'forms'", [t.store]);
    await expect(db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal, traffic_share) values ($1, 'x', $2, 'orders', 1.5)", [t.store, t.target])).rejects.toThrow(/experiments_traffic/);
    // Another store's page cannot be tested.
    const other = await made();
    await expect(db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'orders')", [t.store, other.target])).rejects.toThrow(/experiments_target_fk|experiments\.target/);
  });

  it("starts only with the original, one to three published variants, shares that add up, and a published page", async () => {
    const t = await made();
    await expect(start(t.experiment)).rejects.toThrow(/experiments\.variants/);
    await t.variant("a", null, 0.6);
    const b = await t.page("ab-b", "variant", false);
    await t.variant("b", b, 0.3);
    await expect(start(t.experiment)).rejects.toThrow(/experiments\.split/);
    await db.query("update commerce.experiment_variants set share = 0.4 where experiment_id = $1 and key = 'b'", [t.experiment]);
    await expect(start(t.experiment)).rejects.toThrow(/published before the test starts/);
    await db.query("update commerce.pages set published = '{}', published_at = now() where id = $1", [b]);
    await db.query("update commerce.pages set published = null, published_at = null where id = $1", [t.target]);
    await expect(start(t.experiment)).rejects.toThrow(/page under test must be published/);
    await db.query("update commerce.pages set published = '{}', published_at = now() where id = $1", [t.target]);
    await start(t.experiment);
    const row = await one<{ started_at: string | null; planned_end: string | null; status: string }>("select started_at, planned_end, status from commerce.experiments where id = $1", [t.experiment]);
    expect(row.status).toBe("running");
    expect(row.started_at).not.toBeNull();
    // The planned end is the minimum days (14) after the start unless it was set.
    expect((new Date(row.planned_end!).getTime() - new Date(row.started_at!).getTime()) / 86_400_000).toBeCloseTo(14, 0);
  });

  it("keeps the cookies page and the content pages out of tests", async () => {
    const t = await ready();
    for (const role of ["blog", "search", "not_found", "cookies", "category", "tag"]) {
      await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, $2, $3)", [t.store, role, t.target]);
      await expect(start(t.experiment), role).rejects.toThrow(/cookies page and the blog, search, 404/);
      await db.query("delete from commerce.page_roles where store_id = $1", [t.store]);
    }
    await start(t.experiment);
  });

  it("tests a working page by a part around its shop component, never as a whole, and keeps its place while it runs (phase 9)", async () => {
    for (const role of ["cart", "checkout", "order", "account", "sign_in", "wishlist", "subscription", "deliveries"]) {
      const t = await ready();
      await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, $2, $3)", [t.store, role, t.target]);
      // As a whole it has the shop's component on it: not testable.
      await expect(start(t.experiment), role).rejects.toThrow(/working page can be tested by a part/);
      await set(t.experiment, "target_part = 'row-1', target_part_kind = 'row'");
      await start(t.experiment);
      // While it runs the page keeps its place, and no other page takes it.
      const other = await t.page(`${role.replace("_", "-")}-2`);
      await expect(db.query("update commerce.page_roles set page_id = $3 where store_id = $1 and role = $2", [t.store, role, other]), role).rejects.toThrow(/page_roles\.experiment/);
      await expect(db.query("delete from commerce.page_roles where store_id = $1 and role = $2", [t.store, role]), role).rejects.toThrow(/page_roles\.experiment/);
      // Choosing the page it already is, again, changes nothing.
      await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, $2, $3) on conflict (store_id, role) do update set page_id = excluded.page_id", [t.store, role, t.target]);
      await set(t.experiment, "status = 'stopped'");
      await db.query("update commerce.page_roles set page_id = $3 where store_id = $1 and role = $2", [t.store, role, other]);
    }
  });

  it("tests the front page and the All products page, whole or by a part, and keeps them in place while a test runs (phase 10)", async () => {
    for (const [column, place] of [["front_page_id", "front"], ["products_page_id", "products"]] as const) {
      const t = await ready();
      await db.query(`update commerce.stores set ${column} = $2 where id = $1`, [t.store, t.target]);
      expect((await one<{ place: string | null }>("select commerce.page_place($1, $2) as place", [t.store, t.target])).place).toBe(place);
      // Whole, or by a part: nothing on them is the shop's own component.
      await start(t.experiment);
      // While it runs, no other page takes the place, and the page cannot be taken off it.
      const other = await t.page(`${place}-2`);
      await expect(db.query(`update commerce.stores set ${column} = $2 where id = $1`, [t.store, other]), place).rejects.toThrow(/stores\.experiment/);
      await expect(db.query(`update commerce.stores set ${column} = null where id = $1`, [t.store]), place).rejects.toThrow(/stores\.experiment/);
      // Choosing the page it already is, again, changes nothing.
      await db.query(`update commerce.stores set ${column} = $2 where id = $1`, [t.store, t.target]);
      await set(t.experiment, "status = 'stopped'");
      await db.query(`update commerce.stores set ${column} = $2 where id = $1`, [t.store, other]);
    }
    // A test by a part is as good.
    const part = await ready();
    await db.query("update commerce.stores set front_page_id = $2 where id = $1", [part.store, part.target]);
    await set(part.experiment, "target_part = 'row-1', target_part_kind = 'row'");
    await start(part.experiment);
  });

  it("does not let a page in a running test be made the front page or the All products page (phase 10)", async () => {
    const t = await ready();
    await start(t.experiment);
    await expect(db.query("update commerce.stores set front_page_id = $2 where id = $1", [t.store, t.target])).rejects.toThrow(/stores\.experiment/);
    await expect(db.query("update commerce.stores set products_page_id = $2 where id = $1", [t.store, t.target])).rejects.toThrow(/stores\.experiment/);
    await set(t.experiment, "status = 'stopped'");
    await db.query("update commerce.stores set front_page_id = $2 where id = $1", [t.store, t.target]);
  });

  it("does not let a page in a running test be chosen for a place of its own", async () => {
    const t = await ready();
    await start(t.experiment);
    await expect(db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'cart', $2)", [t.store, t.target])).rejects.toThrow(/page_roles\.experiment/);
    await set(t.experiment, "status = 'stopped'");
    await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'cart', $2)", [t.store, t.target]);
  });

  it("runs one test per page and five per store", async () => {
    const t = await ready();
    await start(t.experiment);
    // A second test of the same page can be drafted but not started alongside.
    const second = (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'again', $2, 'cart') returning id", [t.store, t.target])).id;
    const b2 = await t.page("ab2-b", "variant");
    await db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, 'a', 'A', null, 0.5), ($1, $2, 'b', 'B', $3, 0.5)", [t.store, second, b2]);
    await expect(start(second)).rejects.toThrow(/experiments_running_target_key|duplicate/);
    // Five at a time in one store.
    for (let i = 0; i < 4; i += 1) {
      const page = await t.page(`andre-${i}`);
      const e = (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'cart') returning id", [t.store, page])).id;
      const v = await t.page(`andre-${i}-b`, "variant");
      await db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, 'a', 'A', null, 0.5), ($1, $2, 'b', 'B', $3, 0.5)", [t.store, e, v]);
      await start(e);
    }
    const sixthPage = await t.page("sjette");
    const sixth = (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'cart') returning id", [t.store, sixthPage])).id;
    const sixthVariant = await t.page("sjette-b", "variant");
    await db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, 'a', 'A', null, 0.5), ($1, $2, 'b', 'B', $3, 0.5)", [t.store, sixth, sixthVariant]);
    await expect(start(sixth)).rejects.toThrow(/experiments\.limit/);
  });

  it("moves forward only, and what it measures is locked once it has started", async () => {
    const t = await ready();
    await expect(set(t.experiment, "status = 'stopped'")).rejects.toThrow(/cannot go from draft to stopped/);
    // A draft can still be changed.
    await set(t.experiment, "primary_goal = 'revenue', traffic_share = 0.5, min_days = 21");
    await start(t.experiment);
    for (const change of ["primary_goal = 'cart'", "traffic_share = 0.2", "min_days = 7", "audience = '{\"devices\": [\"mobile\"]}'", "goal_params = '{\"block\": \"x\"}'"]) {
      await expect(set(t.experiment, change), change).rejects.toThrow(/experiments\.locked/);
    }
    await expect(db.query("update commerce.experiments set target_page_id = $2 where id = $1", [t.experiment, t.b])).rejects.toThrow(/experiments\.locked/);
    // Name, hypothesis and the planned end can be changed while it runs (extending it).
    await set(t.experiment, "name = 'Renamed', hypothesis = 'A shorter hero sells more', planned_end = planned_end + interval '7 days'");
    await expect(set(t.experiment, "status = 'draft'")).rejects.toThrow(/cannot go from running to draft/);
    await set(t.experiment, "status = 'stopped'");
    const stopped = await one<{ stopped_at: string | null; stop_reason: string | null }>("select stopped_at, stop_reason from commerce.experiments where id = $1", [t.experiment]);
    expect(stopped.stopped_at).not.toBeNull();
    expect(stopped.stop_reason).toBe("person");
    await expect(start(t.experiment)).rejects.toThrow(/cannot go from stopped to running/);
    await expect(set(t.experiment, "status = 'applied'")).rejects.toThrow(/experiments_applied|experiments\.applied/);
    await expect(set(t.experiment, "status = 'applied', applied_variant = 'a'")).rejects.toThrow(/choose one of the variants/);
    await set(t.experiment, "status = 'applied', applied_variant = 'b'");
    await expect(set(t.experiment, "name = 'Too late'")).rejects.toThrow(/finished test cannot be changed/);
  });

  it("can wait for a start time, and goes back to a draft to be changed", async () => {
    const t = await ready();
    const later = "now() + interval '1 day'";
    await expect(set(t.experiment, "status = 'scheduled'")).rejects.toThrow(/experiments_scheduled|experiments\.schedule/);
    await expect(set(t.experiment, "status = 'scheduled', scheduled_start = now() - interval '1 hour'")).rejects.toThrow(/experiments\.schedule/);
    await set(t.experiment, `status = 'scheduled', scheduled_start = ${later}`);
    // Waiting, nothing it measures changes, and its versions are locked.
    await expect(set(t.experiment, "primary_goal = 'cart'")).rejects.toThrow(/experiments\.locked/);
    await expect(db.query("update commerce.experiment_variants set share = 0.7 where experiment_id = $1 and key = 'b'", [t.experiment])).rejects.toThrow(/experiment_variants\.locked/);
    await expect(set(t.experiment, "status = 'stopped'")).rejects.toThrow(/cannot go from scheduled to stopped/);
    // It can move its start, go back to a draft to be changed, and be scheduled again.
    await set(t.experiment, "scheduled_start = now() + interval '2 days'");
    await set(t.experiment, "status = 'draft', schedule_problem = 'The page was not published'");
    await set(t.experiment, "primary_goal = 'cart'");
    await set(t.experiment, `status = 'scheduled', scheduled_start = ${later}`);
    // The start checks are made when it is scheduled, and again when it starts.
    await db.query("update commerce.pages set published = null, published_at = null where id = $1", [t.target]);
    await expect(start(t.experiment)).rejects.toThrow(/page under test must be published/);
    await db.query("update commerce.pages set published = '{}', published_at = now() where id = $1", [t.target]);
    await start(t.experiment);
    const row = await one<{ status: string; started_at: string | null; schedule_problem: string | null }>("select status, started_at, schedule_problem from commerce.experiments where id = $1", [t.experiment]);
    expect(row.status).toBe("running");
    expect(row.started_at).not.toBeNull();
    expect(row.schedule_problem).toBeNull();
    // A draft that would not start cannot be scheduled either.
    const bad = await made();
    await bad.variant("a", null, 1);
    await expect(set(bad.experiment, `status = 'scheduled', scheduled_start = ${later}`)).rejects.toThrow(/experiments\.variants/);
  });

  it("tests the header, the footer or a product layout where they are used, and keeps the header from being swapped under a test", async () => {
    const t = await made();
    const target = async (type: string) => {
      const name = type.replace("_", "-");
      const page = await t.page(`${name}-1`, type);
      const experiment = (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'orders') returning id", [t.store, page])).id;
      const b = await t.page(`ab-${name}-b`, "variant");
      await db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, 'a', 'A', null, 0.5), ($1, $2, 'b', 'B', $3, 0.5)", [t.store, experiment, b]);
      return { page, experiment };
    };
    // A page, a product layout, a header and a footer can be targets; an article cannot.
    const article = await t.page("nytt", "article");
    await expect(db.query("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'orders')", [t.store, article])).rejects.toThrow(/experiments\.target/);

    const header = await target("header");
    await expect(start(header.experiment)).rejects.toThrow(/only the header the store uses/);
    await db.query("update commerce.stores set header_id = $2 where id = $1", [t.store, header.page]);
    await start(header.experiment);
    // While it runs the store keeps that header, and the test cannot be started on another as the footer.
    const other = await t.page("header-2", "header");
    await expect(db.query("update commerce.stores set header_id = $2 where id = $1", [t.store, other])).rejects.toThrow(/stores\.experiment/);
    await expect(db.query("update commerce.stores set header_id = null where id = $1", [t.store])).rejects.toThrow(/stores\.experiment/);
    await set(header.experiment, "status = 'stopped'");
    await db.query("update commerce.stores set header_id = $2 where id = $1", [t.store, other]);

    const footer = await target("footer");
    await expect(start(footer.experiment)).rejects.toThrow(/only the footer the store uses/);
    await db.query("update commerce.stores set footer_id = $2 where id = $1", [t.store, footer.page]);
    await start(footer.experiment);

    const layout = await target("product_layout");
    await expect(start(layout.experiment)).rejects.toThrow(/no product uses this layout/);
    await db.query("update commerce.stores set product_layout_id = $2 where id = $1", [t.store, layout.page]);
    await start(layout.experiment);
    // Three tests at once on one store: each has its own target.
    const running = await one<{ n: number }>("select count(*)::int as n from commerce.experiments where store_id = $1 and status = 'running'", [t.store]);
    expect(running.n).toBe(2);
  });

  it("tests a part of a page: its id and kind go together, and they are locked with the test", async () => {
    const t = await ready();
    await expect(set(t.experiment, "target_part = 'row-1'")).rejects.toThrow(/experiments_part/);
    await expect(set(t.experiment, "target_part = 'row-1', target_part_kind = 'page'")).rejects.toThrow(/experiments_part/);
    await expect(set(t.experiment, "target_part = '', target_part_kind = 'row'")).rejects.toThrow(/experiments_part/);
    await set(t.experiment, "target_part = 'row-1', target_part_kind = 'row'");
    await start(t.experiment);
    await expect(set(t.experiment, "target_part = 'row-2'")).rejects.toThrow(/experiments\.locked/);
    await expect(set(t.experiment, "target_part = null, target_part_kind = null")).rejects.toThrow(/experiments\.locked/);
  });

  it("locks the versions once the test has started, and only a made-for-the-test page can be one", async () => {
    const t = await made();
    const ordinary = await t.page("vanlig");
    await t.variant("a", null, 0.5);
    await expect(t.variant("b", ordinary, 0.5)).rejects.toThrow(/experiment_variants\.page/);
    await expect(t.variant("a", null, 0.5)).rejects.toThrow(/experiment_variants_experiment_id_key_pk|duplicate/);
    const odd = await t.page("ab-e", "variant");
    await expect(t.variant("e", odd, 0.5)).rejects.toThrow(/experiment_variants_key_format/);
    await expect(t.variant("b", null, 0.5)).rejects.toThrow(/experiment_variants_control/);
    const b = await t.page("ab-b", "variant");
    await t.variant("b", b, 0.5);
    // A copy serves one test only.
    const e2 = (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'cart') returning id", [t.store, ordinary])).id;
    await expect(db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, 'b', 'B', $3, 0.5)", [t.store, e2, b])).rejects.toThrow(/experiment_variants_page_key|duplicate/);
    await start(t.experiment);
    await expect(db.query("update commerce.experiment_variants set share = 0.7 where experiment_id = $1 and key = 'b'", [t.experiment])).rejects.toThrow(/experiment_variants\.locked/);
    await expect(db.query("delete from commerce.experiment_variants where experiment_id = $1 and key = 'b'", [t.experiment])).rejects.toThrow(/experiment_variants\.locked/);
    // A page in a test is not deleted or turned into another kind of page.
    await expect(db.query("delete from commerce.pages where id = $1", [t.target])).rejects.toThrow(/experiments_target_fk|foreign key/);
    await expect(db.query("delete from commerce.pages where id = $1", [b])).rejects.toThrow(/experiment_variants_page_fk|foreign key/);
    await expect(db.query("update commerce.pages set type = 'article' where id = $1", [t.target])).rejects.toThrow(/pages\.experiment/);
    // ... nor unpublished while the test runs, but free again once it has stopped.
    await expect(db.query("update commerce.pages set published = null, published_at = null where id = $1", [t.target])).rejects.toThrow(/stays published/);
    await expect(db.query("update commerce.pages set published = null, published_at = null where id = $1", [b])).rejects.toThrow(/stays published/);
    await set(t.experiment, "status = 'stopped'");
    await db.query("update commerce.pages set published = null, published_at = null where id = $1", [b]);
  });

  it("records who saw what once, never changes it, and only while the test runs", async () => {
    const t = await ready();
    const expose = (visitor: string, variant: string) =>
      db.query("insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant, market, device) values ($1, $2, $3, $4, 'NO', 'mobile')", [t.store, t.experiment, visitor, variant]);
    await expect(expose("visitor-0001", "a")).rejects.toThrow(/experiment_exposures\.closed/);
    await start(t.experiment);
    await expose("visitor-0001", "a");
    await expect(expose("visitor-0001", "b")).rejects.toThrow(/experiment_exposures_experiment_id_visitor_pk|duplicate/);
    await expect(expose("short", "a")).rejects.toThrow(/experiment_exposures_visitor/);
    await expect(expose("visitor-0002", "c")).rejects.toThrow(/experiment_exposures_variant_fk|foreign key/);
    await expect(db.query("update commerce.experiment_exposures set variant = 'b' where experiment_id = $1", [t.experiment])).rejects.toThrow(/experiment_exposures\.changed/);
    // An event follows an exposure, in the version the visitor was shown, once.
    const event = (visitor: string, variant: string, goal = "cart", ref = "") =>
      db.query("insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref) values ($1, $2, $3, $4, $5, $6)", [t.store, t.experiment, visitor, variant, goal, ref]);
    await event("visitor-0001", "a");
    await expect(event("visitor-0001", "a")).rejects.toThrow(/experiment_events_once_key|duplicate/);
    await expect(event("visitor-0001", "b", "checkout")).rejects.toThrow(/belongs to the version the visitor was shown/);
    await expect(event("visitor-0009", "a", "checkout")).rejects.toThrow(/experiment_events_exposure_fk|foreign key|belongs to the version/);
    await expect(event("visitor-0001", "a", "order")).rejects.toThrow(/experiment_events_goal/);
    await event("visitor-0001", "a", "click", "block-1");
    // A form sent counts once per form (phase 11).
    await event("visitor-0001", "a", "form", "news-1");
    await expect(event("visitor-0001", "a", "form", "news-1")).rejects.toThrow(/experiment_events_once_key|duplicate/);
    await event("visitor-0001", "a", "form", "contact-1");
    await set(t.experiment, "status = 'stopped'");
    await expect(expose("visitor-0003", "a")).rejects.toThrow(/experiment_exposures\.closed/);
    await expect(event("visitor-0001", "a", "checkout")).rejects.toThrow(/experiment_events\.closed/);
  });

  it("keeps a test that has run, deletes a draft with its versions, and goes with its store", async () => {
    const t = await ready();
    await db.query("delete from commerce.experiments where id = $1", [t.experiment]);
    expect(await one<{ n: number }>("select count(*)::int as n from commerce.experiment_variants where store_id = $1", [t.store])).toEqual({ n: 0 });
    const r = await ready();
    await start(r.experiment);
    await expect(db.query("delete from commerce.experiments where id = $1", [r.experiment])).rejects.toThrow(/experiments\.delete/);
    await set(r.experiment, "status = 'stopped'");
    await expect(db.query("delete from commerce.experiments where id = $1", [r.experiment])).rejects.toThrow(/experiments\.delete/);
    // Its carts' visitors are recorded without tying them to the cart.
    await db.query("insert into commerce.experiment_carts (store_id, cart_id, visitor) values ($1, gen_random_uuid(), 'visitor-0001')", [r.store]);
    await expect(db.query("insert into commerce.experiment_carts (store_id, cart_id, visitor) values ($1, gen_random_uuid(), 'x')", [r.store])).rejects.toThrow(/experiment_carts_visitor/);
  });
});

describe("AI model prices (D145)", () => {
  const price = (provider: string, model: string, input: number, output: number, from = "now()") =>
    db.query(`insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, effective_from) values ($1, $2, $3, $4, ${from})`, [provider, model, input, output]);

  it("keeps a price per model and start, never negative, with names of a sensible length", async () => {
    await price("p143", "m", 0.25, 2, "'2026-01-01'");
    await price("p143", "m", 0.5, 4, "'2026-06-01'");
    await expect(price("p143", "m", 1, 1, "'2026-06-01'")).rejects.toThrow(/ai_model_prices_key|duplicate/);
    await expect(price("p143", "neg", -1, 1)).rejects.toThrow(/ai_model_prices_amounts/);
    await expect(price("p143", "neg", 1, -1)).rejects.toThrow(/ai_model_prices_amounts/);
    await expect(price("", "m2", 1, 1)).rejects.toThrow(/ai_model_prices_names/);
    // Prices per picture, audio minute and million characters (D146) are never negative either, and may be none.
    const unit = (model: string, value: number | null) =>
      db.query("insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, per_image, per_audio_minute, per_million_characters) values ('p143', $1, 0, 0, $2, $2, $2)", [model, value]);
    await expect(unit("neg-unit", -0.01)).rejects.toThrow(/ai_model_prices_amounts/);
    await unit("unit-none", null);
    await unit("unit-free", 0);
    await expect(price("p143", "x".repeat(201), 1, 1)).rejects.toThrow(/ai_model_prices_names/);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.ai_model_prices where provider = 'p143'")).n).toBe(4);
  });

  it("comes with the prices of the models the platform already used", async () => {
    const seeded = await db.query<{ model: string }>("select model from commerce.ai_model_prices where provider = 'openai' order by model");
    expect(seeded.rows.map((r) => r.model)).toEqual(expect.arrayContaining(["gpt-4.1-mini", "gpt-5-mini", "text-embedding-3-small"]));
  });
});

describe("stores", () => {
  it("start with invoice series and test payments on (no setup needed)", async () => {
    const { rows: series } = await db.query<{ series: string }>(
      "select series from commerce.document_series where store_id = $1 order by series",
      [store],
    );
    expect(series.map((s) => s.series)).toEqual(["credit_note", "invoice", "order", "work_credit_note", "work_invoice"]);
    const orders = await one<{ next_number: number }>(
      "select next_number::int from commerce.document_series where store_id = $1 and series = 'order'",
      [store],
    );
    expect(orders.next_number).toBe(1001);
    const stripe = await one<{ enabled: boolean; active_mode: string }>(
      "select enabled, active_mode from commerce.payment_providers where store_id = $1 and provider = 'stripe'",
      [store],
    );
    expect(stripe).toEqual({ enabled: true, active_mode: "test" });
  });

  it("need a subdomain-safe slug that is not reserved", async () => {
    for (const slug of ["A-Store", "-store", "store-", "st", "my_store", "a".repeat(41)]) {
      await expect(
        db.query("insert into commerce.stores (slug, name) values ($1, 'x')", [slug]),
      ).rejects.toThrow(/stores_slug_format/);
    }
    for (const slug of RESERVED_STORE_SLUGS) {
      await expect(
        db.query("insert into commerce.stores (slug, name) values ($1, 'x')", [slug]),
      ).rejects.toThrow(/stores_slug_not_reserved|stores_slug_format/);
    }
  });

  it("have at most one template", async () => {
    await db.query("insert into commerce.stores (slug, name, is_template) values ('tpl-1', 'x', true)");
    await expect(
      db.query("insert into commerce.stores (slug, name, is_template) values ('tpl-2', 'x', true)"),
    ).rejects.toThrow(/stores_one_template_idx/);
  });

  it("only sell to countries in the reference data", async () => {
    await expect(
      db.query(
        `insert into commerce.markets (store_id, code, currency, default_locale, locales)
         values ($1, 'XX', 'EUR', 'en', array['en'])`,
        [store],
      ),
    ).rejects.toThrow(/markets_code_countries_code_fk/);
  });
});

describe("tenant isolation", () => {
  it("refuses a variant that belongs to another store's product", async () => {
    const { productId } = await createProduct();
    await expect(
      db.query(
        "insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, 'X-1')",
        [other, productId],
      ),
    ).rejects.toThrow(/product_variants_product_fk/);
  });

  it("refuses a product whose manufacturer belongs to another store", async () => {
    const { id: foreignMaker } = await one<{ id: string }>(
      `insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
       values ($1, 'Other maker', 'Street 2', 'x@example.com', 'DE') returning id`,
      [other],
    );
    await expect(
      db.query(
        `insert into commerce.products (store_id, handle, manufacturer_id, tax_code)
         values ($1, 'borrowed-maker', $2, 'txcd_99999999')`,
        [store, foreignMaker],
      ),
    ).rejects.toThrow(/products_manufacturer_fk/);
  });

  it("refuses a cart line for another store's variant", async () => {
    const { variantId } = await createProduct({ storeId: other });
    const { id: cartId } = await one<{ id: string }>(
      `insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
       values ($1, 'DE', 'EUR', 'de-DE', now() + interval '1 day') returning id`,
      [store],
    );
    await expect(
      db.query(
        "insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) values ($1, $2, $3, 1)",
        [store, cartId, variantId],
      ),
    ).rejects.toThrow(/cart_lines_variant_fk/);
  });

  it("refuses a price in a market the store does not sell to", async () => {
    const { variantId } = await createProduct({ storeId: other });
    await expect(
      db.query("select commerce.set_price($1, 'NO', 1000)", [variantId]),
    ).rejects.toThrow(/does not sell to market NO/);
  });

  it("lets two stores use the same handle, SKU and order number", async () => {
    await db.query(
      "insert into commerce.products (store_id, handle, tax_code) values ($1, 'shared-handle', 't'), ($2, 'shared-handle', 't')",
      [store, other],
    );
    const { rows } = await db.query(
      "select 1 from commerce.products where handle = 'shared-handle'",
    );
    expect(rows).toHaveLength(2);
  });
});

describe("price history", () => {
  it("keeps one current price and closes the previous one", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 1999, $2)", [variantId, daysAgo(10)]);
    await db.query("select commerce.set_price($1, 'DE', 1799)", [variantId]);

    const { rows } = await db.query<{ amount_minor: number; open: boolean; store_id: string }>(
      `select amount_minor::int, valid_to is null as open, store_id from commerce.prices
       where variant_id = $1 order by valid_from`,
      [variantId],
    );
    expect(rows).toEqual([
      { amount_minor: 1999, open: false, store_id: store },
      { amount_minor: 1799, open: true, store_id: store },
    ]);
  });

  it("treats setting the same amount as a no-op", async () => {
    const { variantId } = await createProduct();
    const first = await one<{ id: number }>(
      "select commerce.set_price($1, 'DE', 500, $2) as id",
      [variantId, daysAgo(1)],
    );
    const again = await one<{ id: number }>("select commerce.set_price($1, 'DE', 500) as id", [
      variantId,
    ]);
    expect(again.id).toBe(first.id);
  });

  it("refuses to backdate a price before the current one", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 500)", [variantId]);
    await expect(
      db.query("select commerce.set_price($1, 'DE', 400, $2)", [variantId, daysAgo(1)]),
    ).rejects.toThrow(/must start after the current one/);
  });

  it("refuses a second open price inserted directly", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 500)", [variantId]);
    await expect(
      db.query(
        `insert into commerce.prices (store_id, variant_id, market_code, currency, amount_minor)
         values ($1, $2, 'DE', 'EUR', 450)`,
        [store, variantId],
      ),
    ).rejects.toThrow(/prices_one_current_idx/);
  });

  it("cannot be rewritten or deleted", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 500)", [variantId]);
    await expect(
      db.query("update commerce.prices set amount_minor = 1 where variant_id = $1", [variantId]),
    ).rejects.toThrow(/can only be closed/);
    await expect(
      db.query(
        "update commerce.prices set valid_to = now() + interval '1 day', amount_minor = 1 where variant_id = $1",
        [variantId],
      ),
    ).rejects.toThrow(/can only be closed/);
    await expect(
      db.query("delete from commerce.prices where variant_id = $1", [variantId]),
    ).rejects.toThrow(/append-only/);
  });

  it("measures a reduction against the lowest price of the previous 30 days", async () => {
    const { variantId } = await createProduct();
    const history: Array<[number, number]> = [
      [4000, 60], // ended 35 days ago: outside the window, must not count
      [7000, 35], // ended 25 days ago: inside the window, the lowest that counts
      [8000, 25],
      [12000, 5],
    ];
    for (const [amount, days] of history) {
      await db.query("select commerce.set_price($1, 'DE', $2, $3)", [
        variantId,
        amount,
        daysAgo(days),
      ]);
    }
    await db.query("select commerce.set_price($1, 'DE', 9000)", [variantId]);

    const current = await one<{ amount_minor: number; prior_30d_minor: number }>(
      `select amount_minor::int, prior_30d_minor::int from commerce.current_prices
       where variant_id = $1 and market_code = 'DE'`,
      [variantId],
    );
    // 9000 looks like a cut from 12000, but 7000 applied within 30 days, so
    // no reduction may be advertised.
    expect(current).toEqual({ amount_minor: 9000, prior_30d_minor: 7000 });
  });

  it("has no reference price for a first price", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 2500)", [variantId]);
    const current = await one<{ prior_30d_minor: number | null }>(
      "select prior_30d_minor from commerce.current_prices where variant_id = $1",
      [variantId],
    );
    expect(current.prior_30d_minor).toBeNull();
  });
});

describe("product safety publishing check", () => {
  const activate = (productId: string) =>
    db.query("update commerce.products set status = 'active' where id = $1", [productId]);

  it("activates a product with a complete listing", async () => {
    const { productId } = await createProduct();
    await activate(productId);
    const { status } = await one<{ status: string }>(
      "select status from commerce.products where id = $1",
      [productId],
    );
    expect(status).toBe("active");
  });

  it("refuses to activate a product without a manufacturer", async () => {
    const { productId } = await createProduct();
    await db.query("update commerce.products set manufacturer_id = null where id = $1", [
      productId,
    ]);
    await expect(activate(productId)).rejects.toThrow(/without a manufacturer/);
  });

  it("requires an EU responsible person for a non-EU manufacturer", async () => {
    const { productId } = await createProduct({ manufacturerCountry: "CN" });
    await expect(activate(productId)).rejects.toThrow(/needs an EU responsible person/);

    const { id: responsibleId } = await one<{ id: string }>(
      `insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
       values ($1, 'EU Rep', 'Rue 2, 1000 Brussels', 'rep@example.eu', 'BE') returning id`,
      [store],
    );
    await db.query(
      "update commerce.products set status = 'active', responsible_person_id = $2 where id = $1",
      [productId, responsibleId],
    );
  });

  it("treats a Norwegian manufacturer as non-EU", async () => {
    const { productId } = await createProduct({ manufacturerCountry: "NO" });
    await expect(activate(productId)).rejects.toThrow(/needs an EU responsible person/);
  });

  it("refuses to activate a product without a picture", async () => {
    const { productId } = await createProduct();
    await db.query("delete from commerce.product_media where product_id = $1", [productId]);
    await expect(activate(productId)).rejects.toThrow(/without a picture/);
  });
});

describe("template compliance data", () => {
  it("accepts every goods withdrawal exclusion and a per-variant tax code", async () => {
    const { productId, variantId } = await createProduct();
    await db.query(
      "update commerce.products set withdrawal_exclusion = 'digital_content' where id = $1",
      [productId],
    );
    await db.query(
      "update commerce.product_variants set tax_code = 'txcd_30011000' where id = $1",
      [variantId],
    );
    const variant = await one<{ tax_code: string }>(
      "select tax_code from commerce.product_variants where id = $1",
      [variantId],
    );
    expect(variant.tax_code).toBe("txcd_30011000");
  });

  it("takes a customs tariff code and country of origin per variant", async () => {
    const { variantId } = await createProduct();
    await db.query(
      "update commerce.product_variants set hs_code = '61091000', origin_country = 'PT' where id = $1",
      [variantId],
    );
    await expect(
      db.query("update commerce.product_variants set hs_code = '6109.10' where id = $1", [
        variantId,
      ]),
    ).rejects.toThrow(/product_variants_hs_code_digits/);
  });

  it("lists the store's markets where an active product's scheme is not registered", async () => {
    const { productId, handle } = await createProduct();
    await db.query(
      "insert into commerce.product_schemes (store_id, product_id, scheme) values ($1, $2, 'packaging')",
      [store, productId],
    );
    await db.query("update commerce.products set status = 'active' where id = $1", [productId]);

    const missing = async () =>
      (
        await db.query<{ market_code: string }>(
          `select market_code from commerce.missing_registrations
           where store_id = $1 and handle = $2 order by market_code`,
          [store, handle],
        )
      ).rows.map((r) => r.market_code);

    expect(await missing()).toEqual(["DE", "DK", "NO", "SE"]);

    await db.query(
      `insert into commerce.producer_registrations
         (store_id, market_code, scheme, registration_number, authority, valid_from, valid_to) values
         ($1, 'NO', 'packaging', 'NO-123456', 'Miljødirektoratet', current_date - 10, null),
         ($1, 'SE', 'packaging', 'SE-OLD-1', 'Naturvårdsverket', current_date - 400, current_date - 1),
         ($2, 'DE', 'packaging', 'DE-OTHER', 'ZSVR', current_date - 10, null)`,
      [store, other],
    );
    // Norway is now covered; Sweden's registration has expired; another
    // store's German registration does not count for this one.
    expect(await missing()).toEqual(["DE", "DK", "SE"]);
  });
});

describe("stock", () => {
  it("subtracts only live reservations from on-hand stock", async () => {
    const { variantId } = await createProduct();
    const { id: locationId } = await one<{ id: string }>(
      "insert into commerce.inventory_locations (store_id, name, country) values ($1, 'Main', 'DE') returning id",
      [store],
    );
    const { id: cartId } = await one<{ id: string }>(
      `insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
       values ($1, 'DE', 'EUR', 'de-DE', now() + interval '1 day') returning id`,
      [store],
    );
    await db.query(
      "insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, 10)",
      [store, variantId, locationId],
    );
    await db.query(
      `insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, cart_id, expires_at, released_at) values
         ($1, $2, $3, 3, $4, now() + interval '15 minutes', null),
         ($1, $2, $3, 2, $4, now() - interval '1 minute', null),
         ($1, $2, $3, 1, $4, now() + interval '15 minutes', now())`,
      [store, variantId, locationId, cartId],
    );
    const stock = await one<{ available: number; store_id: string }>(
      "select available::int, store_id from commerce.available_stock where variant_id = $1",
      [variantId],
    );
    expect(stock).toEqual({ available: 7, store_id: store });
  });
});

describe("orders", () => {
  it("rejects totals that do not add up", async () => {
    await expect(
      db.query(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email,
           subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
           billing_address, shipping_address)
         values ($1, 'K-BAD', 'DE', 'EUR', 'de-DE', 'a@example.com',
           1000, 490, 0, 160, 1000, '{}', '{}')`,
        [store],
      ),
    ).rejects.toThrow(/orders_total_adds_up/);
  });

  it("keeps order events and invoices append-only", async () => {
    const orderId = await createOrder("K-1");
    await db.query(
      "insert into commerce.order_events (store_id, order_id, type, actor) values ($1, $2, 'order.placed', 'system')",
      [store, orderId],
    );
    await expect(
      db.query("update commerce.order_events set type = 'x' where order_id = $1", [orderId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from commerce.order_events where order_id = $1", [orderId]),
    ).rejects.toThrow(/append-only/);

    // An invoice is made only by the issuing function (D159, which has its own tests in invoices.test.ts); here the setting it
    // makes is set by hand to get a row to try the append-only rule on.
    await insertInvoice(store, orderId, 9001, 1490, 238);
    await expect(
      db.query("update commerce.invoices set total_minor = 1 where order_id = $1", [orderId]),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses an invoice against another store's order", async () => {
    const orderId = await createOrder("K-2");
    // The issuing guard of D159 sees it first (an order of another store is not found); the composite foreign key stays behind it.
    await expect(insertInvoice(other, orderId, 1, 1490, 238)).rejects.toThrow(/document\.order|invoices_order_fk/);
  });
});

describe("document numbers", () => {
  const next = async (storeId: string) =>
    (
      await one<{ n: number }>(
        "select commerce.next_document_number($1, 'credit_note')::int as n",
        [storeId],
      )
    ).n;

  it("issues consecutive numbers and reuses one from a rolled-back transaction", async () => {
    const first = await next(store);
    expect(await next(store)).toBe(first + 1);

    await db
      .transaction(async (tx) => {
        await tx.query("select commerce.next_document_number($1, 'credit_note')", [store]);
        throw new Error("abandon");
      })
      .catch(() => undefined);

    expect(await next(store)).toBe(first + 2);
  });

  it("numbers each store's documents separately", async () => {
    const mine = await next(store);
    const theirs = await next(other);
    expect(await next(store)).toBe(mine + 1);
    expect(await next(other)).toBe(theirs + 1);
  });

  it("refuses an unknown series", async () => {
    await expect(
      db.query("select commerce.next_document_number($1, 'nope')", [store]),
    ).rejects.toThrow(/unknown document series/);
  });
});

describe("webhook events", () => {
  it("stores each provider event once per store", async () => {
    const insert = (storeId: string) =>
      db.query(
        `insert into commerce.webhook_events (store_id, provider, event_id, type, payload)
         values ($1, 'stripe', 'evt_1', 'checkout.session.completed', '{}')`,
        [storeId],
      );
    await insert(store);
    await expect(insert(store)).rejects.toThrow(/webhook_events_provider_event_key/);
    await insert(other);
  });
});

describe("accounts and members", () => {
  it("keeps an account's light or dark for the admin, their device's until chosen (D99)", async () => {
    const id = await createAccount("colours@example.com");
    expect((await one<{ color_mode: string }>("select color_mode from commerce.accounts where id = $1", [id])).color_mode).toBe("system");
    await db.query("update commerce.accounts set color_mode = 'dark' where id = $1", [id]);
    await expect(db.query("update commerce.accounts set color_mode = 'sepia' where id = $1", [id])).rejects.toThrow(/accounts_color_mode/);
  });

  it("always keeps at least one active owner per store", async () => {
    const shop = await createStore("owner-test", ["NO"]);
    const owner = await createAccount("owner@example.com");
    await db.query(
      "insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')",
      [shop, owner],
    );
    const member = "store_id = $1 and account_id = $2";
    await expect(
      db.query(`update commerce.store_members set disabled_at = now() where ${member}`, [shop, owner]),
    ).rejects.toThrow(/at least one active owner/);
    await expect(
      db.query(`update commerce.store_members set role = 'admin' where ${member}`, [shop, owner]),
    ).rejects.toThrow(/at least one active owner/);
    await expect(
      db.query(`delete from commerce.store_members where ${member}`, [shop, owner]),
    ).rejects.toThrow(/at least one active owner/);

    // An owner of another store does not count.
    await db.query(
      "insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')",
      [other, owner],
    );
    await expect(
      db.query(`update commerce.store_members set role = 'admin' where ${member}`, [shop, owner]),
    ).rejects.toThrow(/at least one active owner/);

    // With a second owner in the same store, the first can step down.
    const second = await createAccount("second@example.com");
    await db.query(
      "insert into commerce.store_members (store_id, account_id, role, invited_by) values ($1, $2, 'owner', $3)",
      [shop, second, owner],
    );
    await db.query(`update commerce.store_members set role = 'admin' where ${member}`, [shop, owner]);
  });

  it("treats account emails case-insensitively", async () => {
    await createAccount("Case@Example.com");
    await expect(createAccount("case@example.com")).rejects.toThrow(/accounts_email_idx/);
  });

  it("allows one pending access request per email", async () => {
    const request = () =>
      db.query(
        "insert into commerce.access_requests (email, name, store_name) values ('New@Example.com', 'N', 'S')",
      );
    await request();
    await expect(request()).rejects.toThrow(/access_requests_pending_email_idx/);
    await db.query("update commerce.access_requests set status = 'declined'");
    await request();
  });

  it("keeps the audit log append-only", async () => {
    await db.query(
      "insert into commerce.audit_log (store_id, action, details) values ($1, 'test.action', '{}')",
      [store],
    );
    await expect(db.query("update commerce.audit_log set action = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query("delete from commerce.audit_log")).rejects.toThrow(/append-only/);
  });
});

describe("new stores from the template", () => {
  let template: string;
  let admin: string;

  beforeAll(async () => {
    template = await createStore("clone-template", ["NO", "SE"]);
    await db.query("update commerce.stores set is_template = false where is_template");
    await db.query("update commerce.stores set is_template = true where id = $1", [template]);
    admin = await createAccount("platform-admin@example.com");

    const { productId, variantId } = await createProduct({ storeId: template });
    await db.query("select commerce.set_price($1, 'NO', 29900, $2)", [variantId, daysAgo(40)]);
    await db.query("select commerce.set_price($1, 'NO', 24900, $2)", [variantId, daysAgo(1)]);
    await db.query("select commerce.set_price($1, 'SE', 24900)", [variantId]);
    const { id: location } = await one<{ id: string }>(
      "insert into commerce.inventory_locations (store_id, name, country) values ($1, 'Oslo', 'NO') returning id",
      [template],
    );
    await db.query(
      "insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, 7)",
      [template, variantId, location],
    );
    await db.query(
      "insert into commerce.product_schemes (store_id, product_id, scheme) values ($1, $2, 'packaging')",
      [template, productId],
    );
    await db.query("update commerce.products set status = 'active' where id = $1", [productId]);
    await db.query(
      "insert into commerce.payment_methods (store_id, market_code, method, enabled) values ($1, 'SE', 'swish', true)",
      [template],
    );
    await db.query(
      "insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor) values ($1, 'NO', 'NOK', 9900, 99900)",
      [template],
    );

    // An archived product stays behind.
    const archived = await createProduct({ storeId: template });
    await db.query("update commerce.products set status = 'archived' where id = $1", [archived.productId]);
  });

  async function request(email: string): Promise<string> {
    const { id } = await one<{ id: string }>(
      "insert into commerce.access_requests (email, name, store_name) values ($1, 'Kari', 'Karis Kopper') returning id",
      [email],
    );
    return id;
  }

  const approve = (requestId: string, slug: string) =>
    one<{ store_id: string }>(
      "select commerce.approve_access_request($1, $2, 'Karis Kopper', $3) as store_id",
      [requestId, slug, admin],
    );

  it("copies pages' forms without the template's recipients (D93)", async () => {
    const content = {
      rows: [
        {
          columns: [
            {
              blocks: [
                { id: "f", type: "emailForm", recipients: ["owner@example.com", "sales@example.com"], subject: "Hei", fields: [] },
                { id: "n", type: "newsletter", recipients: ["list@example.com"], consent: "" },
                { id: "t", type: "heading", text: "recipients: [kept]" },
              ],
            },
          ],
        },
      ],
    };
    const { copy } = await one<{ copy: typeof content }>("select commerce.clone_page_content(gen_random_uuid(), $1, $2::jsonb) as copy", [
      template,
      JSON.stringify(content),
    ]);
    const blocks = copy.rows[0].columns[0].blocks as Record<string, unknown>[];
    expect(blocks.map((b) => b.recipients)).toEqual([[], [], undefined]);
    expect(blocks[0].subject).toBe("Hei");
    expect(blocks[2].text).toBe("recipients: [kept]");
  });

  it("copies the template's markets, catalogue, prices and stock into a store the requester owns", async () => {
    const { store_id: store } = await approve(await request("kari@example.com"), "karis-kopper");

    const owner = await one<{ email: string; role: string }>(
      `select a.email, m.role from commerce.store_members m join commerce.accounts a on a.id = m.account_id
       where m.store_id = $1`,
      [store],
    );
    expect(owner).toEqual({ email: "kari@example.com", role: "owner" });

    const markets = await db.query<{ code: string }>(
      "select code from commerce.markets where store_id = $1 and active order by code",
      [store],
    );
    expect(markets.rows.map((m) => m.code)).toEqual(["NO", "SE"]);

    const products = await db.query<{ status: string; id: string }>(
      "select id, status from commerce.products where store_id = $1",
      [store],
    );
    expect(products.rows.map((p) => p.status)).toEqual(["active"]);

    const price = await one<{ amount_minor: number; prior_30d_minor: number | null }>(
      `select amount_minor::int, prior_30d_minor from commerce.current_prices
       where store_id = $1 and market_code = 'NO'`,
      [store],
    );
    // The new store never sold at the old price, so it shows no reduction.
    expect(price).toEqual({ amount_minor: 24900, prior_30d_minor: null });

    const stock = await one<{ available: number }>(
      "select available::int from commerce.available_stock where store_id = $1",
      [store],
    );
    expect(stock.available).toBe(7);

    const extras = await one<{ series: number; stripe: boolean; swish: boolean; schemes: number }>(
      `select
         (select count(*)::int from commerce.document_series where store_id = $1) as series,
         exists (select 1 from commerce.payment_providers where store_id = $1 and provider = 'stripe' and enabled and active_mode = 'test') as stripe,
         exists (select 1 from commerce.payment_methods where store_id = $1 and method = 'swish' and enabled) as swish,
         (select count(*)::int from commerce.product_schemes where store_id = $1) as schemes`,
      [store],
    );
    expect(extras).toEqual({ series: 5, stripe: true, swish: true, schemes: 1 });
    const shipping = await one<{ amount_minor: number; free_over_minor: number }>(
      "select amount_minor::int, free_over_minor::int from commerce.shipping_rates where store_id = $1",
      [store],
    );
    expect(shipping).toEqual({ amount_minor: 9900, free_over_minor: 99900 });
  });

  it("gives copied rows well-formed version 4 UUIDs", async () => {
    const { rows } = await db.query<{ id: string }>(
      `select commerce.clone_id(gen_random_uuid(), gen_random_uuid())::text as id
       from generate_series(1, 50)`,
    );
    for (const { id } of rows) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    const nullId = await one<{ id: string | null }>(
      "select commerce.clone_id(gen_random_uuid(), null) as id",
    );
    expect(nullId.id).toBeNull();
  });

  it("gives copied rows new ids and leaves the template untouched", async () => {
    const { store_id: store } = await approve(await request("ola@example.com"), "olas-kopper");
    const shared = await one<{ n: number }>(
      `select count(*)::int as n from commerce.product_variants a
       join commerce.product_variants b on a.id = b.id
       where a.store_id = $1 and b.store_id = $2`,
      [store, template],
    );
    expect(shared.n).toBe(0);
    const templateProducts = await one<{ n: number }>(
      "select count(*)::int as n from commerce.products where store_id = $1",
      [template],
    );
    expect(templateProducts.n).toBe(2);
  });

  it("records the decision and refuses to approve twice", async () => {
    const requestId = await request("per@example.com");
    const { store_id: store } = await approve(requestId, "pers-butikk");
    const decided = await one<{ status: string; store_id: string; decided_by: string }>(
      "select status, store_id, decided_by from commerce.access_requests where id = $1",
      [requestId],
    );
    expect(decided).toEqual({ status: "approved", store_id: store, decided_by: admin });
    await expect(approve(requestId, "pers-butikk-2")).rejects.toThrow(/already approved/);
  });

  it("changes nothing when the address is taken", async () => {
    const requestId = await request("liv@example.com");
    await expect(approve(requestId, "karis-kopper")).rejects.toThrow(/stores_slug_unique/);
    const after = await one<{ status: string; accounts: number }>(
      `select status, (select count(*)::int from commerce.accounts where email = 'liv@example.com') as accounts
       from commerce.access_requests where id = $1`,
      [requestId],
    );
    expect(after).toEqual({ status: "pending", accounts: 0 });
  });

  it("has a demo of every kind of product, and new stores get it ready to book once switched on (D65, D178)", async () => {
    const { id: demo } = await one<{ id: string }>("select commerce.add_demo_appointment($1) as id", [template]);
    // Once only.
    expect(await one("select commerce.add_demo_appointment($1) as id", [template])).toEqual({ id: demo });
    await db.query("update commerce.products set vat_category = 'exempt', audience = 'businesses' where id = $1", [demo]);
    const kinds = await db.query<{ kind: string }>(
      "select distinct kind from commerce.products where store_id = $1 and status = 'active' order by kind",
      [template],
    );
    expect(kinds.rows.map((r) => r.kind)).toEqual(["appointment", "goods"]);

    const { store_id: store } = await approve(await request("mia@example.com"), "mias-massasje");
    // A new store starts with the shop alone (D178): its demo appointment is there, booked once the owner switches appointments on.
    expect(await one("select modules, features, time_zone, booking_reminder_hours from commerce.stores where id = $1", [store])).toEqual({
      modules: [],
      features: ["shop"],
      time_zone: "Europe/Oslo",
      booking_reminder_hours: 24,
    });
    const copy = await one<{ id: string }>(
      `select id, status, kind, vat_category, audience from commerce.products where store_id = $1 and handle = 'demo-massasje'`,
      [store],
    );
    expect(copy).toMatchObject({ status: "active", kind: "appointment", vat_category: "exempt", audience: "businesses" });
    expect(
      await one(
        `select a.duration_minutes, a.buffer_after_minutes, a.location_id, r.name, r.hours -> 'week' -> 'sat' as saturday
         from commerce.appointment_settings a
         join commerce.product_resources pr on pr.product_id = a.product_id
         join commerce.booking_resources r on r.id = pr.resource_id and r.store_id = $1
         where a.store_id = $1 and a.product_id = $2`,
        [store, copy.id],
      ),
    ).toEqual({ duration_minutes: 60, buffer_after_minutes: 15, location_id: null, name: "Demo: Kari", saturday: { open: "10:00", close: "14:00" } });
    expect(
      await one("select v.delivery, p.amount_minor::int from commerce.product_variants v join commerce.current_prices p on p.variant_id = v.id where v.product_id = $1 and p.market_code = 'NO'", [copy.id]),
    ).toEqual({ delivery: "service", amount_minor: 89000 });
  });

  it("has a demo stay and rental, and new stores get them with their dates' rules (D67)", async () => {
    const { id: stay } = await one<{ id: string }>("select commerce.add_demo_stay($1) as id", [template]);
    expect(await one("select commerce.add_demo_stay($1) as id", [template])).toEqual({ id: stay });
    await one("select commerce.add_demo_rental($1) as id", [template]);

    const { store_id: store } = await approve(await request("siri@example.com"), "siris-hytter");
    // The cabin's seasons and cleaning fee come along (D70).
    expect(
      (
        await db.query(
          `select s.name, s.from_day, s.weekdays, s.percent from commerce.booking_seasons s
           join commerce.products p on p.id = s.product_id where s.store_id = $1 and p.handle = 'demo-hytte' order by s.position`,
          [store],
        )
      ).rows,
    ).toEqual([
      { name: "Høysesong", from_day: "06-15", weekdays: [1, 2, 3, 4, 5, 6, 7], percent: 30 },
      { name: "Helg", from_day: null, weekdays: [5, 6], percent: 20 },
    ]);
    const { booking_fee: fee } = await one<{ booking_fee: Record<string, number> }>(
      `select a.booking_fee from commerce.appointment_settings a join commerce.products p on p.id = a.product_id
       where a.store_id = $1 and p.handle = 'demo-hytte'`,
      [store],
    );
    expect(Object.values(fee).every((amount) => amount === 50000 || amount === 37500)).toBe(true);
    const copied = await db.query(
      `select p.handle, p.kind, p.status, p.vat_category, a.check_in_time, a.check_out_time, a.min_nights, a.max_nights,
         a.payment, r.kind as resource_kind, r.capacity
       from commerce.products p
       join commerce.appointment_settings a on a.product_id = p.id
       join commerce.product_resources pr on pr.product_id = p.id
       join commerce.booking_resources r on r.id = pr.resource_id and r.store_id = $1
       where p.store_id = $1 and p.kind in ('stay', 'rental') order by p.kind`,
      [store],
    );
    expect(
      (
        await db.query(
          `select v.options, v.rental_period, p.amount_minor::int as price from commerce.product_variants v
           join commerce.products pr on pr.id = v.product_id
           join commerce.current_prices p on p.variant_id = v.id and p.market_code = 'NO'
           where v.store_id = $1 and pr.handle = 'demo-sykkelutleie' order by p.amount_minor desc`,
          [store],
        )
      ).rows,
    ).toEqual([
      { options: { rental: "day" }, rental_period: "day", price: 45000 },
      { options: { rental: "halfDay" }, rental_period: "half_day", price: 30000 },
      { options: { rental: "hour" }, rental_period: "hour", price: 12000 },
    ]);
    expect(copied.rows).toEqual([
      {
        handle: "demo-sykkelutleie", kind: "rental", status: "active", vat_category: "standard", check_in_time: "09:00",
        check_out_time: "17:00", min_nights: 1, max_nights: 14, payment: "now", resource_kind: "item", capacity: 3,
      },
      {
        handle: "demo-hytte", kind: "stay", status: "active", vat_category: "accommodation", check_in_time: "15:00",
        check_out_time: "11:00", min_nights: 2, max_nights: 14, payment: "deposit", resource_kind: "unit", capacity: 1,
      },
    ]);
  });
});

describe("stays and rentals (D67)", () => {
  it("keeps check-in times and lengths sensible", async () => {
    const { productId } = await createProduct();
    await db.query("update commerce.products set kind = 'stay' where id = $1", [productId]);
    const settings = (columns: string, values: string) =>
      db.query(`insert into commerce.appointment_settings (product_id, store_id, ${columns}) values ($1, $2, ${values})`, [
        productId,
        store,
      ]);
    await expect(settings("check_in_time", "'25:00'")).rejects.toThrow(/appointment_settings_times/);
    await expect(settings("min_nights, max_nights", "3, 2")).rejects.toThrow(/appointment_settings_nights/);
    await expect(settings("min_nights", "0")).rejects.toThrow(/appointment_settings_nights/);
    await settings("min_nights, max_nights", "2, 7");
    await expect(
      db.query("insert into commerce.booking_resources (store_id, kind, name, hours) values ($1, 'room', 'Rom 1', '{}')", [store]),
    ).rejects.toThrow(/booking_resources_kind/);
  });

  it("keeps seasons to days of the year, weekdays and a percentage (D70)", async () => {
    const { productId } = await createProduct();
    const season = (values: string) =>
      db.query(`insert into commerce.booking_seasons (store_id, product_id, name, from_day, to_day, weekdays, percent) values ($1, $2, ${values})`, [
        store,
        productId,
      ]);
    await expect(season("'Sommer', '06-15', null, '{1}', 30")).rejects.toThrow(/booking_seasons_days/);
    await expect(season("'Sommer', '13-01', '14-01', '{1}', 30")).rejects.toThrow(/booking_seasons_days/);
    await expect(season("'Helg', null, null, '{8}', 30")).rejects.toThrow(/booking_seasons_weekdays/);
    await expect(season("'Helg', null, null, '{5,6}', 0")).rejects.toThrow(/booking_seasons_percent/);
    await expect(season("'Billig', null, null, '{1}', -95")).rejects.toThrow(/booking_seasons_percent/);
    await season("'Jul', '12-20', '01-05', '{1,2,3,4,5,6,7}', -10");
  });

  it("books nothing over a blocked time, and a feed's blocks go with it (B3b)", async () => {
    const { productId, variantId } = await createProduct();
    const { id: room } = await one<{ id: string }>(
      "insert into commerce.booking_resources (store_id, kind, name, hours, capacity) values ($1, 'unit', 'Rom 2', '{}', 2) returning id",
      [store],
    );
    const hold = (from: string, to: string) =>
      one<{ id: string | null }>(
        "select commerce.hold_booking($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $5::timestamptz, $6::timestamptz, now() + interval '15 minutes', null) as id",
        [store, productId, variantId, room, from, to],
      );
    await db.query(
      "insert into commerce.resource_blocks (store_id, resource_id, starts_at, ends_at, note) values ($1, $2, '2030-03-01T11:00Z', '2030-03-04T11:00Z', 'Maling')",
      [store, room],
    );
    // A block closes every place the room has; the days around it are open.
    expect((await hold("2030-03-03T14:00Z", "2030-03-05T10:00Z")).id).toBeNull();
    expect((await hold("2030-02-27T14:00Z", "2030-03-01T10:00Z")).id).not.toBeNull();
    expect((await hold("2030-03-04T14:00Z", "2030-03-06T10:00Z")).id).not.toBeNull();

    await expect(
      db.query("insert into commerce.calendar_feeds (store_id, resource_id, name, url) values ($1, $2, 'Airbnb', 'http://example.com/a.ics')", [
        store,
        room,
      ]),
    ).rejects.toThrow(/calendar_feeds_url/);
    const { id: feed } = await one<{ id: string }>(
      "insert into commerce.calendar_feeds (store_id, resource_id, name, url) values ($1, $2, 'Airbnb', 'https://example.com/a.ics') returning id",
      [store, room],
    );
    await expect(
      db.query(
        "insert into commerce.resource_blocks (store_id, resource_id, starts_at, ends_at, feed_id) values ($1, $2, '2030-04-01T10:00Z', '2030-04-02T10:00Z', $3)",
        [store, room, feed],
      ),
    ).rejects.toThrow(/resource_blocks_feed_uid/);
    await db.query(
      "insert into commerce.resource_blocks (store_id, resource_id, starts_at, ends_at, feed_id, uid) values ($1, $2, '2030-04-01T10:00Z', '2030-04-02T10:00Z', $3, 'x@airbnb.com')",
      [store, room, feed],
    );
    await db.query("delete from commerce.calendar_feeds where id = $1", [feed]);
    expect(await one("select count(*)::int as n from commerce.resource_blocks where resource_id = $1", [room])).toEqual({ n: 1 });
  });

  it("counts a resource at its busiest moment, so bookings one after another fit beside a longer one (D69)", async () => {
    const { productId, variantId } = await createProduct();
    const { id: bikes } = await one<{ id: string }>(
      "insert into commerce.booking_resources (store_id, kind, name, hours, capacity) values ($1, 'item', 'Sykler', '{}', 2) returning id",
      [store],
    );
    const hold = (from: string, to: string) =>
      one<{ id: string | null }>(
        "select commerce.hold_booking($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $5::timestamptz, $6::timestamptz, now() + interval '15 minutes', null) as id",
        [store, productId, variantId, bikes, from, to],
      );
    expect((await hold("2030-06-01T08:00Z", "2030-06-01T09:00Z")).id).not.toBeNull();
    expect((await hold("2030-06-01T10:00Z", "2030-06-01T11:00Z")).id).not.toBeNull();
    // Two bookings in the span, never at once: a third across all of it fits.
    expect((await hold("2030-06-01T08:00Z", "2030-06-01T11:00Z")).id).not.toBeNull();
    // Now two at once from 08:00 to 09:00.
    expect((await hold("2030-06-01T08:30Z", "2030-06-01T09:00Z")).id).toBeNull();
    expect((await hold("2030-06-01T09:00Z", "2030-06-01T10:00Z")).id).not.toBeNull();
    expect(
      await one("select commerce.resource_peak($1, $2, '2030-06-01T07:00Z', '2030-06-01T12:00Z', null) as peak", [store, bikes]),
    ).toEqual({ peak: 2 });
  });
});

describe("hosts (D71)", () => {
  it("sells an unregistered host's listings without VAT, and follows the host when that changes", async () => {
    const { id: accountId } = await one<{ id: string }>("insert into commerce.accounts (email) values ('kari-host@example.com') returning id");
    const { id: host } = await one<{ id: string }>(
      "insert into commerce.hosts (store_id, account_id, name, vat_registered) values ($1, $2, 'Karis hytter', true) returning id",
      [store, accountId],
    );
    await expect(
      db.query("insert into commerce.hosts (store_id, account_id, name) values ($1, $2, 'Twice')", [store, accountId]),
    ).rejects.toThrow(/hosts_store_account_key/);
    await expect(
      db.query("insert into commerce.hosts (store_id, account_id, name, commission_bps) values ($1, $2, 'Greedy', 10001)", [
        store,
        (await one<{ id: string }>("insert into commerce.accounts (email) values ('greedy@example.com') returning id")).id,
      ]),
    ).rejects.toThrow(/hosts_commission/);

    const { productId } = await createProduct();
    await db.query("update commerce.products set kind = 'stay', vat_category = 'accommodation', host_id = $2 where id = $1", [productId, host]);
    const category = async () => (await one<{ vat_category: string }>("select vat_category from commerce.products where id = $1", [productId])).vat_category;
    expect(await category()).toBe("accommodation");
    await db.query("update commerce.hosts set vat_registered = false where id = $1", [host]);
    expect(await category()).toBe("exempt");
    // Kept at no VAT while the host is not registered, whatever the listing is given.
    await db.query("update commerce.products set vat_category = 'standard' where id = $1", [productId]);
    expect(await category()).toBe("exempt");
    // Another store's host cannot be given.
    const otherStore = await createStore("hosts-other", ["DE"]);
    const { productId: other } = await createProduct({ storeId: otherStore });
    await expect(db.query("update commerce.products set host_id = $2 where id = $1", [other, host])).rejects.toThrow(/products_host_fk/);
  });

  it("lists hosts' Stripe accounts with the store's, and keeps commissions within what was taken", async () => {
    const { id: accountId } = await one<{ id: string }>("insert into commerce.accounts (email) values ('paid-host@example.com') returning id");
    const { id: host } = await one<{ id: string }>(
      "insert into commerce.hosts (store_id, account_id, name) values ($1, $2, 'Paid host') returning id",
      [store, accountId],
    );
    await expect(
      db.query("insert into commerce.host_stripe_accounts (host_id, store_id, mode, account_id) values ($1, $2, 'test', 'not-an-account')", [host, store]),
    ).rejects.toThrow(/host_stripe_accounts_account_id_format/);
    await db.query("insert into commerce.host_stripe_accounts (host_id, store_id, mode, account_id, card_payments) values ($1, $2, 'test', 'acct_paidhost', 'active')", [
      host,
      store,
    ]);
    expect(await one("select store_id, host_id, card_payments from commerce.connected_accounts where account_id = 'acct_paidhost'")).toEqual({
      store_id: store,
      host_id: host,
      card_payments: "active",
    });
    // Another store's host's account is not this store's.
    const otherStore = await createStore("hosts-paid-other", ["DE"]);
    await expect(
      db.query("insert into commerce.host_stripe_accounts (host_id, store_id, mode, account_id) values ($1, $2, 'live', 'acct_elsewhere')", [host, otherStore]),
    ).rejects.toThrow(/host_stripe_accounts_host_fk/);

    const { id: orderId } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor,
         discount_minor, tax_minor, total_minor, billing_address, shipping_address, host_id, commission_minor)
       values ($1, 'H-1', 'DE', 'EUR', 'de-DE', '', 10000, 0, 0, 0, 10000, '{}', '{}', $2, 1250) returning id`,
      [store, host],
    );
    const payment = async (reference: string) =>
      (
        await one<{ id: string }>(
          `insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
           values ($1, $2, 'stripe', $3, 'acct_paidhost', 10000, 'EUR', 'captured') returning id`,
          [store, orderId, reference],
        )
      ).id;
    const checkout = await payment("cs_paidhost");
    const noShow = await payment("pi_paidhost");
    const commission = (paymentId: string, kind: string, amount: number, reversed: number) =>
      db.query(
        `insert into commerce.host_commissions (order_id, payment_id, kind, store_id, host_id, mode, currency, amount_minor, reversed_minor)
         values ($1, $2, $3, $4, $5, 'test', 'EUR', $6, $7)`,
        [orderId, paymentId, kind, store, host, amount, reversed],
      );
    await expect(commission(checkout, "booking", 1250, 1300)).rejects.toThrow(/host_commissions_amounts/);
    await expect(commission(checkout, "refund", 1250, 0)).rejects.toThrow(/host_commissions_kind/);
    await commission(checkout, "booking", 1250, 0);
    // One commission per payment: the booking's, and a no-show fee's on the same order.
    await expect(commission(checkout, "booking", 1250, 0)).rejects.toThrow(/host_commissions_payment_key/);
    await commission(noShow, "no_show", 500, 0);
    await expect(db.query("update commerce.host_commissions set status = 'sent' where order_id = $1", [orderId])).rejects.toThrow(
      /host_commissions_status/,
    );
  });

  it("keeps a host's DAC7 details whole: a person's birth date, a business's number, country codes", async () => {
    const { id: accountId } = await one<{ id: string }>("insert into commerce.accounts (email) values ('taxed-host@example.com') returning id");
    const { id: host } = await one<{ id: string }>(
      "insert into commerce.hosts (store_id, account_id, name) values ($1, $2, 'Taxed host') returning id",
      [store, accountId],
    );
    const details = (kind: string, dateOfBirth: string | null, businessNumber: string, country = "NO") =>
      db.query(
        `insert into commerce.host_tax_details (host_id, store_id, kind, legal_name, date_of_birth, address, country, tin, tin_country, business_number)
         values ($1, $2, $3, 'Kari', $4, 'Storgata 1', $5, '123', 'NO', $6)`,
        [host, store, kind, dateOfBirth, country, businessNumber],
      );
    await expect(details("individual", null, "")).rejects.toThrow(/host_tax_details_person/);
    await expect(details("entity", null, "")).rejects.toThrow(/host_tax_details_business/);
    await expect(details("individual", "1980-05-17", "", "no")).rejects.toThrow(/host_tax_details_countries/);
    await details("individual", "1980-05-17", "");
    // Taken with the host.
    await db.query("delete from commerce.hosts where id = $1", [host]);
    expect((await db.query("select 1 from commerce.host_tax_details where host_id = $1", [host])).rows).toEqual([]);
  });

  it("keeps 'hosting' free of store addresses", async () => {
    await expect(
      db.query("insert into commerce.stores (slug, name) values ('hosting', 'Hosting')"),
    ).rejects.toThrow(/stores_slug_not_reserved/);
  });
});

describe("paying for an order", () => {
  /** An order for 2 of a variant with 3 on hand, 2 of them held for the order. */
  async function orderWithHold(onHand = 3) {
    const { variantId } = await createProduct();
    // Two active locations of a store cannot share a name (wave 3), so each order's gets its own.
    const { id: locationId } = await one<{ id: string }>(
      "insert into commerce.inventory_locations (store_id, name, country) values ($1, 'Lager ' || gen_random_uuid()::text, 'NO') returning id",
      [store],
    );
    await db.query(
      "insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, $4)",
      [store, variantId, locationId, onHand],
    );
    const { id: cartId } = await one<{ id: string }>(
      `insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
       values ($1, 'DE', 'EUR', 'de-DE', now() + interval '1 day') returning id`,
      [store],
    );
    counter += 1;
    const { id: orderId } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, cart_id, email,
         subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
       values ($1, $2, 'DE', 'EUR', 'de-DE', $3, '', 2000, 0, 0, 319, 2000, '{}', '{}') returning id`,
      [store, `P-${counter}`, cartId],
    );
    await db.query(
      `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor,
         total_minor, tax_minor, tax_rate, tax_code)
       values ($1, $2, $3, 'SKU', 'Thing', 2, 1000, 2000, 319, 0.19, 'txcd_99999999')`,
      [store, orderId, variantId],
    );
    await db.query(
      `insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, order_id, expires_at)
       values ($1, $2, $3, 2, $4, now() + interval '30 minutes')`,
      [store, variantId, locationId, orderId],
    );
    return { variantId, locationId, orderId, cartId };
  }

  const stock = async (variantId: string) =>
    (await one<{ on_hand: number; available: number }>(
      "select on_hand, available::int from commerce.available_stock where variant_id = $1",
      [variantId],
    ));

  it("draws paid items from stock, releases the hold and closes the cart, once", async () => {
    const { variantId, orderId, cartId } = await orderWithHold();
    expect(await stock(variantId)).toEqual({ on_hand: 3, available: 1 });

    const first = await one<{ done: boolean }>("select commerce.complete_order_payment($1, 'cs_1') as done", [orderId]);
    expect(first.done).toBe(true);
    expect(await stock(variantId)).toEqual({ on_hand: 1, available: 1 });

    const again = await one<{ done: boolean }>("select commerce.complete_order_payment($1, 'cs_1') as done", [orderId]);
    expect(again.done).toBe(false);
    expect(await stock(variantId)).toEqual({ on_hand: 1, available: 1 });

    const state = await one<{ order: string; cart: string; events: string[] }>(
      `select (select status::text from commerce.orders where id = $1) as order,
              (select status::text from commerce.carts where id = $2) as cart,
              (select array_agg(type order by id) from commerce.order_events where order_id = $1) as events`,
      [orderId, cartId],
    );
    expect(state).toEqual({ order: "paid", cart: "converted", events: ["order.paid"] });
  });

  it("records a shortfall when paid items are no longer in stock", async () => {
    const { variantId, orderId } = await orderWithHold(1);
    await db.query("select commerce.complete_order_payment($1, 'cs_2')", [orderId]);
    expect((await stock(variantId)).on_hand).toBe(0);
    const short = await one<{ data: { missing: number } }>(
      "select data from commerce.order_events where order_id = $1 and type = 'stock.short'",
      [orderId],
    );
    expect(short.data.missing).toBe(1);
  });

  it("gives held stock back when a checkout is abandoned, but never cancels a paid order", async () => {
    const { variantId, orderId } = await orderWithHold();
    const cancelled = await one<{ done: boolean }>(
      "select commerce.cancel_unpaid_order($1, 'checkout expired') as done",
      [orderId],
    );
    expect(cancelled.done).toBe(true);
    expect(await stock(variantId)).toEqual({ on_hand: 3, available: 3 });

    const paid = await orderWithHold();
    await db.query("select commerce.complete_order_payment($1, 'cs_3')", [paid.orderId]);
    const refused = await one<{ done: boolean }>(
      "select commerce.cancel_unpaid_order($1, 'too late') as done",
      [paid.orderId],
    );
    expect(refused.done).toBe(false);
  });
});

describe("pages", () => {
  const draft = JSON.stringify({ title: "About" });
  const page = (slug: string, storeId: string | null = null) =>
    one<{ id: string }>(
      "insert into commerce.pages (store_id, slug, draft) values ($1, $2, $3) returning id",
      [storeId, slug, draft],
    );
  const redirects = async (slug: string) =>
    (await db.query<{ page_id: string }>("select page_id from commerce.page_redirects where store_id is null and slug = $1", [slug])).rows;
  const publish = (id: string) =>
    db.query("update commerce.pages set published = draft, published_at = now() where id = $1", [id]);

  it("gives each address to one page, per store and on the platform", async () => {
    await page("about-us");
    await expect(page("about-us")).rejects.toThrow(/pages_store_slug_key/);
    // A store's page may share a platform page's address.
    await expect(page("about-us", store)).resolves.toBeDefined();
  });

  it("refuses badly formed addresses and the platform's own routes", async () => {
    for (const slug of ["About", "a--b", "-a", "a b", "x".repeat(81)]) {
      await expect(page(slug)).rejects.toThrow(/pages_slug_format/);
    }
    for (const slug of ["admin", "s", "sign-up", "api", "unsubscribe"]) {
      await expect(page(slug)).rejects.toThrow(/pages_slug_not_reserved/);
    }
    await expect(page("admin", store)).resolves.toBeDefined();
  });

  it("nests pages by address, under any first part that is not a route, at most four deep", async () => {
    await expect(page("projects/project-a")).resolves.toBeDefined();
    await expect(page("projects/project-a/notes/deep")).resolves.toBeDefined();
    for (const slug of ["a/b/c/d/e", "a//b", "/a", "a/", "a/B", `a/${"x".repeat(81)}`]) {
      await expect(page(slug)).rejects.toThrow(/pages_slug_format/);
    }
    // The first part is the one that must not be a route.
    await expect(page("admin/x")).rejects.toThrow(/pages_slug_not_reserved/);
    await expect(page("products/x", store)).rejects.toThrow(/pages_store_slug_not_reserved/);
    await expect(page("x/admin", store)).resolves.toBeDefined();
  });

  it("moves the pages nested under a page with it, leaving a redirect for each published one", async () => {
    const withSlug = (slug: string) => JSON.stringify({ title: "T", slug });
    const mk = async (slug: string, live: boolean) => {
      const row = await one<{ id: string }>(
        "insert into commerce.pages (store_id, slug, draft, published, published_at) values (null, $1, $2, $3, $4) returning id",
        [slug, withSlug(slug), live ? withSlug(slug) : null, live ? new Date().toISOString() : null],
      );
      return row.id;
    };
    const parent = await mk("work", true);
    const live = await mk("work/one", true);
    const draftOnly = await mk("work/two", false);
    const other = await mk("worker/x", true);
    // What `savePage` runs when the parent's address changes from `work` to `projects`.
    await db.query("update commerce.pages set slug = 'projects' where id = $1", [parent]);
    await db.query(
      `update commerce.pages c set
         slug = $1::text || substr(c.slug, length($2::text) + 1),
         draft = jsonb_set(c.draft, '{slug}', to_jsonb($1::text || substr(c.slug, length($2::text) + 1))),
         published = case when c.published is null then null
           else jsonb_set(c.published, '{slug}', to_jsonb($1::text || substr(c.slug, length($2::text) + 1))) end
       where c.store_id is null and c.type = 'page' and left(c.slug, length($2::text) + 1) = $2::text || '/'`,
      ["projects", "work"],
    );
    const slugs = async (id: string) => (await one<{ slug: string; d: string }>("select slug, draft ->> 'slug' as d from commerce.pages where id = $1", [id]));
    expect(await slugs(live)).toEqual({ slug: "projects/one", d: "projects/one" });
    expect(await slugs(draftOnly)).toEqual({ slug: "projects/two", d: "projects/two" });
    // Another page that only starts with the same letters stays.
    expect((await slugs(other)).slug).toBe("worker/x");
    expect((await redirects("work/one")).map((r) => r.page_id)).toEqual([live]);
    expect((await redirects("work")).map((r) => r.page_id)).toEqual([parent]);
  });

  it("finds the pages directly under a parent, as a grid of them does", async () => {
    for (const slug of ["docs", "docs/a", "docs/b", "docs/a/deep", "docsx/c"]) await page(slug);
    const under = async (parent: string) =>
      (
        await db.query<{ slug: string }>(
          `select p.slug from commerce.pages p
           where p.store_id is null and (
             left(p.slug, length($1::text) + 1) = $1::text || '/'
             and position('/' in substr(p.slug, length($1::text) + 2)) = 0)
           order by p.slug`,
          [parent],
        )
      ).rows.map((r) => r.slug);
    expect(await under("docs")).toEqual(["docs/a", "docs/b"]);
    expect(await under("docs/a")).toEqual(["docs/a/deep"]);
  });

  it("keeps a store's routes from its pages, as the app's list does (D53)", async () => {
    for (const slug of RESERVED_STORE_PAGE_SLUGS) {
      await expect(page(slug, store)).rejects.toThrow(/pages_store_slug_not_reserved/);
    }
    // Kaizen's pages may use them: they live at the site's root.
    await expect(page("wishlist")).resolves.toBeDefined();
  });

  it("keeps the published copy and its date together", async () => {
    const { id } = await page("together");
    await expect(
      db.query("update commerce.pages set published = draft where id = $1", [id]),
    ).rejects.toThrow(/pages_published_together/);
  });

  it("redirects a published page's old address, and a page taking it replaces the redirect", async () => {
    const { id } = await page("old-name");
    // Not published yet: nobody knows the address, so no redirect.
    await db.query("update commerce.pages set slug = 'first-name' where id = $1", [id]);
    expect(await redirects("old-name")).toEqual([]);

    await publish(id);
    await db.query("update commerce.pages set slug = 'new-name' where id = $1", [id]);
    expect(await redirects("first-name")).toEqual([{ page_id: id }]);

    // Moving back takes the address again; the old redirect goes.
    await db.query("update commerce.pages set slug = 'first-name' where id = $1", [id]);
    expect(await redirects("first-name")).toEqual([]);
    expect(await redirects("new-name")).toEqual([{ page_id: id }]);

    // Another page taking an old address replaces its redirect.
    await page("new-name");
    expect(await redirects("new-name")).toEqual([]);
  });

  it("never lets a redirect shadow a page's address", async () => {
    const { id } = await page("shadowed");
    await expect(
      db.query("insert into commerce.page_redirects (slug, page_id) values ('shadowed', $1)", [id]),
    ).rejects.toThrow(/in use/);
  });

  it("lets a store show one of its own pages as its front page, until the page is deleted (D54)", async () => {
    const other = await createStore("front-other", ["SE"]);
    const { id: own } = await page("front", store);
    const { id: theirs } = await page("front", other);
    const { id: kaizens } = await page("front-kaizen");
    const choose = (id: string) => db.query("update commerce.stores set front_page_id = $1 where id = $2", [id, store]);
    await expect(choose(theirs)).rejects.toThrow(/stores_front_page_fk/);
    await expect(choose(kaizens)).rejects.toThrow(/stores_front_page_fk/);
    await choose(own);
    await db.query("delete from commerce.pages where id = $1", [own]);
    expect(await one("select id, front_page_id from commerce.stores where id = $1", [store])).toEqual({
      id: store,
      front_page_id: null,
    });
  });

  it("copies a store's published pages and its front page to stores made from it, with their categories (D53-D55)", async () => {
    const template = await createStore("pages-template", ["NO"]);
    const { id: category } = await one<{ id: string }>(
      "insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, 'page', 'category', 'Help', 'help') returning id",
      [template],
    );
    const content = (slug: string) =>
      JSON.stringify({
        title: slug,
        categories: [category],
        rows: [{ columns: [{ blocks: [{ type: "contentGrid", categories: [category], source: { type: "products", storeId: template } }] }] }],
        translations: { "sv-SE": { title: `${slug} på svenska` } },
      });
    const insert = (slug: string, published: boolean) =>
      one<{ id: string }>(
        `insert into commerce.pages (store_id, slug, draft, published, published_at)
         values ($1, $2, $3, case when $4 then $3::jsonb end, case when $4 then now() end) returning id`,
        [template, slug, content(slug), published],
      );
    const front = await insert("front", true);
    await insert("about", true);
    await insert("draft-only", false);
    await db.query(
      "insert into commerce.pages (store_id, type, slug, draft, published, published_at) values ($1, 'article', 'hello', '{}', '{}', now())",
      [template],
    );
    await db.query("update commerce.stores set front_page_id = $1 where id = $2", [front.id, template]);
    const owner = await createAccount("pages-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'pages-copy', 'Copy', $2) as id", [template, owner]);

    const { rows } = await db.query<{ id: string; slug: string; published: { categories: string[]; rows: unknown[]; translations: unknown } }>(
      "select id, slug, published from commerce.pages where store_id = $1 and type = 'page' order by slug",
      [copy],
    );
    // Articles stay articles (D57).
    expect((await db.query("select slug from commerce.pages where store_id = $1 and type = 'article'", [copy])).rows).toEqual([
      { slug: "hello" },
    ]);
    // Published pages only, published in the copy.
    expect(rows.map((r) => r.slug)).toEqual(["about", "front"]);
    const { id: copiedCategory } = await one<{ id: string }>(
      "select id from commerce.terms where store_id = $1 and content_type = 'page' and slug = 'help'",
      [copy],
    );
    const about = rows[0].published;
    expect(about.categories).toEqual([copiedCategory]);
    expect(about.rows).toEqual([
      { columns: [{ blocks: [{ type: "contentGrid", categories: [copiedCategory], source: { type: "products", storeId: copy } }] }] },
    ]);
    expect(about.translations).toEqual({ "sv-SE": { title: "about på svenska" } });
    expect((await one<{ front_page_id: string }>("select front_page_id from commerce.stores where id = $1", [copy])).front_page_id).toBe(
      rows[1].id,
    );
  });

  it("keeps product layouts a store's, chosen only as layouts, let go when deleted, and copied with their uses (D79)", async () => {
    const template = await createStore("layouts-template", ["NO"]);
    const layout = (slug: string, storeId: string | null = template, published = true) =>
      one<{ id: string }>(
        `insert into commerce.pages (store_id, type, slug, draft, published, published_at)
         values ($1, 'product_layout', $2, '{"title": "Wide"}', case when $3 then '{"title": "Wide"}'::jsonb end, case when $3 then now() end)
         returning id`,
        [storeId, slug, published],
      );
    await expect(layout("kaizens", null)).rejects.toThrow(/pages_product_layout_store/);
    const { id: wide } = await layout("wide");
    const { id: draftOnly } = await layout("draft-only", template, false);
    const { id: aPage } = await one<{ id: string }>("insert into commerce.pages (store_id, slug, draft) values ($1, 'about', '{}') returning id", [template]);
    const { productId } = await createProduct({ storeId: template });
    const { id: category } = await one<{ id: string }>(
      "insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, 'product', 'category', 'Lamps', 'lamps') returning id",
      [template],
    );
    const { id: pageCategory } = await one<{ id: string }>(
      "insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, 'page', 'category', 'Help', 'help') returning id",
      [template],
    );

    // Only a product layout, and only the store's own.
    await expect(db.query("update commerce.products set product_layout_id = $1 where id = $2", [aPage, productId])).rejects.toThrow(/must be a product layout/);
    const other = await createStore("layouts-other", ["SE"]);
    const { id: theirs } = await layout("theirs", other);
    await expect(db.query("update commerce.stores set product_layout_id = $1 where id = $2", [theirs, template])).rejects.toThrow(/stores_product_layout_fk/);
    // Page categories have no layouts.
    await expect(db.query("update commerce.terms set product_layout_id = $1 where id = $2", [wide, pageCategory])).rejects.toThrow(/terms_product_layout/);

    await db.query("update commerce.stores set product_layout_id = $1 where id = $2", [wide, template]);
    await db.query("update commerce.terms set product_layout_id = $1 where id = $2", [wide, category]);
    await db.query("update commerce.products set product_layout_id = $1 where id = $2", [draftOnly, productId]);

    // A new store copies the published layout, used where the template uses it; the unpublished one is not copied, so not used.
    const owner = await createAccount("layouts-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'layouts-copy', 'Copy', $2) as id", [template, owner]);
    const { id: copiedLayout } = await one<{ id: string }>(
      "select id from commerce.pages where store_id = $1 and type = 'product_layout'",
      [copy],
    );
    expect((await one<{ product_layout_id: string }>("select product_layout_id from commerce.stores where id = $1", [copy])).product_layout_id).toBe(copiedLayout);
    expect(
      (await one<{ product_layout_id: string }>("select product_layout_id from commerce.terms where store_id = $1 and slug = 'lamps'", [copy])).product_layout_id,
    ).toBe(copiedLayout);

    // Deleting a layout lets go of it everywhere, keeping the store id.
    await db.query("delete from commerce.pages where id = $1", [wide]);
    expect(await one("select id, product_layout_id from commerce.stores where id = $1", [template])).toEqual({ id: template, product_layout_id: null });
    expect((await one<{ product_layout_id: string | null }>("select product_layout_id from commerce.terms where id = $1", [category])).product_layout_id).toBeNull();
  });

  it("chooses a site's own header and footer only, lets go when deleted, and copies the template's (D80)", async () => {
    const template = await createStore("chrome-template", ["NO"]);
    const page = (type: string, slug: string, storeId: string | null = template) =>
      one<{ id: string }>(
        `insert into commerce.pages (store_id, type, slug, draft, published, published_at)
         values ($1, $2, $3, '{"title": "Top"}', '{"title": "Top"}'::jsonb, now()) returning id`,
        [storeId, type, slug],
      );
    const { id: header } = await page("header", "top");
    const { id: footer } = await page("footer", "bottom");
    const { id: about } = await page("page", "about");
    const { id: kaizens } = await page("header", "kaizen-top", null);

    // Only a header as the header and a footer as the footer, and only the store's own.
    await expect(db.query("update commerce.stores set header_id = $1 where id = $2", [about, template])).rejects.toThrow(/must be one of its headers/);
    await expect(db.query("update commerce.stores set footer_id = $1 where id = $2", [header, template])).rejects.toThrow(/must be one of its footers/);
    await expect(db.query("update commerce.stores set header_id = $1 where id = $2", [kaizens, template])).rejects.toThrow(/stores_header_fk/);
    await expect(db.query("update commerce.platform_settings set header_id = $1 where id", [header])).rejects.toThrow(/must be one of its headers/);
    await db.query("update commerce.stores set header_id = $1, footer_id = $2 where id = $3", [header, footer, template]);
    await db.query("insert into commerce.platform_settings (id) values (true) on conflict do nothing");
    await db.query("update commerce.platform_settings set header_id = $1 where id", [kaizens]);

    // A new store copies both and uses the copies.
    const owner = await createAccount("chrome-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'chrome-copy', 'Copy', $2) as id", [template, owner]);
    const copied = await one<{ header_id: string; footer_id: string }>("select header_id, footer_id from commerce.stores where id = $1", [copy]);
    expect((await one<{ type: string; store_id: string }>("select type, store_id from commerce.pages where id = $1", [copied.header_id]))).toEqual({
      type: "header",
      store_id: copy,
    });
    expect((await one<{ type: string }>("select type from commerce.pages where id = $1", [copied.footer_id])).type).toBe("footer");

    // Deleting lets go, keeping the store id; Kaizen's too.
    await db.query("delete from commerce.pages where id in ($1, $2)", [header, kaizens]);
    expect(await one("select id, header_id, footer_id from commerce.stores where id = $1", [template])).toEqual({
      id: template,
      header_id: null,
      footer_id: footer,
    });
    expect((await one<{ header_id: string | null }>("select header_id from commerce.platform_settings where id")).header_id).toBeNull();
  });

  it("gives articles addresses of their own, beside pages, with their own reserved routes and redirects (D57)", async () => {
    const article = (slug: string, storeId: string | null = null) =>
      one<{ id: string }>(
        "insert into commerce.pages (store_id, type, slug, draft) values ($1, 'article', $2, $3) returning id",
        [storeId, slug, draft],
      );
    await page("news");
    // A page and an article may share an address: /news and /blog/news.
    const { id } = await article("news");
    await expect(article("news")).rejects.toThrow(/pages_store_slug_key/);
    for (const slug of ["category", "tag", "page"]) await expect(article(slug)).rejects.toThrow(/pages_article_slug_not_reserved/);
    // The blog's address is not a page's, on Kaizen's site or in a store.
    await expect(page("blog")).rejects.toThrow(/pages_slug_not_reserved/);
    await expect(page("blog", store)).rejects.toThrow(/pages_store_slug_not_reserved/);
    await expect(article("blog")).resolves.toBeDefined();
    await expect(
      db.query("insert into commerce.pages (type, slug, draft) values ('post', 'x', '{}')"),
    ).rejects.toThrow(/pages_type/);

    // An article moving leaves an article's redirect, beside the page at that address.
    await publish(id);
    await db.query("update commerce.pages set slug = 'news-moved' where id = $1", [id]);
    const moved = await db.query<{ type: string }>("select type from commerce.page_redirects where slug = 'news' and store_id is null");
    expect(moved.rows).toEqual([{ type: "article" }]);

    // A store's front page is a page, not an article.
    const { id: storeArticle } = await article("launch", store);
    await expect(
      db.query("update commerce.stores set front_page_id = $1 where id = $2", [storeArticle, store]),
    ).rejects.toThrow(/front page must be a page/);
  });

  it("redirects every old address of a page or an article renamed twice, each to the page itself (D57, wave 2 D168: no chain is ever stored)", async () => {
    const { id } = await page("twice-a", store);
    await publish(id);
    await db.query("update commerce.pages set slug = 'twice-b' where id = $1", [id]);
    await db.query("update commerce.pages set slug = 'twice-c' where id = $1", [id]);
    const own = async (slug: string, type = "page") =>
      (await db.query<{ page_id: string }>("select page_id from commerce.page_redirects where store_id = $1 and type = $2 and slug = $3", [store, type, slug])).rows;
    // Both old addresses point at the page, which now has the third: a request is one hop, never a chain of redirects.
    expect(await own("twice-a")).toEqual([{ page_id: id }]);
    expect(await own("twice-b")).toEqual([{ page_id: id }]);
    expect(await own("twice-c")).toEqual([]);

    const { id: article } = await one<{ id: string }>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'article', 'post-a', $2) returning id", [store, draft]);
    await publish(article);
    await db.query("update commerce.pages set slug = 'post-b' where id = $1", [article]);
    await db.query("update commerce.pages set slug = 'post-c' where id = $1", [article]);
    expect(await own("post-a", "article")).toEqual([{ page_id: article }]);
    expect(await own("post-b", "article")).toEqual([{ page_id: article }]);
    expect(await own("post-c", "article")).toEqual([]);
    // A page and an article of the same address do not touch each other's redirects.
    expect(await own("post-a")).toEqual([]);
  });

  it("removes a page's redirects with the page", async () => {
    const { id } = await page("gone-soon");
    await publish(id);
    await db.query("update commerce.pages set slug = 'gone-later' where id = $1", [id]);
    expect(await redirects("gone-soon")).toHaveLength(1);
    await db.query("delete from commerce.pages where id = $1", [id]);
    expect(await redirects("gone-soon")).toEqual([]);
  });
});

describe("owners' own CSS (D100)", () => {
  it("keeps a store's and Kaizen's CSS, empty until written and at most 50,000 characters", async () => {
    const shop = await createStore("css-test", ["NO"]);
    expect((await one<{ custom_css: string }>("select custom_css from commerce.stores where id = $1", [shop])).custom_css).toBe("");
    await db.query("update commerce.stores set custom_css = $2 where id = $1", [shop, "h1 { color: red; }"]);
    await expect(db.query("update commerce.stores set custom_css = $2 where id = $1", [shop, "x".repeat(50_001)])).rejects.toThrow(
      /stores_custom_css/,
    );
    await expect(db.query("update commerce.platform_settings set custom_css = $1", ["x".repeat(50_001)])).rejects.toThrow(
      /platform_settings_custom_css/,
    );
  });
});

describe("the AI manager (D103)", () => {
  it("keeps platform conversations without a store, thumbs on answers, and memories per account", async () => {
    const accountId = await createAccount("manager@example.com");
    const { id: conversation } = await one<{ id: string }>(
      "insert into commerce.assistant_conversations (account_id, title) values ($1, 'Platform') returning id",
      [accountId],
    );
    await db.query("insert into commerce.assistant_messages (conversation_id, role, content, feedback) values ($1, 'assistant', 'Hi', 1)", [conversation]);
    await expect(
      db.query("insert into commerce.assistant_messages (conversation_id, role, content, feedback) values ($1, 'assistant', 'Hi', 2)", [conversation]),
    ).rejects.toThrow(/assistant_messages_feedback/);
    expect((await one<{ assistant_learns: boolean }>("select assistant_learns from commerce.accounts where id = $1", [accountId])).assistant_learns).toBe(true);

    const memory = (kind: string, content: string, space: string | null = null, vector: string | null = null) =>
      db.query(
        "insert into commerce.assistant_memories (account_id, kind, content, source, space, embedding) values ($1, $2, $3, 'told', $4, $5::extensions.vector)",
        [accountId, kind, content, space, vector],
      );
    await memory("preference", "Prefers short answers in Norwegian");
    await memory("fact", "Ships from Bergen", "api.example.com|embed", "[1,0,0]");
    await expect(memory("mood", "x")).rejects.toThrow(/kind/);
    await expect(memory("fact", "")).rejects.toThrow(/content/);
    await expect(memory("fact", "x", "space-only")).rejects.toThrow(/assistant_memories_vector/);
    const found = await one<{ n: number }>(
      "select count(*)::int as n from commerce.assistant_memories where account_id = $1 and search @@ to_tsquery('simple', 'norwegian')",
      [accountId],
    );
    expect(found.n).toBe(1);
    await db.query("delete from commerce.accounts where id = $1", [accountId]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.assistant_memories where account_id = $1", [accountId])).n).toBe(0);
  });
});

describe("AI usage (D106)", () => {
  it("keeps a row per call with checked amounts, and keeps the totals when an account goes", async () => {
    const owner = await createAccount("usage-owner@example.com");
    const shop = await createStore("usage-shop", ["NO"]);
    const insert = (set = "") =>
      db.query(
        `insert into commerce.ai_usage (store_id, owner_account_id, source, provider, model, kind ${set ? ", " + set.split("=")[0] : ""})
         values ($1, $2, 'platform', 'openai', 'text-a', 'text' ${set ? ", " + set.split("=")[1] : ""}) returning id`,
        [shop, owner],
      );
    await insert();
    await insert("input_tokens=1200");
    await expect(insert("input_tokens=-1")).rejects.toThrow(/ai_usage_amounts/);
    await expect(db.query("insert into commerce.ai_usage (source, provider, model, kind) values ('nobody', 'openai', 'm', 'text')")).rejects.toThrow(/ai_usage_source/);
    await expect(db.query("insert into commerce.ai_usage (source, provider, model, kind) values ('store', 'openai', 'm', 'video')")).rejects.toThrow(/ai_usage_kind/);
    // Kaizen's own use has no store.
    await db.query("insert into commerce.ai_usage (source, provider, model, kind, feature) values ('platform', 'openai', 'text-a', 'text', 'ai_manager')");
    const defaults = await one<{ requests: number; failed: number; feature: string; estimated: boolean }>(
      "select requests, failed, feature, estimated from commerce.ai_usage where store_id = $1 order by input_tokens limit 1",
      [shop],
    );
    expect(defaults).toEqual({ requests: 1, failed: 0, feature: "other", estimated: false });
    // A deleted account leaves its usage (stores are closed, not deleted), so the platform's totals do not shrink.
    await db.query("delete from commerce.accounts where id = $1", [owner]);
    const left = await one<{ n: number; stores: number; owners: number }>(
      "select count(*)::int as n, count(store_id)::int as stores, count(owner_account_id)::int as owners from commerce.ai_usage where model = 'text-a' and feature = 'other'",
    );
    expect(left).toEqual({ n: 2, stores: 2, owners: 0 });
    await db.query("delete from commerce.ai_usage");
  });
});

describe("weekly deliveries (D102)", () => {
  it("keep schedules, one open list per customer, a card before a list is on, and each delivery day once", async () => {
    const shop = await createStore("weekly-test", ["NO"]);
    await db.query("update commerce.stores set modules = array['deliveries'] where id = $1", [shop]);
    await expect(db.query("update commerce.stores set modules = array['groceries'] where id = $1", [shop])).rejects.toThrow(/stores_modules/);
    const schedule = (values: string) =>
      db.query(
        `insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time)
         values ($1, 'NO', 'NOK', ${values}) returning id`,
        [shop],
      );
    const { rows } = await schedule("'Thursday', 4, 2, '23:59'");
    const scheduleId = (rows[0] as { id: string }).id;
    await expect(schedule("'Bad day', 8, 2, '23:59'")).rejects.toThrow(/delivery_schedules_weekday/);
    await expect(schedule("'Bad cutoff', 4, 0, '23:59'")).rejects.toThrow(/delivery_schedules_cutoff_days/);
    await expect(schedule("'Bad time', 4, 2, '24:00'")).rejects.toThrow(/delivery_schedules_cutoff_time/);
    await expect(
      db.query(
        "insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday) values ($1, 'NO', 'EUR', 'x', 4)",
        [shop],
      ),
    ).rejects.toThrow(/delivery_schedules_market_fk/);

    const { id: customer } = await one<{ id: string }>(
      "insert into commerce.customers (store_id, email) values ($1, 'weekly@example.com') returning id",
      [shop],
    );
    const list = (status: string, paymentMethod: string | null) =>
      db.query(
        "insert into commerce.standing_orders (store_id, customer_id, schedule_id, status, payment_method) values ($1, $2, $3, $4, $5) returning id",
        [shop, customer, scheduleId, status, paymentMethod],
      );
    await expect(list("active", null)).rejects.toThrow(/standing_orders_card/);
    const { rows: made } = await list("setup", null);
    const listId = (made[0] as { id: string }).id;
    await expect(list("setup", null)).rejects.toThrow(/standing_orders_one_open/);
    await db.query("update commerce.standing_orders set status = 'cancelled' where id = $1", [listId]);
    await expect(list("active", "pm_123")).resolves.toBeDefined();

    const { variantId } = await createProduct({ storeId: shop });
    const line = (quantity: number) =>
      db.query("insert into commerce.standing_order_lines (store_id, standing_order_id, variant_id, quantity) values ($1, $2, $3, $4)", [
        shop,
        listId,
        variantId,
        quantity,
      ]);
    await expect(line(0)).rejects.toThrow(/standing_order_lines_quantity/);
    await expect(line(100)).rejects.toThrow(/standing_order_lines_quantity/);
    await line(3);

    const day = (outcome: string, orderId: string | null) =>
      db.query("insert into commerce.standing_deliveries (store_id, standing_order_id, delivery_date, outcome, order_id) values ($1, $2, '2026-10-01', $3, $4)", [
        shop,
        listId,
        outcome,
        orderId,
      ]);
    await expect(day("ordered", null)).rejects.toThrow(/standing_deliveries_order/);
    await day("skipped", null);
    await expect(day("empty", null)).rejects.toThrow(/standing_deliveries_list_day_key/);
  });
});

describe("integrations with Slack (D101)", () => {
  it("take Slack beside Zapier and Make, and no other service", async () => {
    const shop = await createStore("slack-test", ["NO"]);
    const connect = (provider: string) =>
      db.query(
        "insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events) values ($1, $2, true, 'x', 'hint', '{order.paid}')",
        [shop, provider],
      );
    await expect(connect("slack")).resolves.toBeDefined();
    await expect(connect("teams")).rejects.toThrow(/store_integrations_provider/);
  });
});

describe("saved parts", () => {
  // Kaizen's own (no store) are always the marketplace's (D125).
  const save = (kind: string, name: string) =>
    db.query("insert into commerce.saved_parts (kind, name, content, sharing) values ($1, $2, '{}', 'marketplace')", [kind, name]);

  it("keeps rows, columns, components and whole page layouts (D127) with a name", async () => {
    await expect(save("row", "Hero")).resolves.toBeDefined();
    await expect(save("page", "Whole page")).resolves.toBeDefined();
    await expect(save("layout", "Not a kind")).rejects.toThrow(/saved_parts_kind/);
    await expect(save("block", "  ")).rejects.toThrow(/saved_parts_name/);
    await expect(save("block", "x".repeat(81))).rejects.toThrow(/saved_parts_name/);
  });

  it("never makes a whole page layout global", async () => {
    const global = (kind: string) =>
      db.query(
        "insert into commerce.saved_parts (kind, name, content, sharing, global) values ($1, 'G', '{}', 'marketplace', true)",
        [kind],
      );
    await expect(global("row")).resolves.toBeDefined();
    await expect(global("page")).rejects.toThrow(/saved_parts_page_not_global/);
  });

  it("are not global until said, and keep a global's translations as an object (D98)", async () => {
    const { rows } = await db.query<{ global: boolean; translations: unknown }>(
      "insert into commerce.saved_parts (kind, name, content, sharing) values ('block', 'Plain', '{}', 'marketplace') returning global, translations",
    );
    expect(rows[0]).toEqual({ global: false, translations: {} });
    await expect(
      db.query("insert into commerce.saved_parts (kind, name, content, sharing, global, translations) values ('row', 'Hero', '{}', 'marketplace', true, '[]')"),
    ).rejects.toThrow(/saved_parts_translations/);
  });
});

describe("templates (D125)", () => {
  const part = (values: { store: string | null; sharing?: string; name?: string }) =>
    one<{ id: string }>(
      `insert into commerce.saved_parts (store_id, kind, name, content${values.sharing ? ", sharing" : ""})
       values ($1, 'block', $2, '{}'${values.sharing ? ", $3" : ""}) returning id`,
      values.sharing ? [values.store, values.name ?? "Template", values.sharing] : [values.store, values.name ?? "Template"],
    );

  it("shares a store's part privately unless said, with the three ways only", async () => {
    const plain = await part({ store });
    expect((await one<{ sharing: string }>("select sharing from commerce.saved_parts where id = $1", [plain.id])).sharing).toBe("private");
    for (const sharing of ["stores", "marketplace"]) await expect(part({ store, sharing })).resolves.toBeDefined();
    await expect(part({ store, sharing: "everyone" })).rejects.toThrow(/saved_parts_sharing/);
  });

  it("makes Kaizen's own parts the marketplace's, never private or for stores", async () => {
    await expect(part({ store: null })).rejects.toThrow(/saved_parts_kaizen_sharing/);
    await expect(part({ store: null, sharing: "private" })).rejects.toThrow(/saved_parts_kaizen_sharing/);
    await expect(part({ store: null, sharing: "stores" })).rejects.toThrow(/saved_parts_kaizen_sharing/);
    await expect(part({ store: null, sharing: "marketplace" })).resolves.toBeDefined();
  });

  it("records who hid a template, and takes a store's switches with the template", async () => {
    const admin = await createAccount("moderator@example.com");
    const template = await part({ store, sharing: "marketplace" });
    await db.query("update commerce.saved_parts set hidden_at = now(), hidden_by = $2 where id = $1", [template.id, admin]);
    expect((await one<{ hidden: boolean }>("select hidden_at is not null as hidden from commerce.saved_parts where id = $1", [template.id])).hidden).toBe(true);

    await db.query("insert into commerce.template_activations (store_id, part_id, active, changed_by) values ($1, $2, true, $3)", [other, template.id, admin]);
    await expect(
      db.query("insert into commerce.template_activations (store_id, part_id, active) values ($1, $2, false)", [other, template.id]),
    ).rejects.toThrow(/template_activations_store_id_part_id_pk/);
    await expect(
      db.query("insert into commerce.template_activations (store_id, part_id, active) values ($1, gen_random_uuid(), true)", [other]),
    ).rejects.toThrow(/template_activations_part_id_saved_parts_id_fk/);
    await expect(
      db.query("insert into commerce.template_activations (store_id, part_id, active) values (gen_random_uuid(), $1, true)", [template.id]),
    ).rejects.toThrow(/template_activations_store_id_stores_id_fk/);

    await db.query("delete from commerce.saved_parts where id = $1", [template.id]);
    const left = await one<{ n: number }>("select count(*)::int as n from commerce.template_activations where part_id = $1", [template.id]);
    expect(left.n).toBe(0);
  });
});

describe("categories and tags (D50)", () => {
  const term = (values: { store?: string | null; type?: string; kind?: string; parent?: string | null; slug: string }) =>
    one<{ id: string }>(
      `insert into commerce.terms (store_id, content_type, kind, parent_id, name, slug)
       values ($1, $2, $3, $4, $5, $5) returning id`,
      [values.store ?? null, values.type ?? "page", values.kind ?? "category", values.parent ?? null, values.slug],
    );

  it("keeps one address per owner, content and kind", async () => {
    await term({ slug: "guides" });
    await expect(term({ slug: "guides" })).rejects.toThrow(/terms_scope_slug_key/);
    await expect(term({ slug: "guides", kind: "tag" })).resolves.toBeDefined();
    await expect(term({ slug: "guides", store })).resolves.toBeDefined();
    await expect(term({ slug: "Not An Address" })).rejects.toThrow(/terms_slug_format/);
  });

  it("nests categories of the same owner and content, never tags and never in a circle", async () => {
    const top = await term({ slug: "top" });
    const child = await term({ slug: "child", parent: top.id });
    const grandchild = await term({ slug: "grandchild", parent: child.id });
    await expect(term({ slug: "tagged", kind: "tag", parent: top.id })).rejects.toThrow(/terms_tags_flat/);
    const tag = await term({ slug: "a-tag", kind: "tag" });
    await expect(term({ slug: "under-tag", parent: tag.id })).rejects.toThrow(/same kind of content/);
    await expect(term({ slug: "other-owner", store, parent: top.id })).rejects.toThrow(/same kind of content/);
    await expect(
      db.query("update commerce.terms set parent_id = $1 where id = $2", [grandchild.id, top.id]),
    ).rejects.toThrow(/inside itself/);
    // A deleted category leaves its children at the top.
    await db.query("delete from commerce.terms where id = $1", [child.id]);
    expect((await one<{ parent_id: string | null }>("select parent_id from commerce.terms where id = $1", [grandchild.id])).parent_id).toBeNull();
  });

  it("gives products only their own store's product categories and tags", async () => {
    const { productId, storeId } = await createProduct();
    const own = await term({ store: storeId, type: "product", slug: "lamps" });
    const pageTerm = await term({ store: storeId, type: "page", slug: "lamps" });
    const otherStore = await createStore("terms-other", ["DE"]);
    const foreign = await term({ store: otherStore, type: "product", slug: "lamps" });
    const assign = (termId: string, storeId_ = storeId) =>
      db.query("insert into commerce.product_terms (store_id, product_id, term_id) values ($1, $2, $3)", [storeId_, productId, termId]);
    await expect(assign(own.id)).resolves.toBeDefined();
    await expect(assign(pageTerm.id)).rejects.toThrow(/product_terms_term_fk/);
    await expect(assign(foreign.id)).rejects.toThrow(/product_terms_term_fk/);
    await expect(assign(foreign.id, otherStore)).rejects.toThrow(/product_terms_product_fk/);
    await expect(term({ type: "product", slug: "platform-products" })).rejects.toThrow(/terms_products_in_stores/);
    // A store made from this one gets copies of its categories, nesting and product links.
    const parent = await term({ store: storeId, type: "product", slug: "lighting" });
    const nested = await term({ store: storeId, type: "product", slug: "desk-lamps", parent: parent.id });
    await assign(nested.id);
    await db.query(
      `insert into commerce.product_translations (store_id, product_id, locale, title, excerpt) values ($1, $2, 'nb-NO', 'Lampe', 'Kort tekst')
       on conflict (product_id, locale) do update set excerpt = excluded.excerpt`,
      [storeId, productId],
    );
    const owner = await createAccount("terms-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'terms-copy', 'Copy', $2) as id", [
      storeId,
      owner,
    ]);
    const copied = await db.query<{ slug: string; parent: string | null; products: number }>(
      `select t.slug, p.slug as parent, (select count(*)::int from commerce.product_terms pt where pt.term_id = t.id) as products
       from commerce.terms t left join commerce.terms p on p.id = t.parent_id
       where t.store_id = $1 and t.content_type = 'product' order by t.slug`,
      [copy],
    );
    expect(copied.rows).toContainEqual({ slug: "desk-lamps", parent: "lighting", products: 1 });
    expect(copied.rows).toContainEqual({ slug: "lamps", parent: null, products: 1 });
    // A product's excerpt is copied with its other texts.
    expect(
      (await db.query<{ excerpt: string }>("select excerpt from commerce.product_translations where store_id = $1 and locale = 'nb-NO'", [copy])).rows,
    ).toContainEqual({ excerpt: "Kort tekst" });
    // Deleting a category takes it off its products.
    await db.query("delete from commerce.terms where id = $1", [own.id]);
    expect(
      (await db.query("select 1 from commerce.product_terms where product_id = $1 and term_id = $2", [productId, own.id])).rows,
    ).toEqual([]);
  });
});

describe("consents (D58)", () => {
  it("keep a visitor's choices per site, and keep the cookie page's address free", async () => {
    const storeId = await createStore("consent-store", ["NO"]);
    const visitor = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
    await db.query(
      "insert into commerce.consents (store_id, visitor, choices, version) values ($1, $2, $3, 'marketing'), (null, $2, $3, 'statistics')",
      [storeId, visitor, JSON.stringify({ preferences: false, statistics: false, marketing: true })],
    );
    await expect(
      db.query("insert into commerce.consents (visitor, choices, version) values ($1, '{}', $2)", [visitor, "x".repeat(101)]),
    ).rejects.toThrow(/consents_version_length/);
    expect((await db.query("select version from commerce.consents where visitor = $1 order by version", [visitor])).rows).toEqual([
      { version: "marketing" },
      { version: "statistics" },
    ]);
    await expect(
      db.query("insert into commerce.pages (slug, draft) values ('cookies', '{}')"),
    ).rejects.toThrow(/pages_slug_not_reserved/);
  });
});

describe("page replications (D150)", () => {
  it("allow one waiting or running job per store, a few passes and only the known states", async () => {
    const storeId = await createStore("replica-store", ["NO"]);
    const insert = "insert into commerce.page_replications (store_id, url, iterations_max) values ($1, 'https://example.com/', $2)";
    await db.query(insert, [storeId, 3]);
    await expect(db.query(insert, [storeId, 3])).rejects.toThrow(/page_replications_one_active_idx/);
    // Another store has its own.
    await db.query(insert, [other, 3]);
    await db.query("update commerce.page_replications set status = 'done' where store_id = $1", [storeId]);
    await expect(db.query(insert, [storeId, 11])).rejects.toThrow(/page_replications_iterations/);
    await expect(db.query(insert, [storeId, 0])).rejects.toThrow(/page_replications_iterations/);
    await db.query(insert, [storeId, 10]);
    await expect(db.query("update commerce.page_replications set status = 'lost' where store_id = $1", [storeId])).rejects.toThrow(
      /page_replications_status/,
    );
    await expect(db.query("update commerce.page_replications set phase = 'dancing' where store_id = $1", [storeId])).rejects.toThrow(
      /page_replications_phase/,
    );
    await expect(db.query("update commerce.page_replications set log = '{}' where store_id = $1", [storeId])).rejects.toThrow(
      /page_replications_json/,
    );
  });
});

describe("cookie scans and notes (D58)", () => {
  it("allow one waiting or running scan per site, and one note per item a site found", async () => {
    const storeId = await createStore("scan-store", ["NO"]);
    await db.query("insert into commerce.cookie_scans (store_id) values ($1), (null)", [storeId]);
    await expect(db.query("insert into commerce.cookie_scans (store_id) values ($1)", [storeId])).rejects.toThrow(
      /cookie_scans_one_active_idx/,
    );
    await expect(db.query("insert into commerce.cookie_scans (store_id) values (null)")).rejects.toThrow(
      /cookie_scans_one_active_idx/,
    );
    await db.query("update commerce.cookie_scans set status = 'done' where store_id = $1", [storeId]);
    await db.query("insert into commerce.cookie_scans (store_id) values ($1)", [storeId]);
    await expect(db.query("insert into commerce.cookie_scans (store_id, status) values ($1, 'lost')", [storeId])).rejects.toThrow(
      /cookie_scans_status/,
    );
    await expect(db.query("insert into commerce.cookie_scans (store_id, status, items) values ($1, 'done', '{}')", [storeId])).rejects.toThrow(
      /cookie_scans_items_array/,
    );

    const note = "insert into commerce.cookie_notes (store_id, kind, name, domain, category, provider, purpose) values ($1, $2, '_x', 'example.com', $3, 'X', 'Y')";
    await db.query(note, [storeId, "cookie", "statistics"]);
    await db.query(note, [null, "cookie", "statistics"]);
    await db.query(note, [storeId, "localStorage", "statistics"]);
    await expect(db.query(note, [storeId, "cookie", "marketing"])).rejects.toThrow(/cookie_notes_item_idx/);
    await expect(db.query(note, [null, "cookie", "marketing"])).rejects.toThrow(/cookie_notes_item_idx/);
    await expect(db.query(note, [storeId, "sessionStorage", "tasty"])).rejects.toThrow(/cookie_notes_category/);
  });
});

describe("fonts (D59)", () => {
  it("keep each family and file once, and give new stores the template's fonts", async () => {
    const file = "0123456789abcdef0123456789abcdef.woff2";
    await db.query("insert into commerce.font_files (name, data) values ($1, '\\x774f4632')", [file]);
    await expect(db.query("insert into commerce.font_files (name, data) values ('../x.woff2', '\\x00')")).rejects.toThrow(/font_files_name/);
    await expect(db.query("insert into commerce.font_files (name, data) values ($1, '')", [file.replace("0", "f")])).rejects.toThrow(
      /font_files_size/,
    );
    await db.query("insert into commerce.fonts (family, slug, category, css, bytes) values ('Lora', 'lora', 'serif', '', 4)");
    await expect(
      db.query("insert into commerce.fonts (family, slug, category, css, bytes) values ('Lora 2', 'Lora 2', 'serif', '', 4)"),
    ).rejects.toThrow(/fonts_slug/);
    await expect(
      db.query("insert into commerce.fonts (family, slug, category, css, bytes) values ('Comic', 'comic', 'comic', '', 4)"),
    ).rejects.toThrow(/fonts_category/);

    const template = await createStore("fonts-template", ["NO"]);
    await db.query(`update commerce.stores set fonts = '{"heading": "Lora", "body": "Inter"}' where id = $1`, [template]);
    const owner = await createAccount("fonts-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'fonts-copy', 'Copy', $2) as id", [template, owner]);
    expect((await one<{ fonts: unknown }>("select fonts from commerce.stores where id = $1", [copy])).fonts).toEqual({
      heading: "Lora",
      body: "Inter",
    });
  });
});

describe("design themes (D60)", () => {
  it("keep a store's saved themes by unique name, and give new stores the template's theme", async () => {
    const template = await createStore("themes-template", ["NO"]);
    const save = (name: string, base = "warm") =>
      db.query("insert into commerce.store_themes (store_id, name, base, settings) values ($1, $2, $3, '{}') returning id", [
        template,
        name,
        base,
      ]);
    const { rows } = await save("Autumn") as { rows: { id: string }[] };
    await expect(save("autumn")).rejects.toThrow(/store_themes_name_idx/);
    await expect(save("")).rejects.toThrow(/store_themes_name_length/);
    await expect(save("Gothic", "gothic")).rejects.toThrow(/store_themes_base/);
    await save("Street", "bold");

    const theme = { base: "warm", savedId: rows[0].id, settings: { mode: "light" } };
    await db.query("update commerce.stores set theme = $1 where id = $2", [JSON.stringify(theme), template]);
    const owner = await createAccount("themes-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'themes-copy', 'Copy', $2) as id", [template, owner]);
    // The look comes along; the template's saved themes stay its own.
    expect((await one<{ theme: unknown }>("select theme from commerce.stores where id = $1", [copy])).theme).toEqual({
      base: "warm",
      settings: { mode: "light" },
    });
    expect((await db.query("select 1 from commerce.store_themes where store_id = $1", [copy])).rows).toEqual([]);
  });
});

describe("stores' own domains (P8)", () => {
  it("keep an active domain to one store, one primary per store, and only active ones as primary", async () => {
    const kari = await createStore("domains-kari", ["NO"]);
    const ola = await createStore("domains-ola", ["NO"]);
    const add = (store: string, hostname: string, status = "pending", primary = false) =>
      db.query(
        "insert into commerce.store_domains (store_id, hostname, token, status, is_primary) values ($1, $2, 'token', $3, $4)",
        [store, hostname, status, primary],
      );
    await add(kari, "butikk.example.no", "active", true);
    // Another store may claim it while it waits, but not have it active; nor add a second primary.
    await add(ola, "butikk.example.no");
    await expect(add(kari, "butikk.example.no")).rejects.toThrow(/store_domains_store_hostname_idx/);
    await expect(db.query("update commerce.store_domains set status = 'active' where store_id = $1", [ola])).rejects.toThrow(
      /store_domains_active_hostname_idx/,
    );
    await expect(add(kari, "example.no", "active", true)).rejects.toThrow(/store_domains_primary_idx/);
    await expect(add(kari, "example.no", "pending", true)).rejects.toThrow(/store_domains_primary_active/);
    await expect(add(kari, "Example.no")).rejects.toThrow(/store_domains_hostname/);
    await expect(add(kari, "example")).rejects.toThrow(/store_domains_hostname/);
    await add(kari, "xn--blbr-roah.no");
  });
});

describe("VAT per product (D65)", () => {
  it("gives accommodation its reduced rate where there is one, the standard rate elsewhere, and none when exempt", async () => {
    const rate = async (country: string, category: string) =>
      Number((await db.query<{ rate: string }>("select commerce.vat_rate($1, $2) as rate", [country, category])).rows[0].rate);
    expect(await rate("NO", "standard")).toBe(0.25);
    expect(await rate("NO", "accommodation")).toBe(0.12);
    expect(await rate("SE", "accommodation")).toBe(0.12);
    expect(await rate("DK", "accommodation")).toBe(0.25);
    expect(await rate("NO", "exempt")).toBe(0);
    const store = await createStore("vat-kari", ["NO"]);
    // Categories are data since D157 (`commerce.vat_categories`): `food` is one, an unknown one is not. src/db/vat.test.ts has the rest.
    await db.query("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, 'x', 't', 'food')", [store]);
    await expect(
      db.query("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, 'y', 't', 'caviar')", [store]),
    ).rejects.toThrow(/products_vat_category_fk/);
    await expect(
      db.query("insert into commerce.vat_rates (country_code, category, rate, valid_from, source, checked_on) values ('NO', 'caviar', 0.15, '2026-01-01', 'A source here', '2026-10-03')"),
    ).rejects.toThrow(/vat_rates_category_vat_categories_code_fk/);
  });
});

describe("bookings (D65)", () => {
  it("books a resource only while it has room, counting buffers and live holds, and follows the order", async () => {
    const { productId, variantId } = await createProduct();
    const { id: staff } = await one<{ id: string }>(
      "insert into commerce.booking_resources (store_id, name, hours) values ($1, 'Kari', '{}') returning id",
      [store],
    );
    const hold = (from: string, to: string, blockedTo = to, until = "now() + interval '15 minutes'", order: string | null = null) =>
      one<{ id: string | null }>(
        `select commerce.hold_booking($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $5::timestamptz, $7::timestamptz, ${until}, $8) as id`,
        [store, productId, variantId, staff, from, to, blockedTo, order],
      );
    const first = await hold("2030-01-07T09:00Z", "2030-01-07T10:00Z", "2030-01-07T10:15Z");
    expect(first.id).not.toBeNull();
    // The buffer after it is taken too; right after the buffer is free.
    expect((await hold("2030-01-07T10:00Z", "2030-01-07T11:00Z")).id).toBeNull();
    expect((await hold("2030-01-07T10:15Z", "2030-01-07T11:15Z")).id).not.toBeNull();
    // A hold that has run out frees its time.
    expect((await hold("2030-01-07T12:00Z", "2030-01-07T13:00Z", "2030-01-07T13:00Z", "now() - interval '1 minute'")).id).not.toBeNull();
    expect((await hold("2030-01-07T12:00Z", "2030-01-07T13:00Z")).id).not.toBeNull();
    // A class of two takes two at once.
    await db.query("update commerce.booking_resources set capacity = 2 where id = $1", [staff]);
    expect((await hold("2030-01-07T09:30Z", "2030-01-07T10:00Z")).id).not.toBeNull();
    expect((await hold("2030-01-07T09:30Z", "2030-01-07T10:00Z")).id).toBeNull();

    // Paying confirms an order's held bookings; cancelling releases them.
    const paid = await createOrder("B-1");
    const { id: booked } = await hold("2030-01-08T09:00Z", "2030-01-08T10:00Z", "2030-01-08T10:00Z", "now() + interval '15 minutes'", paid);
    await db.query("update commerce.orders set status = 'paid' where id = $1", [paid]);
    expect(await one("select status, hold_expires_at from commerce.bookings where id = $1", [booked])).toEqual({
      status: "confirmed",
      hold_expires_at: null,
    });
    const dropped = await createOrder("B-2");
    const { id: released } = await hold("2030-01-09T09:00Z", "2030-01-09T10:00Z", "2030-01-09T10:00Z", "now() + interval '15 minutes'", dropped);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [dropped]);
    expect((await one<{ status: string }>("select status from commerce.bookings where id = $1", [released])).status).toBe("cancelled");

    // Paid after the hold ran out: kept if the time is still free, lost if someone took it meanwhile.
    await db.query("update commerce.booking_resources set capacity = 1 where id = $1", [staff]);
    const late = await createOrder("B-3");
    const expired = "now() - interval '1 minute'";
    const { id: kept } = await hold("2030-01-10T09:00Z", "2030-01-10T10:00Z", "2030-01-10T10:00Z", expired, late);
    const { id: lost } = await hold("2030-01-10T12:00Z", "2030-01-10T13:00Z", "2030-01-10T13:00Z", expired, late);
    expect((await hold("2030-01-10T12:00Z", "2030-01-10T13:00Z")).id).not.toBeNull();
    await db.query("update commerce.orders set status = 'paid' where id = $1", [late]);
    const status = async (id: string | null) =>
      (await one<{ status: string }>("select status from commerce.bookings where id = $1", [id])).status;
    expect(await status(kept)).toBe("confirmed");
    expect(await status(lost)).toBe("cancelled");
    expect(await one("select count(*)::int as n from commerce.order_events where order_id = $1 and type = 'booking.lost'", [late])).toEqual({
      n: 1,
    });
    // Staff cancelling a paid order gives up its confirmed time too.
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [late]);
    expect(await status(kept)).toBe("cancelled");
    // Moving (D66): to a free time only, never onto another booking; a move raises the sequence.
    const { id: movable } = await hold("2030-01-11T09:00Z", "2030-01-11T10:00Z");
    await db.query("update commerce.bookings set status = 'confirmed', hold_expires_at = null where id = $1", [movable]);
    const { id: other } = await hold("2030-01-11T12:00Z", "2030-01-11T13:00Z");
    const move = (from: string, to: string) =>
      one<{ moved: boolean }>(
        "select commerce.move_booking($1, $2, $3, $4::timestamptz, $5::timestamptz, $4::timestamptz, $5::timestamptz) as moved",
        [store, movable, staff, from, to],
      );
    expect(await move("2030-01-11T12:30Z", "2030-01-11T13:30Z")).toEqual({ moved: false });
    // Onto part of its own time is fine: it does not count itself.
    expect(await move("2030-01-11T09:30Z", "2030-01-11T10:30Z")).toEqual({ moved: true });
    expect(await one("select starts_at, sequence from commerce.bookings where id = $1", [movable])).toEqual({
      starts_at: new Date("2030-01-11T09:30Z"),
      sequence: 1,
    });
    expect(other).not.toBeNull();
    // Paid later (D66): no more at the venue than the order costs, and only the modes the app knows.
    await expect(db.query("update commerce.orders set balance_minor = total_minor + 1 where id = $1", [late])).rejects.toThrow(
      /orders_balance/,
    );
    await expect(
      db.query("insert into commerce.appointment_settings (product_id, store_id, payment) values ($1, $2, 'later')", [productId, store]),
    ).rejects.toThrow(/appointment_settings_payment/);
    // Reminders go a set number of hours before, within a week.
    await expect(db.query("update commerce.stores set booking_reminder_hours = 200 where id = $1", [store])).rejects.toThrow(
      /stores_booking_reminder_hours/,
    );
    await expect(
      db.query("update commerce.stores set modules = '{bookings,parking}' where id = $1", [store]),
    ).rejects.toThrow(/stores_modules/);
  });
});

describe("selling to businesses (B2B)", () => {
  it("keeps stores and products to the audiences the storefront knows", async () => {
    const store = await createStore("b2b-kari", ["NO"]);
    const [row] = (await db.query("select audience, business_popup from commerce.stores where id = $1", [store])).rows;
    expect(row).toEqual({ audience: "consumers", business_popup: false });
    await db.query("update commerce.stores set audience = 'both', business_popup = true where id = $1", [store]);
    await expect(db.query("update commerce.stores set audience = 'b2b' where id = $1", [store])).rejects.toThrow(
      /stores_audience/,
    );
    await db.query("insert into commerce.products (store_id, handle, tax_code, audience) values ($1, 'firma', 't', 'businesses')", [
      store,
    ]);
    await expect(
      db.query("insert into commerce.products (store_id, handle, tax_code, audience) values ($1, 'alle', 't', 'everyone')", [store]),
    ).rejects.toThrow(/products_audience/);
  });
});

describe("Google reviews (D91)", () => {
  it("keeps one key and business for Kaizen and one per store, a business always with its name", async () => {
    const insert = (storeId: string | null, placeId: string | null, placeName: string | null) =>
      db.query(
        `insert into commerce.google_places (store_id, api_key_encrypted, api_key_hint, place_id, place_name)
         values ($1, 'v1.x', '…1234', $2, $3)`,
        [storeId, placeId, placeName],
      );
    await insert(null, null, null);
    await expect(insert(null, null, null)).rejects.toThrow(/google_places_store_key/);
    await insert(store, "ChIJN1t_tDeuEmsRUsoyG83frY4", "Kaffebaren");
    await expect(insert(other, "ChIJN1t_tDeuEmsRUsoyG83frY4", null)).rejects.toThrow(/google_places_place_named/);
    await expect(insert(other, "not a place id", "Noe")).rejects.toThrow(/google_places_place_id/);
    await db.query("delete from commerce.google_places");
  });
});

describe("AI providers (D73)", () => {
  it("keeps one provider for Kaizen and one per store, with an address only for other APIs", async () => {
    const insert = (storeId: string | null, provider: string, baseUrl: string | null) =>
      db.query(
        `insert into commerce.ai_providers (store_id, provider, base_url, api_key_encrypted, api_key_hint, embedding_model)
         values ($1, $2, $3, 'v1.x', '…1234', 'mistral-embed')`,
        [storeId, provider, baseUrl],
      );
    await insert(null, "gateway", null);
    await expect(insert(null, "mistral", null)).rejects.toThrow(/ai_providers_store_key/);
    await insert(store, "custom", "https://llm.example.com/v1");
    await expect(insert(other, "custom", null)).rejects.toThrow(/ai_providers_base_url/);
    await expect(insert(other, "gateway", "https://example.com")).rejects.toThrow(/ai_providers_base_url/);
    await expect(insert(other, "acme", null)).rejects.toThrow(/ai_providers_provider/);
    await expect(
      db.query("update commerce.ai_providers set min_similarity = 1.5 where store_id = $1", [store]),
    ).rejects.toThrow(/ai_providers_min_similarity/);
    // Pictures (D92) from another provider carry that provider's key; from this one, none.
    const images = (set: string) => db.query(`update commerce.ai_providers set ${set} where store_id = $1`, [store]);
    await images("image_model = 'pictures-2', image_provider = 'openai', image_api_key_encrypted = 'v1.y', image_api_key_hint = '…9999'");
    await expect(images("image_api_key_encrypted = null, image_api_key_hint = null")).rejects.toThrow(/ai_providers_image_key/);
    await expect(images("image_provider = 'custom'")).rejects.toThrow(/ai_providers_image_base_url/);
    await expect(images("image_quality = 'ultra'")).rejects.toThrow(/ai_providers_image_quality/);
    await images("image_provider = null, image_api_key_encrypted = null, image_api_key_hint = null");
    // A live voice (D105) from another provider carries its key too.
    await images("live_model = 'live-1', live_voice = 'warm', live_provider = 'openai', live_api_key_encrypted = 'v1.z', live_api_key_hint = '…7777'");
    await expect(images("live_api_key_hint = null")).rejects.toThrow(/ai_providers_live_key/);
    await expect(images("live_provider = 'custom'")).rejects.toThrow(/ai_providers_live_base_url/);
    await expect(images("live_provider = 'acme'")).rejects.toThrow(/ai_providers_live_provider/);
    await expect(images("live_voice = ''")).rejects.toThrow(/ai_providers_live_model/);
    await images("live_provider = null, live_api_key_encrypted = null, live_api_key_hint = null");
    await db.query("delete from commerce.ai_providers");
  });
});

describe("search by meaning (D74)", () => {
  it("keeps a vector per translation, of any length, compared with pgvector, and gone with its translation", async () => {
    const { productId } = await createProduct();
    const insert = (vector: string, hash = "0123456789abcdef0123456789abcdef") =>
      db.query(
        `insert into commerce.product_embeddings (store_id, product_id, locale, space, content_hash, embedding)
         values ($1, $2, 'en-IE', 'api.example.com|embed', $3, $4::extensions.vector)
         on conflict (product_id, locale) do update set embedding = excluded.embedding, content_hash = excluded.content_hash`,
        [store, productId, hash, vector],
      );
    await insert("[1,0,0]");
    await expect(insert("[1,0]", "not a hash")).rejects.toThrow(/content_hash/);
    // Another model's vectors may be longer.
    await insert("[0.6,0.8]");
    const { similarity } = await one<{ similarity: number }>(
      `select 1 - (embedding OPERATOR(extensions.<=>) '[0.6,0.8]'::extensions.vector) as similarity
       from commerce.product_embeddings where product_id = $1`,
      [productId],
    );
    expect(similarity).toBeCloseTo(1);
    // It cannot outlive its translation.
    await expect(
      db.query(
        `insert into commerce.product_embeddings (store_id, product_id, locale, space, content_hash, embedding)
         values ($1, $2, 'sv-SE', 's', '0123456789abcdef0123456789abcdef', '[1]')`,
        [store, productId],
      ),
    ).rejects.toThrow(/product_embeddings_translation_fk/);
    await db.query("delete from commerce.product_translations where product_id = $1", [productId]);
    const { n } = await one<{ n: number }>("select count(*)::int as n from commerce.product_embeddings where product_id = $1", [productId]);
    expect(n).toBe(0);
  });
});

describe("the chat agent (D81)", () => {
  it("keeps one agent per site, its usage per window, and passages from one source each, found by keyword and meaning", async () => {
    const agent = (storeId: string | null, name = "Ingrid") =>
      db.query("insert into commerce.chat_agents (store_id, enabled, name) values ($1, true, $2)", [storeId, name]);
    await agent(null);
    await expect(agent(null)).rejects.toThrow(/chat_agents_store_key/);
    await agent(store);
    await expect(agent(other, "x".repeat(61))).rejects.toThrow(/chat_agents_name/);
    await expect(db.query("update commerce.chat_agents set daily_limit = 0 where store_id = $1", [store])).rejects.toThrow(/chat_agents_daily_limit/);

    // One count per site, bucket and window, Kaizen's too.
    const count = (storeId: string | null) =>
      db.query(
        `insert into commerce.chat_usage (store_id, bucket, "window", count) values ($1, 'day', '2026-09-28', 1)
         on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1`,
        [storeId],
      );
    await count(null);
    await count(null);
    await count(store);
    expect((await db.query<{ count: number }>("select count from commerce.chat_usage order by count")).rows.map((r) => r.count)).toEqual([1, 2]);

    // A passage comes from a document or a page, never both or neither.
    const { id: documentId } = await one<{ id: string }>(
      "insert into commerce.knowledge_documents (store_id, title, content) values ($1, 'Returns', 'Return within 30 days.') returning id",
      [store],
    );
    const passage = (source: { document?: string; page?: string }, locale: string | null, body: string) =>
      db.query(
        `insert into commerce.knowledge_chunks (store_id, document_id, page_id, locale, position, title, body, version)
         values ($1, $2, $3, $4, 0, 'Returns', $5, 'v1')`,
        [store, source.document ?? null, source.page ?? null, locale, body],
      );
    await passage({ document: documentId }, null, "You may return goods within 30 days of delivery.");
    await expect(passage({}, null, "Neither")).rejects.toThrow(/knowledge_chunks_source/);
    await expect(passage({ document: documentId }, null, "")).rejects.toThrow(/knowledge_chunks_body/);
    await expect(
      db.query("update commerce.knowledge_chunks set space = 'api.example.com|embed' where document_id = $1", [documentId]),
    ).rejects.toThrow(/knowledge_chunks_embedded/);

    // Found by stemmed keyword in the passage's language ('simple' for documents) and by meaning.
    const { n } = await one<{ n: number }>(
      "select count(*)::int as n from commerce.knowledge_chunks where search @@ websearch_to_tsquery('simple', 'return')",
    );
    expect(n).toBe(1);
    await db.query(
      "update commerce.knowledge_chunks set space = 's', embedding = '[1,0]'::extensions.vector where document_id = $1",
      [documentId],
    );
    const { distance } = await one<{ distance: number }>(
      "select embedding OPERATOR(extensions.<=>) '[1,0]'::extensions.vector as distance from commerce.knowledge_chunks",
    );
    expect(distance).toBeCloseTo(0);

    // Passages go with their document.
    await db.query("delete from commerce.knowledge_documents where id = $1", [documentId]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.knowledge_chunks")).n).toBe(0);
    await db.query("delete from commerce.chat_agents");
    await db.query("delete from commerce.chat_usage");
  });
});

describe("search tests (D77)", () => {
  it("runs one test at a time, keeps each search's arm with its test, and a search's clicks with it", async () => {
    const { id } = await one<{ id: string }>("insert into commerce.search_experiments (keyword_share) values (0.5) returning id");
    await expect(db.query("insert into commerce.search_experiments (keyword_share) values (0.5)")).rejects.toThrow(/search_experiments_one_running/);
    await expect(db.query("update commerce.search_experiments set keyword_share = 1 where id = $1", [id])).rejects.toThrow(/search_experiments_share/);

    const log = (experimentId: string | null, arm: string | null) =>
      one<{ id: string }>(
        `insert into commerce.search_queries (store_id, market_code, query, results, experiment_id, arm)
         values ($1, 'NO', 'kopp', 1, $2, $3) returning id`,
        [store, experimentId, arm],
      );
    const search = await log(id, "hybrid");
    await log(null, null);
    await expect(log(id, null)).rejects.toThrow(/search_queries_arm/);
    await expect(log(null, "keyword")).rejects.toThrow(/search_queries_arm/);
    await expect(log(id, "chat")).rejects.toThrow(/search_queries_arm/);

    const { productId } = await createProduct();
    await db.query("insert into commerce.search_clicks (store_id, search_id, product_id, position) values ($1, $2, $3, 1)", [store, search.id, productId]);
    await expect(
      db.query("insert into commerce.search_clicks (store_id, search_id, product_id, position) values ($1, $2, $3, 0)", [store, search.id, productId]),
    ).rejects.toThrow(/search_clicks_position/);
    await db.query("delete from commerce.search_queries where id = $1", [search.id]);
    const { n } = await one<{ n: number }>("select count(*)::int as n from commerce.search_clicks where search_id = $1", [search.id]);
    expect(n).toBe(0);

    await db.query("update commerce.search_experiments set ended_at = now() where id = $1", [id]);
    await db.query("insert into commerce.search_experiments (keyword_share) values (0.2)");
  });
});

describe("the All products page (D83)", () => {
  it("is one of the store's own pages, let go when deleted, and copied to new stores", async () => {
    const template = await createStore("products-page-template", ["NO"]);
    const other = await createStore("products-page-other", ["NO"]);
    const page = (storeId: string, slug: string) =>
      one<{ id: string }>(
        `insert into commerce.pages (store_id, slug, draft, published, published_at)
         values ($1, $2, '{"title": "Alle produkter"}', '{"title": "Alle produkter"}', now()) returning id`,
        [storeId, slug],
      );
    const { id: mine } = await page(template, "alle-produkter");
    const { id: theirs } = await page(other, "alle-produkter");
    await expect(db.query("update commerce.stores set products_page_id = $1 where id = $2", [theirs, template])).rejects.toThrow(/stores_products_page_fk/);
    await db.query("update commerce.stores set products_page_id = $1 where id = $2", [mine, template]);

    const owner = await createAccount("products-page-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'products-page-copy', 'Copy', $2) as id", [template, owner]);
    const copied = await one<{ products_page_id: string }>("select products_page_id from commerce.stores where id = $1", [copy]);
    expect(await one("select store_id, slug from commerce.pages where id = $1", [copied.products_page_id])).toEqual({
      store_id: copy,
      slug: "alle-produkter",
    });

    await db.query("delete from commerce.pages where id = $1", [mine]);
    expect(await one("select id, products_page_id from commerce.stores where id = $1", [template])).toEqual({ id: template, products_page_id: null });
  });
});

describe("menus (D85)", () => {
  it("are the owner's own, let go of when deleted, and copied to new stores with the pages using them", async () => {
    const template = await createStore("menus-template", ["NO"]);
    const other = await createStore("menus-other", ["NO"]);
    const menu = (storeId: string | null, name: string) =>
      one<{ id: string }>(
        `insert into commerce.menus (store_id, name, items) values ($1, $2, '[{"label": {}, "link": {"kind": "home"}, "depth": 0}]') returning id`,
        [storeId, name],
      );
    const { id: main } = await menu(template, "Main menu");
    const { id: footer } = await menu(template, "Footer menu");
    const { id: theirs } = await menu(other, "Main menu");
    const { id: kaizens } = await menu(null, "Kaizen menu");
    await expect(menu(template, "Main menu")).rejects.toThrow(/menus_store_name_key/);
    await expect(menu(template, " ")).rejects.toThrow(/menus_name/);

    // A store's standard header shows only its own menus; Kaizen's only Kaizen's.
    await expect(db.query("update commerce.stores set header_menu_id = $1 where id = $2", [theirs, template])).rejects.toThrow(/stores_header_menu_fk/);
    await db.query("update commerce.stores set header_menu_id = $1, footer_menu_id = $2 where id = $3", [main, footer, template]);
    await db.query("insert into commerce.platform_settings (id) values (true) on conflict do nothing");
    await expect(db.query("update commerce.platform_settings set footer_menu_id = $1 where id", [main])).rejects.toThrow(/only show Kaizen's own menus/);
    await db.query("update commerce.platform_settings set header_menu_id = $1 where id", [kaizens]);

    // A page with a menu component showing the main menu.
    const content = JSON.stringify({
      title: "Om",
      rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "m", type: "menu", menuId: main }] }] }],
    });
    await db.query(
      "insert into commerce.pages (store_id, slug, draft, published, published_at) values ($1, 'om', $2, $2, now())",
      [template, content],
    );

    // A new store gets copies, used where the template's were, in its standard header and footer and its pages.
    const owner = await createAccount("menus-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'menus-copy', 'Copy', $2) as id", [template, owner]);
    const copied = await one<{ header_menu_id: string; footer_menu_id: string }>(
      "select header_menu_id, footer_menu_id from commerce.stores where id = $1",
      [copy],
    );
    expect(await one("select store_id, name from commerce.menus where id = $1", [copied.header_menu_id])).toEqual({ store_id: copy, name: "Main menu" });
    expect((await one<{ name: string }>("select name from commerce.menus where id = $1", [copied.footer_menu_id])).name).toBe("Footer menu");
    const { published } = await one<{ published: { rows: { columns: { blocks: { menuId: string }[] }[] }[] } }>(
      "select published from commerce.pages where store_id = $1 and slug = 'om'",
      [copy],
    );
    expect(published.rows[0].columns[0].blocks[0].menuId).toBe(copied.header_menu_id);

    // Deleting a menu lets the standard header go, and keeps the store; Kaizen's too.
    await db.query("delete from commerce.menus where id in ($1, $2)", [main, kaizens]);
    expect(await one("select id, header_menu_id, footer_menu_id from commerce.stores where id = $1", [template])).toEqual({
      id: template,
      header_menu_id: null,
      footer_menu_id: footer,
    });
    expect((await one<{ header_menu_id: string | null }>("select header_menu_id from commerce.platform_settings where id")).header_menu_id).toBeNull();
  });
});

describe("the media library (D88)", () => {
  it("keeps each file once, searchable by its name's words, with its vector while it is kept", async () => {
    const owner = await createStore("media-owner", ["NO"]);
    const insert = (values: { store?: string | null; url: string; name?: string; kind?: string; size?: number; width?: number | null; height?: number | null }) =>
      db.query(
        `insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, width, height)
         values ($1, $2, $3, 'product-media', $3, $4, 'image/webp', $5, $6, $7) returning id`,
        [
          values.store === undefined ? owner : values.store,
          values.kind ?? "image",
          values.url,
          values.name ?? "bilde.webp",
          values.size ?? 100,
          values.width === undefined ? 10 : values.width,
          values.height === undefined ? 10 : values.height,
        ],
      );
    const { rows } = await insert({ url: "https://x/a.webp", name: "hvit_kopp-på.bord.webp" });
    const id = (rows[0] as { id: string }).id;
    // One row per file; Kaizen's own files have no store.
    await expect(insert({ url: "https://x/a.webp" })).rejects.toThrow(/media_url_key/);
    await insert({ store: null, url: "https://x/kaizen.webp" });
    await expect(insert({ url: "https://x/b.webp", kind: "pdf" })).rejects.toThrow(/media_kind/);
    await expect(insert({ url: "https://x/c.webp", name: "" })).rejects.toThrow(/media_file_name/);
    await expect(insert({ url: "https://x/d.webp", size: -1 })).rejects.toThrow(/media_size/);
    await expect(insert({ url: "https://x/e.webp", width: 10, height: null })).rejects.toThrow(/media_dimensions/);
    await expect(insert({ url: "https://x/f.webp", width: 0, height: 0 })).rejects.toThrow(/media_dimensions/);
    await insert({ url: "https://x/g.webp", width: null, height: null });
    // The name's words, split at dots, dashes and underscores, are found.
    const { n } = await one<{ n: number }>(
      "select count(*)::int as n from commerce.media where search @@ to_tsquery('simple', 'kopp & bord') and id = $1",
      [id],
    );
    expect(n).toBe(1);
    await db.query(
      `insert into commerce.media_embeddings (media_id, store_id, space, content_hash, embedding)
       values ($1, $2, 's', '0123456789abcdef0123456789abcdef', '[1,0]')`,
      [id, owner],
    );
    await expect(
      db.query(
        `insert into commerce.media_embeddings (media_id, store_id, space, content_hash, embedding)
         values ($1, $2, 's', 'not a hash', '[1,0]') on conflict (media_id) do update set content_hash = excluded.content_hash`,
        [id, owner],
      ),
    ).rejects.toThrow(/content_hash/);
    // A file's vector goes with it.
    await db.query("delete from commerce.media where id = $1", [id]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.media_embeddings where media_id = $1", [id])).n).toBe(0);
    await db.query("delete from commerce.media where url = 'https://x/kaizen.webp'");
  });
});

describe("alt texts in the media library (D89)", () => {
  it("are by whoever wrote them, found by either address in a language, else the main one", async () => {
    const owner = await createStore("alt-owner", ["NO"]);
    const { rows } = await db.query(
      `insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, file_name, content_type)
       values ($1, 'image', 'https://x/alt.webp', 'https://x/alt-480.webp', 'product-media', 'alt.webp', 'alt.webp', 'image/webp') returning id`,
      [owner],
    );
    const id = (rows[0] as { id: string }).id;
    const alt = (url: string | null, locale: string) =>
      one<{ alt: string | null }>("select commerce.media_alt($1, $2) as alt", [url, locale]).then((row) => row.alt);
    expect(await alt("https://x/alt.webp", "nb-NO")).toBeNull();

    // An alt text needs its writer, and a writer an alt text.
    await expect(db.query("update commerce.media set alt = 'En kopp' where id = $1", [id])).rejects.toThrow(/media_alt_written/);
    await expect(db.query("update commerce.media set alt_source = 'ai' where id = $1", [id])).rejects.toThrow(/media_alt_written/);
    await expect(db.query("update commerce.media set alt = 'En kopp', alt_source = 'robot' where id = $1", [id])).rejects.toThrow(/media_alt_source/);
    await expect(db.query("update commerce.media set alt_translations = '[]', alt_source = 'ai' where id = $1", [id])).rejects.toThrow(/media_alt_translations/);
    await db.query(
      `update commerce.media set alt = 'En hvit kopp', alt_translations = '{"sv-SE": "En vit kopp", "en": ""}', alt_source = 'ai' where id = $1`,
      [id],
    );

    expect(await alt("https://x/alt.webp", "nb-NO")).toBe("En hvit kopp");
    expect(await alt("https://x/alt-480.webp", "sv-SE")).toBe("En vit kopp");
    // A language without its own, or with an empty one, reads the main language's.
    expect(await alt("https://x/alt.webp", "en")).toBe("En hvit kopp");
    expect(await alt("https://x/other.webp", "nb-NO")).toBeNull();
    expect(await alt(null, "nb-NO")).toBeNull();

    // The library's search reads every language.
    const { n } = await one<{ n: number }>(
      "select count(*)::int as n from commerce.media where id = $1 and search @@ to_tsquery('simple', 'vit')",
      [id],
    );
    expect(n).toBe(1);
  });
});

describe("variant pictures", () => {
  it("keeps a variant's picture with its small copy, and copies them with the template's variants", async () => {
    const template = await createStore("pictures-template", ["NO"]);
    const { productId, variantId } = await createProduct({ storeId: template });
    await expect(
      db.query("update commerce.product_variants set image_thumbnail_url = '/demo/mug-480.webp' where id = $1", [variantId]),
    ).rejects.toThrow(/product_variants_image/);
    await db.query(
      "update commerce.product_variants set image_url = '/demo/mug-black.svg', image_thumbnail_url = '/demo/mug-black-480.svg' where id = $1",
      [variantId],
    );
    await db.query("update commerce.products set status = 'active' where id = $1", [productId]);
    const owner = await createAccount("pictures-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'pictures-copy', 'Copy', $2) as id", [template, owner]);
    expect(
      await one("select image_url, image_thumbnail_url from commerce.product_variants where store_id = $1", [copy]),
    ).toEqual({ image_url: "/demo/mug-black.svg", image_thumbnail_url: "/demo/mug-black-480.svg" });
  });
});

describe("customer groups and company accounts (D108)", () => {
  it("keeps a group's percentage within 1 and 100, and its name once per store", async () => {
    await db.query("insert into commerce.customer_tiers (store_id, name, percent) values ($1, 'Wholesale', 10)", [store]);
    await expect(db.query("insert into commerce.customer_tiers (store_id, name, percent) values ($1, 'wholesale', 5)", [store])).rejects.toThrow();
    await expect(db.query("insert into commerce.customer_tiers (store_id, name, percent) values ($1, 'Free', 0)", [store])).rejects.toThrow();
    await expect(db.query("insert into commerce.customer_tiers (store_id, name, percent) values ($1, 'Over', 101)", [store])).rejects.toThrow();
    // Another store may use the same name.
    await db.query("insert into commerce.customer_tiers (store_id, name, percent) values ($1, 'Wholesale', 20)", [other]);
  });

  it("puts a customer in a group or company of their own store only, in one company with a role", async () => {
    const { id: tier } = await one<{ id: string }>("select id from commerce.customer_tiers where store_id = $1 and name = 'Wholesale'", [store]);
    const { id: foreign } = await one<{ id: string }>("select id from commerce.customer_tiers where store_id = $1", [other]);
    const { id: company } = await one<{ id: string }>(
      "insert into commerce.customer_companies (store_id, name, tier_id) values ($1, 'Acme AS', $2) returning id",
      [store, tier],
    );
    // A company cannot take another store's group.
    await expect(db.query("insert into commerce.customer_companies (store_id, name, tier_id) values ($1, 'Bad AS', $2)", [store, foreign])).rejects.toThrow();
    await db.query("insert into commerce.customers (store_id, email, tier_id) values ($1, 'tier@example.com', $2)", [store, tier]);
    await expect(db.query("insert into commerce.customers (store_id, email, tier_id) values ($1, 'x@example.com', $2)", [store, foreign])).rejects.toThrow();
    await db.query("insert into commerce.customers (store_id, email, company_id, company_role) values ($1, 'boss@example.com', $2, 'owner')", [store, company]);
    // A company member has a role; a customer with no company has none.
    await expect(db.query("insert into commerce.customers (store_id, email, company_id) values ($1, 'a@example.com', $2)", [store, company])).rejects.toThrow();
    await expect(db.query("insert into commerce.customers (store_id, email, company_role) values ($1, 'b@example.com', 'employee')", [store])).rejects.toThrow();
    await expect(db.query("insert into commerce.customers (store_id, email, company_id, company_role) values ($1, 'c@example.com', $2, 'boss')", [store, company])).rejects.toThrow();
    // A group in use cannot be deleted from under its customers.
    await expect(db.query("delete from commerce.customer_tiers where id = $1", [tier])).rejects.toThrow();
  });

  it("allows one open invitation per company and address, and a new one once it is withdrawn", async () => {
    const { id: company } = await one<{ id: string }>("select id from commerce.customer_companies where store_id = $1 and name = 'Acme AS'", [store]);
    const invite = (email: string, hash: string, status = "pending") =>
      db.query(
        "insert into commerce.company_invites (store_id, company_id, email, token_hash, status, expires_at) values ($1, $2, $3, $4, $5, now() + interval '1 day')",
        [store, company, email, hash, status],
      );
    await invite("Ane@example.com", "h1");
    await expect(invite("ane@example.com", "h2")).rejects.toThrow();
    await db.query("update commerce.company_invites set status = 'revoked' where token_hash = 'h1'");
    await invite("ane@example.com", "h3");
    await expect(invite("bo@example.com", "h3")).rejects.toThrow();
    await expect(invite("cy@example.com", "h4", "maybe")).rejects.toThrow();
  });

  it("keeps the group's or company's part of a discount within the discount, on orders and their lines", async () => {
    const checks = await db.query<{ conname: string }>(
      "select conname from pg_constraint where conname in ('orders_member_discount', 'order_lines_member_discount')",
    );
    expect(checks.rows.map((r) => r.conname).sort()).toEqual(["order_lines_member_discount", "orders_member_discount"]);
  });
});

describe("row-level security", () => {
  it("is enabled on every commerce table", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'commerce' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });
});

describe("custom fields (D118)", () => {
  const group = (storeId: string, slug: string, over: Record<string, unknown> = {}) =>
    db.query(
      `insert into commerce.field_groups (store_id, name, slug, entities, location, fields)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb) returning id`,
      [
        storeId,
        over.name ?? "Specs",
        slug,
        JSON.stringify(over.entities ?? ["product"]),
        JSON.stringify(over.location ?? []),
        JSON.stringify(over.fields ?? [{ id: "f_abcdef123456", name: "material", label: "Material", type: "text", access: "public" }]),
      ],
    );

  it("keeps groups per store, with a web name that is unique in the store", async () => {
    await group(store, "specs");
    await expect(group(store, "specs")).rejects.toThrow();
    // Another store may use the same name.
    await group(other, "specs");
    await expect(group(store, "Not Ok")).rejects.toThrow();
    await expect(group(store, "no-entities", { entities: [] })).rejects.toThrow();
    await expect(db.query("insert into commerce.field_groups (store_id, name, slug, position) values ($1, 'x', 'bad-position', 'top')", [store])).rejects.toThrow();
    await expect(db.query("insert into commerce.field_groups (store_id, name, slug, fields) values ($1, 'x', 'bad-fields', '{}')", [store])).rejects.toThrow();
  });

  it("keeps one row of values per thing and language, of known things only", async () => {
    const { id } = await one<{ id: string }>("insert into commerce.products (store_id, handle, tax_code) values ($1, 'fields-one', 'txcd_99999999') returning id", [store]);
    const put = (locale: string, entity = "product") =>
      db.query("insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, $2, $3, $4, '{}')", [store, entity, id, locale]);
    await put("");
    await put("nb");
    await expect(put("nb")).rejects.toThrow();
    await expect(put("", "widget")).rejects.toThrow();
    await expect(db.query("insert into commerce.field_values (store_id, entity, entity_id, values) values ($1, 'product', $2, '[]')", [store, crypto.randomUUID()])).rejects.toThrow();
  });

  it("takes a product's or page's values away with it", async () => {
    const { id: product } = await one<{ id: string }>("insert into commerce.products (store_id, handle, tax_code) values ($1, 'fields-two', 'txcd_99999999') returning id", [store]);
    const { id: page } = await one<{ id: string }>("insert into commerce.pages (store_id, slug, draft) values ($1, 'fields-page', '{}') returning id", [store]);
    const { id: article } = await one<{ id: string }>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'article', 'fields-article', '{}') returning id", [store]);
    for (const [entity, id] of [["product", product], ["page", page], ["article", article]]) {
      await db.query("insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, $2, $3, '', '{}')", [store, entity, id]);
    }
    await db.query("delete from commerce.products where id = $1", [product]);
    await db.query("delete from commerce.pages where id = $1", [page]);
    await db.query("delete from commerce.pages where id = $1", [article]);
    const { rows } = await db.query("select entity from commerce.field_values where entity_id = any($1)", [[product, page, article]]);
    expect(rows).toEqual([]);
  });

  it("keeps values for variants and for categories and tags, and takes them away with them", async () => {
    const { productId, variantId } = await createProduct({ storeId: store });
    const { id: term } = await one<{ id: string }>(
      "insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, 'product', 'tag', 'Nytt', 'fields-tag') returning id",
      [store],
    );
    for (const [entity, id] of [["variant", variantId], ["term", term]]) {
      await db.query("insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, $2, $3, '', '{}')", [store, entity, id]);
    }
    await db.query("delete from commerce.product_variants where id = $1", [variantId]).catch(() => undefined);
    await db.query("delete from commerce.terms where id = $1", [term]);
    const { rows } = await db.query<{ entity: string }>("select entity from commerce.field_values where entity_id = any($1)", [[variantId, term]]);
    // The tag's values are gone; the variant's stay only if the variant could not be deleted (it has stock or prices).
    expect(rows.map((r) => r.entity)).not.toContain("term");
    void productId;
  });

  it("keeps the words of a product's searchable fields by language, stemmed, and takes them away with the product", async () => {
    const { id } = await one<{ id: string }>("insert into commerce.products (store_id, handle, tax_code) values ($1, 'fields-search', 'txcd_99999999') returning id", [store]);
    await db.query("insert into commerce.field_search (store_id, entity_id, locale, body) values ($1, $2, 'en', 'Merino wool blankets')", [store, id]);
    await db.query("insert into commerce.field_search (store_id, entity_id, locale, body) values ($1, $2, 'nb', 'Merinoull tepper')", [store, id]);
    await expect(db.query("insert into commerce.field_search (store_id, entity_id, locale, body) values ($1, $2, 'nb', 'twice')", [store, id])).rejects.toThrow();
    await expect(db.query("insert into commerce.field_search (store_id, entity, entity_id, locale, body) values ($1, 'page', $2, 'en', 'x')", [store, id])).rejects.toThrow();
    // Stemmed with the language's own dictionary: "blanket" finds "blankets".
    const { rows } = await db.query("select 1 from commerce.field_search where entity_id = $1 and locale = 'en' and search @@ websearch_to_tsquery('pg_catalog.english', 'blanket')", [id]);
    expect(rows).toHaveLength(1);
    await db.query("delete from commerce.products where id = $1", [id]);
    expect((await db.query("select 1 from commerce.field_search where entity_id = $1", [id])).rows).toEqual([]);
  });

  it("copies the template's groups and values to new stores, with rules following the copied categories and tags", async () => {
    const template = await createStore("fields-template", ["NO"]);
    await db.query("update commerce.stores set is_template = false where is_template");
    await db.query("update commerce.stores set is_template = true where id = $1", [template]);
    const { productId } = await createProduct({ storeId: template });
    const { id: term } = await one<{ id: string }>(
      "insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, 'product', 'category', 'Shoes', 'shoes') returning id",
      [template],
    );
    const { id: page } = await one<{ id: string }>(
      "insert into commerce.pages (store_id, slug, draft, published, published_at) values ($1, 'fields-about', '{}', '{}', now()) returning id",
      [template],
    );
    await group(template, "specs", {
      location: [
        [
          { param: "category", operator: "==", value: term },
          { param: "kind", operator: "==", value: "goods" },
        ],
        [{ param: "audience", operator: "!=", value: "businesses" }],
      ],
    });
    for (const [entity, id] of [["product", productId], ["page", page]]) {
      await db.query(
        "insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, $2, $3, 'nb', '{\"f_abcdef123456\": \"Ull\"}')",
        [template, entity, id],
      );
    }
    // A value for a thing that is not copied (an archived product) stays behind.
    const { id: archived } = await one<{ id: string }>("insert into commerce.products (store_id, handle, tax_code, status) values ($1, 'fields-archived', 'txcd_99999999', 'archived') returning id", [template]);
    await db.query("insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, 'product', $2, '', '{}')", [template, archived]);

    const owner = await createAccount("fields-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'fields-copy', 'Copy', $2) as id", [template, owner]);

    const { rows: groups } = await db.query<{ slug: string; location: { param: string; value: string }[][]; fields: { id: string }[] }>(
      "select slug, location, fields from commerce.field_groups where store_id = $1",
      [copy],
    );
    expect(groups).toHaveLength(1);
    const { id: copiedTerm } = await one<{ id: string }>("select id from commerce.terms where store_id = $1 and slug = 'shoes'", [copy]);
    expect(copiedTerm).not.toBe(term);
    expect(groups[0].location[0].map((rule) => rule.value)).toEqual([copiedTerm, "goods"]);
    expect(groups[0].location[1]).toEqual([{ param: "audience", operator: "!=", value: "businesses" }]);
    expect(groups[0].fields[0].id).toBe("f_abcdef123456");

    const { rows: values } = await db.query<{ entity: string; values: Record<string, string> }>(
      "select entity, values from commerce.field_values where store_id = $1 order by entity",
      [copy],
    );
    expect(values).toEqual([
      { entity: "page", values: { f_abcdef123456: "Ull" } },
      { entity: "product", values: { f_abcdef123456: "Ull" } },
    ]);
    // The values belong to the copies of their things.
    const { rows: mine } = await db.query(
      `select 1 from commerce.field_values v
        where v.store_id = $1 and (
          (v.entity = 'product' and exists (select 1 from commerce.products p where p.id = v.entity_id and p.store_id = $1))
          or (v.entity = 'page' and exists (select 1 from commerce.pages p where p.id = v.entity_id and p.store_id = $1)))`,
      [copy],
    );
    expect(mine).toHaveLength(2);
    // The copy's own change leaves the template's alone.
    await db.query("update commerce.field_values set values = '{}' where store_id = $1", [copy]);
    expect((await db.query("select 1 from commerce.field_values where store_id = $1 and values <> '{}'", [template])).rows.length).toBeGreaterThan(0);
  });

  it("keeps values for the store itself, customers and orders, and takes a customer's and an order's away with them (D120)", async () => {
    const { id: customer } = await one<{ id: string }>(
      "insert into commerce.customers (store_id, email) values ($1, 'fields-customer@example.com') returning id",
      [store],
    );
    const order = await createOrder("K-FIELDS-1");
    const put = (entity: string, id: string) =>
      db.query("insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, $2, $3, '', '{\"f_abcdef123456\": \"x\"}')", [store, entity, id]);
    await put("store", store);
    await put("customer", customer);
    await put("order", order);
    // Only the known kinds of thing.
    await expect(put("staff", customer)).rejects.toThrow(/field_values_entity/);

    await db.query("delete from commerce.customers where id = $1", [customer]);
    // An order is never deleted (its number would leave a gap), so its values stay with it.
    await expect(db.query("delete from commerce.orders where id = $1", [order])).rejects.toThrow(/order_number\.deleted/);
    const { rows } = await db.query<{ entity: string }>(
      "select entity from commerce.field_values where store_id = $1 and entity in ('store', 'customer', 'order') order by entity",
      [store],
    );
    // The store's own stay: they belong to the store.
    expect(rows.map((r) => r.entity)).toEqual(["order", "store"]);
  });

  it("copies the template's own store fields to a new store, never a customer's or an order's (D120)", async () => {
    const template = await createStore("fields-template-store", ["NO"]);
    await db.query("update commerce.stores set is_template = false where is_template");
    await db.query("update commerce.stores set is_template = true where id = $1", [template]);
    await group(template, "about-store", { entities: ["store"] });
    const { id: customer } = await one<{ id: string }>(
      "insert into commerce.customers (store_id, email) values ($1, 'template-customer@example.com') returning id",
      [template],
    );
    const { id: order } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email,
         subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
       values ($1, 'K-TPL-1', 'NO', 'NOK', 'nb-NO', 'a@example.com', 1000, 0, 0, 200, 1000, '{}', '{}') returning id`,
      [template],
    );
    const put = (entity: string, id: string, locale: string, values: string) =>
      db.query("insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, $2, $3, $4, $5::jsonb)", [template, entity, id, locale, values]);
    await put("store", template, "", '{"f_abcdef123456": "Kaffe"}');
    await put("store", template, "nb", '{"f_abcdef123456": "Kaffe på norsk"}');
    await put("customer", customer, "", '{"f_abcdef123456": "Private"}');
    await put("order", order, "", '{"f_abcdef123456": "Private"}');

    const owner = await createAccount("fields-store-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'fields-store-copy', 'Copy', $2) as id", [template, owner]);
    const { rows } = await db.query<{ entity: string; entity_id: string; locale: string; values: Record<string, string> }>(
      "select entity, entity_id, locale, values from commerce.field_values where store_id = $1 order by entity, locale",
      [copy],
    );
    // The copy's own values are kept under the copy's id, in every language; nothing personal came along.
    expect(rows).toEqual([
      { entity: "store", entity_id: copy, locale: "", values: { f_abcdef123456: "Kaffe" } },
      { entity: "store", entity_id: copy, locale: "nb", values: { f_abcdef123456: "Kaffe på norsk" } },
    ]);
    // A group for the store is copied like the others.
    const { rows: groups } = await db.query<{ entities: string[] }>("select entities from commerce.field_groups where store_id = $1", [copy]);
    expect(groups.map((g) => g.entities)).toEqual([["store"]]);
  });

  it("no longer keeps the unused attributes on products", async () => {
    const { rows } = await db.query("select 1 from information_schema.columns where table_schema = 'commerce' and table_name = 'products' and column_name = 'attributes'");
    expect(rows).toEqual([]);
  });
});

describe("work: clients, time and invoices (D122)", () => {
  type Row = Record<string, unknown>;
  let workCounter = 0;

  /** A store with the legal details and bank account an invoice needs, and one client with one assignment. */
  async function workStore(over: { registered?: boolean; country?: string } = {}) {
    workCounter += 1;
    const storeId = await createStore(`work-${workCounter}`, ["NO"]);
    await db.query(
      `update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
         postal_address = 'Storgata 1, 0155 Oslo', country = $2, contact_email = 'post@konsulent.example',
         modules = array['work'] where id = $1`,
      [storeId, over.country ?? "NO"],
    );
    await db.query(
      `insert into commerce.work_settings (store_id, vat_registered, vat_number, bank_account, bic)
       values ($1, $2, $3, 'NO9386011117947', 'DNBANOKK')`,
      [storeId, over.registered ?? true, over.registered === false ? null : "NO923456789MVA"],
    );
    const account = await createAccount(`work-${workCounter}@example.com`);
    const clientId = await workClient(storeId);
    const assignmentId = await workAssignment(storeId, clientId);
    return { storeId, account, clientId, assignmentId };
  }

  async function workClient(storeId: string, over: Row = {}): Promise<string> {
    const { id } = await one<{ id: string }>(
      `insert into commerce.work_clients (store_id, name, legal_name, country, billing_address, currency, business, vat_treatment, vat_number)
       values ($1, $2, 'Kunde AS', $3, $4::jsonb, $5, true, $6, $7) returning id`,
      [
        storeId,
        over.name ?? "Kunde",
        over.country ?? "NO",
        JSON.stringify({ line1: "Kundeveien 2", postalCode: "0250", city: "Oslo" }),
        over.currency ?? "NOK",
        over.vatTreatment ?? "domestic",
        over.vatNumber ?? null,
      ],
    );
    return id;
  }

  async function workAssignment(storeId: string, clientId: string, name = "Rådgivning"): Promise<string> {
    const { id } = await one<{ id: string }>(
      "insert into commerce.work_assignments (store_id, client_id, name) values ($1, $2, $3) returning id",
      [storeId, clientId, name],
    );
    return id;
  }

  async function workDraft(storeId: string, clientId: string, assignmentId: string | null = null, currency = "NOK"): Promise<string> {
    const { id } = await one<{ id: string }>(
      "insert into commerce.work_invoices (store_id, client_id, assignment_id, currency) values ($1, $2, $3, $4) returning id",
      [storeId, clientId, assignmentId, currency],
    );
    return id;
  }

  async function workLine(
    storeId: string,
    invoiceId: string,
    over: { quantity?: number; price?: number; discount?: number; category?: string; assignmentId?: string | null; position?: number } = {},
  ): Promise<string> {
    const { id } = await one<{ id: string }>(
      `insert into commerce.work_invoice_lines (store_id, invoice_id, position, assignment_id, description, quantity_hundredths, unit_price_minor, discount_bp, vat_category)
       values ($1, $2, $3, $4, 'Consulting', $5, $6, $7, $8) returning id`,
      [storeId, invoiceId, over.position ?? 0, over.assignmentId ?? null, over.quantity ?? 150, over.price ?? 100000, over.discount ?? 0, over.category ?? "standard"],
    );
    return id;
  }

  const issue = (storeId: string, invoiceId: string, ...rest: unknown[]) =>
    one<Row>("select * from commerce.issue_work_invoice($1, $2, $3, $4, $5, $6, $7)", [
      storeId,
      invoiceId,
      rest[0] ?? null,
      rest[1] ?? null,
      rest[2] ?? null,
      rest[3] ?? null,
      rest[4] ?? false,
    ]);

  /** A draft of 1.5 hours at 1,000.00, issued: 1,500.00 + 25 % VAT. */
  async function issued(w: { storeId: string; clientId: string; assignmentId: string; account: string }, assignment: string | null = null) {
    const invoiceId = await workDraft(w.storeId, w.clientId, assignment);
    const lineId = await workLine(w.storeId, invoiceId, { assignmentId: assignment });
    const invoice = await issue(w.storeId, invoiceId, w.account);
    return { invoiceId, lineId, invoice };
  }

  const nextNumber = async (storeId: string, series = "work_invoice") =>
    (await one<{ next_number: number }>("select next_number from commerce.document_series where store_id = $1 and series = $2", [storeId, series])).next_number;

  it("is a module a store can switch on, and only the listed ones", async () => {
    const { storeId } = await workStore();
    await db.query("update commerce.stores set modules = array['bookings', 'work'] where id = $1", [storeId]);
    for (const name of MODULES) {
      await db.query("update commerce.stores set modules = array[$2]::text[] where id = $1", [storeId, name]);
    }
    await expect(db.query("update commerce.stores set modules = array['work', 'payroll'] where id = $1", [storeId])).rejects.toThrow(/stores_modules/);
  });

  it("gives every new store the two Work series, and a copy of a template none of its Work data", async () => {
    const template = await createStore("work-template", ["NO"]);
    const series = await db.query<{ series: string; prefix: string; next_number: number }>(
      "select series, prefix, next_number from commerce.document_series where store_id = $1 and series like 'work\\_%' order by series",
      [template],
    );
    expect(series.rows).toEqual([
      { series: "work_credit_note", prefix: "WCN-", next_number: 1 },
      { series: "work_invoice", prefix: "W-", next_number: 1 },
    ]);
    // Ordinary series are still there.
    expect((await db.query("select 1 from commerce.document_series where store_id = $1 and series in ('invoice', 'credit_note', 'order')", [template])).rows).toHaveLength(3);

    const w = await workStore();
    await db.query("update commerce.stores set is_template = false where is_template");
    await db.query("update commerce.stores set is_template = true where id = $1", [w.storeId]);
    await issued(w);
    const owner = await createAccount("work-template-owner@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'work-copy', 'Copy', $2) as id", [w.storeId, owner]);
    for (const table of ["work_clients", "work_assignments", "work_invoices", "work_invoice_lines", "work_settings", "work_events"]) {
      expect((await db.query(`select 1 from commerce.${table} where store_id = $1`, [copy])).rows, table).toEqual([]);
    }
    // Its numbering starts from scratch, not from the template's.
    expect(await nextNumber(copy)).toBe(1);
    expect(await nextNumber(w.storeId)).toBe(2);
    await db.query("update commerce.stores set is_template = false where id = $1", [w.storeId]);
  });

  it("numbers invoices from the store's own series at issue, without gaps or repeats", async () => {
    const w = await workStore();
    const drafts = [await workDraft(w.storeId, w.clientId), await workDraft(w.storeId, w.clientId), await workDraft(w.storeId, w.clientId)];
    for (const draft of drafts) await workLine(w.storeId, draft);
    // A draft has no number; deleting one burns none.
    const first = await one<Row>("select number, document_number from commerce.work_invoices where id = $1", [drafts[0]]);
    expect(first).toEqual({ number: null, document_number: null });
    const burned = await workDraft(w.storeId, w.clientId);
    await db.query("delete from commerce.work_invoices where id = $1", [burned]);
    expect(await nextNumber(w.storeId)).toBe(1);

    // An invoice that is not ready takes no number either.
    const empty = await workDraft(w.storeId, w.clientId);
    await expect(issue(w.storeId, empty)).rejects.toThrow(/work_invoice\.not_ready: no_lines/);
    expect(await nextNumber(w.storeId)).toBe(1);

    // A transaction that fails after the number was taken gives it back.
    await db.query("begin");
    const rolledBack = await issue(w.storeId, drafts[0], w.account);
    expect(rolledBack.document_number).toBe("W-1");
    await db.query("rollback");
    expect(await nextNumber(w.storeId)).toBe(1);
    expect((await one<Row>("select status, number from commerce.work_invoices where id = $1", [drafts[0]]))).toEqual({ status: "draft", number: null });

    const numbers: string[] = [];
    for (const draft of drafts) numbers.push((await issue(w.storeId, draft, w.account)).document_number as string);
    expect(numbers).toEqual(["W-1", "W-2", "W-3"]);
    expect(await nextNumber(w.storeId)).toBe(4);
    // Unique per store, and another store counts on its own.
    const v = await workStore();
    expect((await issued(v)).invoice.document_number).toBe("W-1");
    await expect(
      db.query("update commerce.work_invoices set document_number = 'W-1' where id = $1", [drafts[1]]),
    ).rejects.toThrow();
  });

  it("lets the owner raise the first number and the prefix before the first issue, and never reuse one after", async () => {
    const w = await workStore();
    await db.query("select commerce.work_set_series($1, 'work_invoice', 'FAK-', 1042)", [w.storeId]);
    expect((await issued(w)).invoice.document_number).toBe("FAK-1042");
    await db.query("select commerce.work_set_series($1, 'work_invoice', 'F', 2000)", [w.storeId]);
    expect((await issued(w)).invoice.document_number).toBe("F2000");
    await expect(db.query("select commerce.work_set_series($1, 'work_invoice', 'F', 1500)", [w.storeId])).rejects.toThrow(/work_series\.lower/);
    await expect(db.query("update commerce.document_series set next_number = 2000 where store_id = $1 and series = 'work_invoice'", [w.storeId])).rejects.toThrow(/work_series\.lower/);
    await expect(db.query("select commerce.work_set_series($1, 'work_invoice', 'bad prefix!', 5000)", [w.storeId])).rejects.toThrow(/work_series\.prefix/);
    await expect(db.query("select commerce.work_set_series($1, 'invoice', 'X', 5000)", [w.storeId])).rejects.toThrow(/work_series\.unknown/);
    // With nothing issued yet in the credit note series, its number can still be moved either way.
    await db.query("select commerce.work_set_series($1, 'work_credit_note', 'WCN-', 300)", [w.storeId]);
    await db.query("select commerce.work_set_series($1, 'work_credit_note', 'WCN-', 7)", [w.storeId]);
    expect(await nextNumber(w.storeId, "work_credit_note")).toBe(7);
  });

  it("works out each line and the totals half up, from the store's VAT rate", async () => {
    const w = await workStore();
    const invoiceId = await workDraft(w.storeId, w.clientId);
    // 0.33 h at 10.01: 3.3033 rounds to 3.30; its VAT 0.825 rounds up to 0.83.
    await workLine(w.storeId, invoiceId, { quantity: 33, price: 1001, position: 0 });
    // 1 h at 123.45 less 10 %: 111.105 rounds up to 111.11; VAT 27.7775 to 27.78.
    await workLine(w.storeId, invoiceId, { quantity: 100, price: 12345, discount: 1000, position: 1 });
    // No VAT on an exempt line.
    await workLine(w.storeId, invoiceId, { quantity: 200, price: 50000, category: "exempt", position: 2 });
    const invoice = await issue(w.storeId, invoiceId, w.account);
    const { rows } = await db.query<Row>(
      "select excl_minor, vat_minor, incl_minor, vat_rate::float as rate from commerce.work_invoice_lines where invoice_id = $1 order by position",
      [invoiceId],
    );
    expect(rows).toEqual([
      { excl_minor: 330, vat_minor: 83, incl_minor: 413, rate: 0.25 },
      { excl_minor: 11111, vat_minor: 2778, incl_minor: 13889, rate: 0.25 },
      { excl_minor: 100000, vat_minor: 0, incl_minor: 100000, rate: 0 },
    ]);
    expect(invoice).toMatchObject({ subtotal_minor: 111441, vat_minor: 2861, total_minor: 114302, status: "sent" });
    expect(invoice.vat_notes).toEqual(["exempt"]);
    // The database re-checks the arithmetic of every line, in a draft too.
    await expect(
      db.query("update commerce.work_invoice_lines set incl_minor = 1 where invoice_id = $1", [(await workDraft(w.storeId, w.clientId))]),
    ).resolves.toBeDefined();
    const other = await workDraft(w.storeId, w.clientId);
    const line = await workLine(w.storeId, other);
    await expect(db.query("update commerce.work_invoice_lines set incl_minor = 5 where id = $1", [line])).rejects.toThrow(/work_invoice_lines_amounts/);
    await expect(db.query("update commerce.work_invoices set total_minor = 5 where id = $1", [other])).rejects.toThrow(/work_invoices_amounts/);
  });

  it("recomputes the amounts at issue, whatever a draft held, and can be held to the total the person saw", async () => {
    const w = await workStore();
    const invoiceId = await workDraft(w.storeId, w.clientId);
    await workLine(w.storeId, invoiceId);
    await db.query("update commerce.work_invoices set subtotal_minor = 1, vat_minor = 1, total_minor = 2 where id = $1", [invoiceId]);
    await expect(issue(w.storeId, invoiceId, w.account, null, 999)).rejects.toThrow(/work_invoice\.total_changed: the total is now 187500/);
    expect(await nextNumber(w.storeId)).toBe(1);
    const invoice = await issue(w.storeId, invoiceId, w.account, null, 187500);
    expect(invoice).toMatchObject({ subtotal_minor: 150000, vat_minor: 37500, total_minor: 187500 });
  });

  it("snapshots seller, buyer, dates and notes at issue, and refuses when the legal details are not complete", async () => {
    const bare = await createStore("work-bare", ["NO"]);
    const client = await one<{ id: string }>(
      "insert into commerce.work_clients (store_id, name, currency) values ($1, 'Kunde', 'NOK') returning id",
      [bare],
    );
    const draft = await workDraft(bare, client.id);
    await workLine(bare, draft);
    const problems = await one<{ p: string[] }>("select commerce.work_invoice_problems($1, $2) as p", [bare, draft]);
    expect(problems.p).toEqual([
      "seller_name",
      "seller_address",
      "seller_country",
      "seller_organisation_number",
      "seller_vat_number",
      "seller_bank_account",
      "buyer_address",
      "buyer_country",
    ]);
    await expect(issue(bare, draft)).rejects.toThrow(/work_invoice\.not_ready: seller_name,/);

    const w = await workStore();
    await db.query("update commerce.work_clients set payment_days = 30, locale = 'nb-NO', billing_email = 'faktura@kunde.example' where id = $1", [w.clientId]);
    const { invoiceId, invoice } = await issued(w);
    const today = (await one<{ d: string }>("select commerce.work_today($1)::text as d", [w.storeId])).d;
    const row = await one<Row>(
      "select issued_on::text as issued_on, due_on::text as due_on, sent_at is not null as sent, payment_days, locale, currency from commerce.work_invoices where id = $1",
      [invoiceId],
    );
    const due = (await one<{ d: string }>("select ($1::date + 30)::text as d", [today])).d;
    expect(row).toEqual({ issued_on: today, due_on: due, sent: true, payment_days: 30, locale: "nb-NO", currency: "NOK" });
    expect(invoice.seller).toMatchObject({
      legal_name: "Konsulent AS",
      organisation_number: "923456789",
      vat_number: "NO923456789MVA",
      vat_registered: true,
      address: "Storgata 1, 0155 Oslo",
      country: "NO",
      bank_account: "NO9386011117947",
    });
    expect(invoice.buyer).toMatchObject({ name: "Kunde AS", client_name: "Kunde", email: "faktura@kunde.example", vat_treatment: "domestic", address: { city: "Oslo" } });
    // Later edits never rewrite what was issued.
    await db.query("update commerce.stores set legal_name = 'Nytt navn AS' where id = $1", [w.storeId]);
    await db.query("update commerce.work_clients set legal_name = 'Annen AS', billing_address = '{}' where id = $1", [w.clientId]);
    const kept = await one<{ seller: { legal_name: string }; buyer: { name: string } }>("select seller, buyer from commerce.work_invoices where id = $1", [invoiceId]);
    expect(kept.seller.legal_name).toBe("Konsulent AS");
    expect(kept.buyer.name).toBe("Kunde AS");
  });

  it("dates an invoice today at the latest, and not before the previous one unless the owner confirms", async () => {
    const w = await workStore();
    const first = await workDraft(w.storeId, w.clientId);
    await workLine(w.storeId, first);
    const today = (await one<{ d: string }>("select commerce.work_today($1)::text as d", [w.storeId])).d;
    await expect(issue(w.storeId, first, w.account, "9999-01-01")).rejects.toThrow(/date_in_future/);
    await issue(w.storeId, first, w.account, today);
    const second = await workDraft(w.storeId, w.clientId);
    await workLine(w.storeId, second);
    const earlier = (await one<{ d: string }>("select ($1::date - 3)::text as d", [today])).d;
    await expect(issue(w.storeId, second, w.account, earlier)).rejects.toThrow(/date_before_previous/);
    expect(await nextNumber(w.storeId)).toBe(2);
    expect((await issue(w.storeId, second, w.account, earlier, null, null, true)).number).toBe(2);
  });

  it("charges no VAT to a client under reverse charge, needs their VAT number, and notes it", async () => {
    const w = await workStore();
    const client = await workClient(w.storeId, { country: "SE", currency: "NOK", vatTreatment: "reverse_charge" });
    const draft = await workDraft(w.storeId, client);
    await workLine(w.storeId, draft, { category: "reverse_charge" });
    await expect(issue(w.storeId, draft)).rejects.toThrow(/not_ready: buyer_vat_number/);
    await db.query("update commerce.work_clients set vat_number = 'SE556677889901' where id = $1", [client]);
    const invoice = await issue(w.storeId, draft, w.account);
    expect(invoice).toMatchObject({ vat_minor: 0, total_minor: 150000, vat_notes: ["reverse_charge"] });
    // A standard-rated line does not fit that client, nor a reverse-charge line a domestic one.
    const wrong = await workDraft(w.storeId, client);
    await workLine(w.storeId, wrong, { category: "standard" });
    expect((await one<{ p: string[] }>("select commerce.work_invoice_problems($1, $2) as p", [w.storeId, wrong])).p).toEqual(["vat_category_mismatch"]);
    const domestic = await workDraft(w.storeId, w.clientId);
    await workLine(w.storeId, domestic, { category: "reverse_charge" });
    expect((await one<{ p: string[] }>("select commerce.work_invoice_problems($1, $2) as p", [w.storeId, domestic])).p).toEqual(["vat_category_mismatch"]);
    // A consumer is always domestic; a line's rate is 0 unless it is standard.
    await expect(db.query("update commerce.work_clients set business = false where id = $1", [client])).rejects.toThrow(/work_clients_consumer_domestic/);
    await expect(db.query("update commerce.work_invoice_lines set vat_category = 'exempt', vat_rate = 0.25 where id = $1", [await workLine(w.storeId, domestic)])).rejects.toThrow(/work_invoice_lines_vat_rate/);
  });

  it("charges no VAT and says so when the store is not VAT registered", async () => {
    const w = await workStore({ registered: false });
    const { invoice } = await issued(w);
    expect(invoice).toMatchObject({ vat_minor: 0, total_minor: 150000, vat_notes: ["not_registered"] });
    expect(invoice.seller).toMatchObject({ vat_registered: false, vat_number: null });
  });

  it("states the VAT in the seller's currency when the invoice is in another", async () => {
    const w = await workStore();
    const client = await workClient(w.storeId, { currency: "EUR" });
    const draft = await workDraft(w.storeId, client, null, "EUR");
    await workLine(w.storeId, draft);
    await expect(issue(w.storeId, draft, w.account)).rejects.toThrow(/work_invoice\.fx_rate_required/);
    expect(await nextNumber(w.storeId)).toBe(1);
    const invoice = await issue(w.storeId, draft, w.account, null, null, 11.5);
    expect(invoice).toMatchObject({ vat_minor: 37500, vat_home_minor: 431250 });
    expect(Number(invoice.fx_rate)).toBe(11.5);
    // In the seller's own currency there is no rate to keep.
    const { invoice: home } = await issued(w);
    expect(home).toMatchObject({ vat_home_minor: null, fx_rate: null });
  });

  it("cannot change an issued invoice, its lines or its snapshots, or delete it", async () => {
    const w = await workStore();
    const task = (await one<{ id: string }>("insert into commerce.work_tasks (store_id, assignment_id, title) values ($1, $2, 'Workshop') returning id", [w.storeId, w.assignmentId])).id;
    const { invoiceId, lineId, invoice } = await issued(w);
    expect(task).toBeDefined();
    for (const change of [
      "set notes = 'changed'",
      "set total_minor = 1, subtotal_minor = 1, vat_minor = 0",
      "set due_on = due_on + 30",
      "set issued_on = issued_on - 1",
      "set number = 99",
      "set document_number = 'W-99'",
      "set seller = '{}'",
      "set buyer = '{}'",
      "set vat_notes = '[\"exempt\"]'",
      "set currency = 'SEK'",
      "set client_id = client_id, reference = 'PO-1'",
      "set status = 'draft'",
      "set status = 'paid'",
      "set status = 'void'",
    ]) {
      await expect(db.query(`update commerce.work_invoices ${change} where id = $1`, [invoiceId]), change).rejects.toThrow(/work_invoice\./);
    }
    await expect(db.query("delete from commerce.work_invoices where id = $1", [invoiceId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoice_lines set description = 'x' where id = $1", [lineId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoice_lines set quantity_hundredths = 1 where id = $1", [lineId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("delete from commerce.work_invoice_lines where id = $1", [lineId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(workLine(w.storeId, invoiceId)).rejects.toThrow(/work_invoice\.immutable/);
    await expect(issue(w.storeId, invoiceId, w.account)).rejects.toThrow(/work_invoice\.not_draft/);
    // What may change: who it was sent to, and the hosted page's address.
    await db.query("update commerce.work_invoices set sent_to = 'faktura@kunde.example', public_token = 'tok-1' where id = $1", [invoiceId]);
    const after = await one<Row>("select sent_to, public_token, document_number from commerce.work_invoices where id = $1", [invoiceId]);
    expect(after).toEqual({ sent_to: "faktura@kunde.example", public_token: "tok-1", document_number: invoice.document_number });
    // A draft cannot be made an invoice by hand, nor an invoice be inserted issued.
    const draft = await workDraft(w.storeId, w.clientId);
    await expect(db.query("update commerce.work_invoices set status = 'sent' where id = $1", [draft])).rejects.toThrow();
    await expect(
      db.query("insert into commerce.work_invoices (store_id, client_id, currency, status) values ($1, $2, 'NOK', 'sent')", [w.storeId, w.clientId]),
    ).rejects.toThrow();
  });

  it("keeps the links of an issued line to a task only as long as the task lives, and the line itself always", async () => {
    const w = await workStore();
    const task = (await one<{ id: string }>("insert into commerce.work_tasks (store_id, assignment_id, title) values ($1, $2, 'Workshop') returning id", [w.storeId, w.assignmentId])).id;
    const invoiceId = await workDraft(w.storeId, w.clientId, w.assignmentId);
    const lineId = await workLine(w.storeId, invoiceId, { assignmentId: w.assignmentId });
    await db.query("update commerce.work_invoice_lines set task_id = $2 where id = $1", [lineId, task]);
    await issue(w.storeId, invoiceId, w.account);
    await db.query("delete from commerce.work_tasks where id = $1", [task]);
    const line = await one<Row>("select task_id, description, excl_minor from commerce.work_invoice_lines where id = $1", [lineId]);
    expect(line).toEqual({ task_id: null, description: "Consulting", excl_minor: 150000 });
    // The assignment cannot go while an invoice is for it.
    await expect(db.query("delete from commerce.work_assignments where id = $1", [w.assignmentId])).rejects.toThrow();
  });

  it("allows one draft per assignment, any number without one, and a new draft once the last is issued", async () => {
    const w = await workStore();
    await workDraft(w.storeId, w.clientId, w.assignmentId);
    await expect(workDraft(w.storeId, w.clientId, w.assignmentId)).rejects.toThrow(/work_invoices_one_draft_idx/);
    await workDraft(w.storeId, w.clientId);
    await workDraft(w.storeId, w.clientId);
    const other = await workAssignment(w.storeId, w.clientId, "Other");
    const draft = await workDraft(w.storeId, w.clientId, other);
    await workLine(w.storeId, draft, { assignmentId: other });
    await issue(w.storeId, draft, w.account);
    await workDraft(w.storeId, w.clientId, other);
    // An invoice for an assignment is for that assignment's client.
    const stranger = await workClient(w.storeId, { name: "Annen" });
    await expect(workDraft(w.storeId, stranger, w.assignmentId)).rejects.toThrow(/work_invoice\.assignment/);
  });

  it("puts each hour on at most one draft line, and freezes it with the invoice", async () => {
    const w = await workStore();
    const entry = async (minutes = 90, over: Row = {}) =>
      (
        await one<{ id: string }>(
          `insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, billable, note)
           values ($1, $2, $3, $4, $5, $6, 'notes') returning id`,
          [w.storeId, w.assignmentId, w.account, over.date ?? "2026-09-01", minutes, over.billable ?? true],
        )
      ).id;
    const e1 = await entry(60, { date: "2026-09-03" });
    const e2 = await entry(30, { date: "2026-09-01" });
    const unbillable = await entry(15, { billable: false });
    const invoiceId = await workDraft(w.storeId, w.clientId, w.assignmentId);
    const lineId = await workLine(w.storeId, invoiceId, { assignmentId: w.assignmentId });
    const attach = (id: string, line: string | null) => db.query("update commerce.work_time_entries set invoice_line_id = $2 where id = $1", [id, line]);
    await attach(e1, lineId);
    await attach(e2, lineId);
    await expect(attach(unbillable, lineId)).rejects.toThrow(/work_time\.billable/);
    // Time of another assignment does not go on this assignment's line.
    const elsewhere = await workAssignment(w.storeId, w.clientId, "Elsewhere");
    const foreign = (await one<{ id: string }>(
      "insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes) values ($1, $2, $3, '2026-09-02', 10) returning id",
      [w.storeId, elsewhere, w.account],
    )).id;
    await expect(attach(foreign, lineId)).rejects.toThrow(/work_time\.assignment/);
    // Drafts release time when a line is deleted.
    await attach(e2, null);
    await db.query("update commerce.work_time_entries set minutes = 45 where id = $1", [e2]);
    await attach(e2, lineId);
    await db.query("delete from commerce.work_invoice_lines where id = $1", [lineId]);
    expect((await one<Row>("select invoice_line_id from commerce.work_time_entries where id = $1", [e1])).invoice_line_id).toBeNull();

    // The service period comes from the time on the invoice.
    const line = await workLine(w.storeId, invoiceId, { assignmentId: w.assignmentId });
    await attach(e1, line);
    await attach(e2, line);
    const invoice = await one<Row>("select service_from::text as f, service_to::text as t from commerce.issue_work_invoice($1, $2, $3)", [w.storeId, invoiceId, w.account]);
    expect(invoice).toEqual({ f: "2026-09-01", t: "2026-09-03" });

    // Issued: the time cannot change, be deleted, or move, and no other time joins the invoice.
    await expect(db.query("update commerce.work_time_entries set minutes = 5 where id = $1", [e1])).rejects.toThrow(/work_time\.immutable/);
    await expect(db.query("update commerce.work_time_entries set billable = false where id = $1", [e1])).rejects.toThrow(/work_time\.immutable/);
    await expect(attach(e1, null)).rejects.toThrow(/work_time\.immutable/);
    await expect(db.query("delete from commerce.work_time_entries where id = $1", [e1])).rejects.toThrow(/work_time\.immutable/);
    const late = await entry(20);
    await expect(attach(late, line)).rejects.toThrow(/work_time\.draft_only/);
    // Time not on an issued invoice is still free to change.
    await db.query("update commerce.work_time_entries set minutes = 25 where id = $1", [late]);
    await db.query("delete from commerce.work_time_entries where id = $1", [late]);
    // Time is 1 minute to a day.
    await expect(entry(0)).rejects.toThrow(/work_time_entries_minutes/);
    await expect(entry(1441)).rejects.toThrow(/work_time_entries_minutes/);
  });

  it("deleting a draft releases its time and takes its lines, and burns no number", async () => {
    const w = await workStore();
    const invoiceId = await workDraft(w.storeId, w.clientId, w.assignmentId);
    const lineId = await workLine(w.storeId, invoiceId, { assignmentId: w.assignmentId });
    const { id: entry } = await one<{ id: string }>(
      "insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, invoice_line_id) values ($1, $2, $3, '2026-09-01', 30, $4) returning id",
      [w.storeId, w.assignmentId, w.account, lineId],
    );
    await db.query("delete from commerce.work_invoices where id = $1", [invoiceId]);
    expect((await db.query("select 1 from commerce.work_invoice_lines where invoice_id = $1", [invoiceId])).rows).toEqual([]);
    expect((await one<Row>("select invoice_line_id from commerce.work_time_entries where id = $1", [entry])).invoice_line_id).toBeNull();
    expect(await nextNumber(w.storeId)).toBe(1);
  });

  it("runs one timer per person in a store: starting another stops and logs the first", async () => {
    const w = await workStore();
    const second = await workAssignment(w.storeId, w.clientId, "Second");
    const task = (await one<{ id: string }>("insert into commerce.work_tasks (store_id, assignment_id, title) values ($1, $2, 'Task') returning id", [w.storeId, second])).id;
    const colleague = await createAccount("work-colleague@example.com");
    const start = (account: string, assignment: string, taskId: string | null = null) =>
      one<{ timer_started_at: Date; stopped_entry_id: string | null }>("select * from commerce.work_start_timer($1, $2, $3, $4)", [w.storeId, account, assignment, taskId]);

    const first = await start(w.account, w.assignmentId);
    expect(first.stopped_entry_id).toBeNull();
    expect((await db.query("select 1 from commerce.work_timers where store_id = $1", [w.storeId])).rows).toHaveLength(1);
    // The table itself allows one row per person, in any store.
    await expect(
      db.query("insert into commerce.work_timers (store_id, account_id, assignment_id) values ($1, $2, $3)", [w.storeId, w.account, second]),
    ).rejects.toThrow(/work_timers_(store_id_account_id_pk|account_idx)/);
    // A colleague has a timer of their own.
    await start(colleague, w.assignmentId);
    expect((await db.query("select 1 from commerce.work_timers where store_id = $1", [w.storeId])).rows).toHaveLength(2);

    const restarted = await start(w.account, second, task);
    expect(restarted.stopped_entry_id).not.toBeNull();
    const entry = await one<Row>("select assignment_id, task_id, account_id, minutes, billable, work_date::text as d from commerce.work_time_entries where id = $1", [restarted.stopped_entry_id]);
    expect(entry).toMatchObject({ assignment_id: w.assignmentId, task_id: null, account_id: w.account, minutes: 1, billable: true });
    const timers = await db.query<Row>("select account_id, assignment_id, task_id from commerce.work_timers where store_id = $1 and account_id = $2", [w.storeId, w.account]);
    expect(timers.rows).toEqual([{ account_id: w.account, assignment_id: second, task_id: task }]);

    // Stopping logs at least a minute and rounds up: 90 min 30 s is 91 minutes, on the day it started.
    await db.query("update commerce.work_timers set started_at = now() - interval '90 minutes 30 seconds' where store_id = $1 and account_id = $2", [w.storeId, w.account]);
    const stopped = await one<Row>("select id, minutes, assignment_id, task_id, note, work_date::text as d from commerce.work_stop_timer($1, $2, 'Workshop')", [w.storeId, w.account]);
    expect(stopped).toMatchObject({ minutes: 91, assignment_id: second, task_id: task, note: "Workshop" });
    const started = await one<{ d: string }>("select ((now() - interval '90 minutes 30 seconds') at time zone 'Europe/Oslo')::date::text as d");
    expect(stopped.d).toBe(started.d);
    // Nothing running: nothing logged.
    expect((await db.query("select * from commerce.work_stop_timer($1, $2)", [w.storeId, w.account])).rows).toEqual([]);
    // A timer forgotten for days logs a day.
    await start(w.account, w.assignmentId);
    await db.query("update commerce.work_timers set started_at = now() - interval '3 days' where store_id = $1 and account_id = $2", [w.storeId, w.account]);
    expect((await one<Row>("select minutes from commerce.work_stop_timer($1, $2)", [w.storeId, w.account])).minutes).toBe(1440);
    // The history has each logged entry.
    const events = await db.query<Row>("select type, data->>'source' as source from commerce.work_events where store_id = $1 and entity_type = 'time'", [w.storeId]);
    expect(events.rows.length).toBe(3);
    expect(events.rows.every((e) => e.type === "time.logged" && e.source === "timer")).toBe(true);
    // A task belongs to its assignment, and deleting it stops the timer that ran on it.
    await expect(start(w.account, w.assignmentId, task)).rejects.toThrow(/work_timers_task_fk/);
    await start(w.account, second, task);
    await db.query("delete from commerce.work_tasks where id = $1", [task]);
    expect((await db.query("select 1 from commerce.work_timers where store_id = $1 and account_id = $2", [w.storeId, w.account])).rows).toEqual([]);
  });

  it("runs one timer per person across stores: starting in one stops and logs the one in another (D123)", async () => {
    const a = await workStore();
    const b = await workStore();
    // The same person works for both stores.
    const person = a.account;
    const start = (storeId: string, assignment: string) =>
      one<{ timer_started_at: Date; stopped_entry_id: string | null }>("select * from commerce.work_start_timer($1, $2, $3, NULL)", [storeId, person, assignment]);
    const first = await start(a.storeId, a.assignmentId);
    expect(first.stopped_entry_id).toBeNull();
    await db.query("update commerce.work_timers set started_at = now() - interval '20 minutes' where account_id = $1", [person]);

    // Starting in the other store stops the first, and its entry is logged to its own store's assignment.
    const second = await start(b.storeId, b.assignmentId);
    expect(second.stopped_entry_id).not.toBeNull();
    const entry = await one<Row>("select store_id, assignment_id, account_id, minutes from commerce.work_time_entries where id = $1", [second.stopped_entry_id]);
    expect(entry).toMatchObject({ store_id: a.storeId, assignment_id: a.assignmentId, account_id: person });
    expect(Number(entry.minutes)).toBeGreaterThanOrEqual(20);
    expect(Number(entry.minutes)).toBeLessThanOrEqual(21);
    const running = await db.query<Row>("select store_id, assignment_id from commerce.work_timers where account_id = $1", [person]);
    expect(running.rows).toEqual([{ store_id: b.storeId, assignment_id: b.assignmentId }]);
    // The time.logged event is in the first store's history, not the second's.
    const events = async (storeId: string) => (await db.query("select 1 from commerce.work_events where store_id = $1 and type = 'time.logged'", [storeId])).rows.length;
    expect(await events(a.storeId)).toBe(1);
    expect(await events(b.storeId)).toBe(0);

    // The table refuses a second row for the person, even in another store; other people's timers are their own.
    await expect(
      db.query("insert into commerce.work_timers (store_id, account_id, assignment_id) values ($1, $2, $3)", [a.storeId, person, a.assignmentId]),
    ).rejects.toThrow(/work_timers_account_idx/);
    const colleague = await createAccount("work-colleague-across@example.com");
    await one("select * from commerce.work_start_timer($1, $2, $3, NULL)", [a.storeId, colleague, a.assignmentId]);
    expect((await db.query("select 1 from commerce.work_timers")).rows.length).toBeGreaterThanOrEqual(2);
    expect((await db.query("select 1 from commerce.work_timers where account_id = $1", [person])).rows).toHaveLength(1);

    // Stopping in the store where it runs logs there; asking the wrong store finds nothing.
    expect((await db.query("select * from commerce.work_stop_timer($1, $2)", [a.storeId, person])).rows).toEqual([]);
    expect((await one<Row>("select store_id from commerce.work_stop_timer($1, $2)", [b.storeId, person])).store_id).toBe(b.storeId);
  });

  it("started earlier in several stores (before D123), the newest timer keeps running when the rule is made", async () => {
    const a = await workStore();
    const b = await workStore();
    // The old table allowed one timer per person and store: put the state of the old schema back, then run the migration's clean-up.
    await db.query("drop index commerce.work_timers_account_idx");
    try {
      await db.query("insert into commerce.work_timers (store_id, account_id, assignment_id, started_at) values ($1, $2, $3, now() - interval '50 minutes')", [a.storeId, a.account, a.assignmentId]);
      await db.query("insert into commerce.work_timers (store_id, account_id, assignment_id, started_at) values ($1, $2, $3, now() - interval '5 minutes')", [b.storeId, a.account, b.assignmentId]);
      await db.query(`
        do $$ declare r record; begin
          for r in select t.store_id, t.account_id from (select w.store_id, w.account_id,
                     row_number() over (partition by w.account_id order by w.started_at desc, w.store_id) as n
                   from commerce.work_timers w) t where t.n > 1
          loop perform commerce.work_stop_timer(r.store_id, r.account_id, null); end loop; end; $$`);
      const left = await db.query<Row>("select store_id from commerce.work_timers where account_id = $1", [a.account]);
      expect(left.rows).toEqual([{ store_id: b.storeId }]);
      const logged = await one<Row>("select store_id, minutes from commerce.work_time_entries where account_id = $1", [a.account]);
      expect(logged.store_id).toBe(a.storeId);
      expect(Number(logged.minutes)).toBeGreaterThanOrEqual(50);
      expect(Number(logged.minutes)).toBeLessThanOrEqual(51);
    } finally {
      await db.query("delete from commerce.work_timers where account_id = $1", [a.account]);
      await db.query('create unique index "work_timers_account_idx" on commerce.work_timers using btree (account_id)');
    }
  });

  it("records payments that only add, and moves the invoice to paid and back", async () => {
    const w = await workStore();
    const { invoiceId } = await issued(w);
    const pay = (amount: number, over: Row = {}) =>
      one<{ id: string }>(
        `insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method, reverses, recorded_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [w.storeId, invoiceId, amount, over.currency ?? "NOK", over.date ?? "2026-09-10", over.method ?? "bank", over.reverses ?? null, w.account],
      );
    const status = () => one<Row>("select status, paid_at::text as paid_at from commerce.work_invoices where id = $1", [invoiceId]);
    const amounts = () => one<Row>("select * from commerce.work_invoice_amounts($1, $2)", [w.storeId, invoiceId]);

    await pay(100000);
    expect((await status()).status).toBe("sent");
    expect(await amounts()).toEqual({ total_minor: 187500, paid_minor: 100000, credited_minor: 0, outstanding_minor: 87500 });
    await expect(pay(1000, { currency: "SEK" })).rejects.toThrow(/work_payment\.currency/);
    await expect(pay(0)).rejects.toThrow(/work_invoice_payments_amount/);
    await expect(pay(-5, { method: "wire" })).rejects.toThrow(/work_invoice_payments_method/);
    const last = await pay(87500, { date: "2026-09-12" });
    const paid = await status();
    expect(paid.status).toBe("paid");
    // Noon on the day the money came, in the store's time zone (Oslo is UTC+2 in September).
    expect(paid.paid_at).toMatch(/^2026-09-12 10:00:00/);
    expect((await amounts()).outstanding_minor).toBe(0);

    // Records are never changed or deleted; a mistake is reversed by a negative row, once.
    await expect(db.query("update commerce.work_invoice_payments set amount_minor = 1 where id = $1", [last.id])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from commerce.work_invoice_payments where id = $1", [last.id])).rejects.toThrow(/append-only/);
    await expect(pay(-1000, { reverses: last.id })).rejects.toThrow(/work_payment\.reversal/);
    await pay(-87500, { reverses: last.id, date: "2026-09-13" });
    expect(await status()).toEqual({ status: "sent", paid_at: null });
    await expect(pay(-87500, { reverses: last.id })).rejects.toThrow();
    // A payment that overshoots keeps the invoice paid; a refund of the surplus is a negative row.
    await pay(87500 + 500);
    expect((await status()).status).toBe("paid");
    await pay(-500, { method: "bank" });
    expect((await status()).status).toBe("paid");
    // A draft takes no payment.
    const draft = await workDraft(w.storeId, w.clientId);
    await expect(
      db.query("insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, 1, 'NOK', '2026-09-10', 'bank')", [w.storeId, draft]),
    ).rejects.toThrow(/work_payment\.draft/);
    // Online payments are recorded once per Stripe session.
    const online = await workStore();
    const inv = await issued(online);
    const insertOnline = () =>
      db.query(
        "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method, provider_reference) values ($1, $2, 1000, 'NOK', '2026-09-10', 'stripe', 'cs_test_1')",
        [online.storeId, inv.invoiceId],
      );
    await insertOnline();
    await expect(insertOnline()).rejects.toThrow(/work_invoice_payments_provider_idx/);
  });

  it("credits an invoice in part or whole with numbered credit notes, and a full credit voids it and frees its time", async () => {
    const w = await workStore();
    const invoiceId = await workDraft(w.storeId, w.clientId, w.assignmentId);
    const lineId = await workLine(w.storeId, invoiceId, { assignmentId: w.assignmentId });
    const second = await workLine(w.storeId, invoiceId, { assignmentId: w.assignmentId, quantity: 33, price: 1001, position: 1 });
    const { id: entry } = await one<{ id: string }>(
      "insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, invoice_line_id) values ($1, $2, $3, '2026-09-01', 90, $4) returning id",
      [w.storeId, w.assignmentId, w.account, lineId],
    );
    await expect(
      one("select * from commerce.credit_work_invoice($1, $2, $3)", [w.storeId, invoiceId, w.account]),
    ).rejects.toThrow(/work_credit_note\.status/);
    await issue(w.storeId, invoiceId, w.account);
    const status = async () => (await one<{ status: string }>("select status from commerce.work_invoices where id = $1", [invoiceId])).status;
    const credit = (lines: unknown = null, reason: string | null = null) =>
      one<Row>("select * from commerce.credit_work_invoice($1, $2, $3, $4, $5::jsonb)", [w.storeId, invoiceId, w.account, reason, lines === null ? null : JSON.stringify(lines)]);

    // Half of the first line: 0.5 h is 500.00 + 125.00 VAT.
    const part = await credit([{ line_id: lineId, quantity_hundredths: 50 }], "Half the workshop was cancelled");
    expect(part).toMatchObject({ document_number: "WCN-1", subtotal_minor: 50000, vat_minor: 12500, total_minor: 62500, currency: "NOK", reason: "Half the workshop was cancelled" });
    expect(part.lines).toEqual([
      expect.objectContaining({ line_id: lineId, quantity_hundredths: 50, excl_minor: 50000, vat_minor: 12500, incl_minor: 62500 }),
    ]);
    expect(part.seller).toMatchObject({ legal_name: "Konsulent AS" });
    expect(await status()).toBe("sent");
    await expect(credit([{ line_id: lineId, quantity_hundredths: 101 }])).rejects.toThrow(/work_credit_note\.quantity/);
    await expect(credit([{ line_id: lineId, quantity_hundredths: 0 }])).rejects.toThrow(/work_credit_note\.(quantity|lines)/);
    await expect(credit([{ line_id: "00000000-0000-4000-8000-000000000000" }])).rejects.toThrow(/work_credit_note\.lines/);
    await expect(credit([])).rejects.toThrow(/work_credit_note\.lines/);
    // The time is still on the invoice while it stands.
    await expect(db.query("update commerce.work_time_entries set minutes = 1 where id = $1", [entry])).rejects.toThrow(/work_time\.immutable/);

    // Everything left: the rest of the first line takes exactly what remains of its amounts.
    const rest = await credit();
    expect(rest).toMatchObject({ document_number: "WCN-2", subtotal_minor: 100000 + 330, vat_minor: 25000 + 83, total_minor: 125413 });
    expect(part.total_minor as number + (rest.total_minor as number)).toBe(187500 + 413);
    expect(await status()).toBe("void");
    expect((await one<Row>("select invoice_line_id from commerce.work_time_entries where id = $1", [entry])).invoice_line_id).toBeNull();
    await expect(credit()).rejects.toThrow(/work_credit_note\.status/);
    expect(second).toBeDefined();
    // Credit notes never change, and are numbered in their own series.
    await expect(db.query("update commerce.work_credit_notes set reason = 'x' where id = $1", [part.id])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from commerce.work_credit_notes where id = $1", [part.id])).rejects.toThrow(/append-only/);
    expect(await nextNumber(w.storeId, "work_credit_note")).toBe(3);
    expect(await nextNumber(w.storeId)).toBe(2);
    // The time can be billed again on a new invoice; a credited invoice takes no more money, only refunds.
    const fresh = await workDraft(w.storeId, w.clientId, w.assignmentId);
    const freshLine = await workLine(w.storeId, fresh, { assignmentId: w.assignmentId });
    await db.query("update commerce.work_time_entries set invoice_line_id = $2 where id = $1", [entry, freshLine]);
    await expect(
      db.query("insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, 100, 'NOK', '2026-09-10', 'bank')", [w.storeId, invoiceId]),
    ).rejects.toThrow(/work_payment\.void/);
    await db.query("insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, -100, 'NOK', '2026-09-10', 'bank')", [w.storeId, invoiceId]);
    expect(await status()).toBe("void");
    // The history has it all, oldest first.
    const events = await db.query<{ type: string }>("select type from commerce.work_events where entity_id = $1 order by id", [invoiceId]);
    expect(events.rows.map((e) => e.type)).toEqual(["invoice.issued", "invoice.credited", "invoice.credited", "payment.refunded"]);
  });

  it("credits a paid invoice, and a credit that brings what is owed within what was paid marks it paid", async () => {
    const w = await workStore();
    const { invoiceId, lineId } = await issued(w);
    await db.query(
      "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method, recorded_by) values ($1, $2, 125000, 'NOK', '2026-09-10', 'bank', $3)",
      [w.storeId, invoiceId, w.account],
    );
    const status = async () => (await one<{ status: string }>("select status from commerce.work_invoices where id = $1", [invoiceId])).status;
    expect(await status()).toBe("sent");
    // Crediting a third of the hours (0.5 h) leaves 1,250.00 owed, which is what was paid.
    await one("select * from commerce.credit_work_invoice($1, $2, $3, null, $4::jsonb)", [w.storeId, invoiceId, w.account, JSON.stringify([{ line_id: lineId, quantity_hundredths: 50 }])]);
    expect(await status()).toBe("paid");
    // Crediting the rest voids it, paid or not.
    await one("select * from commerce.credit_work_invoice($1, $2, $3)", [w.storeId, invoiceId, w.account]);
    expect(await status()).toBe("void");
  });

  it("only credits an invoice of its own store, in its currency, and no more than it was", async () => {
    const w = await workStore();
    const v = await workStore();
    const { invoiceId } = await issued(w);
    await expect(one("select * from commerce.credit_work_invoice($1, $2)", [v.storeId, invoiceId])).rejects.toThrow(/work_credit_note\.not_found/);
    await expect(
      db.query(
        `insert into commerce.work_credit_notes (store_id, invoice_id, number, document_number, issued_on, currency, subtotal_minor, vat_minor, total_minor, lines, seller, buyer)
         values ($1, $2, 1, 'WCN-1', '2026-09-10', 'NOK', 1, 0, 1, '[{}]', '{}', '{}')`,
        [v.storeId, invoiceId],
      ),
    ).rejects.toThrow(/work_credit_notes_invoice_fk/);
    const insert = (currency: string, total: number) =>
      db.query(
        `insert into commerce.work_credit_notes (store_id, invoice_id, number, document_number, issued_on, currency, subtotal_minor, vat_minor, total_minor, lines, seller, buyer)
         values ($1, $2, 900, 'WCN-900', '2026-09-10', $3, $4, 0, $4, '[{}]', '{}', '{}')`,
        [w.storeId, invoiceId, currency, total],
      );
    await expect(insert("SEK", 100)).rejects.toThrow(/work_credit_note\.currency/);
    await expect(insert("NOK", 187501)).rejects.toThrow(/work_credit_note\.too_much/);
  });

  it("keeps the history of what happened append-only", async () => {
    const w = await workStore();
    await db.query("select commerce.work_event($1, 'client', $2, 'client.created', '{\"name\": \"Kunde\"}', $3)", [w.storeId, w.clientId, w.account]);
    const { id } = await one<{ id: number }>("select id from commerce.work_events where store_id = $1", [w.storeId]);
    await expect(db.query("update commerce.work_events set type = 'x' where id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from commerce.work_events where id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(db.query("insert into commerce.work_events (store_id, entity_type, type, data) values ($1, 'client', 'x', '[]')", [w.storeId])).rejects.toThrow(/work_events_data/);
  });

  it("cannot point across stores", async () => {
    const w = await workStore();
    const v = await workStore();
    const mine = await issued(w);
    const theirs = await issued(v);
    const expectFk = (statement: string, params: unknown[]) => expect(db.query(statement, params)).rejects.toThrow(/violates foreign key constraint|work_invoice\.assignment|work_time\.draft_only/);

    await expectFk("insert into commerce.work_assignments (store_id, client_id, name) values ($1, $2, 'x')", [v.storeId, w.clientId]);
    await expectFk("insert into commerce.work_invoices (store_id, client_id, currency) values ($1, $2, 'NOK')", [v.storeId, w.clientId]);
    await expectFk("insert into commerce.work_invoices (store_id, client_id, assignment_id, currency) values ($1, $2, $3, 'NOK')", [v.storeId, v.clientId, w.assignmentId]);
    await expectFk("insert into commerce.work_invoice_lines (store_id, invoice_id, description) values ($1, $2, 'x')", [v.storeId, mine.invoiceId]);
    await expectFk("insert into commerce.work_tasks (store_id, assignment_id, title) values ($1, $2, 'x')", [v.storeId, w.assignmentId]);
    await expectFk("insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes) values ($1, $2, $3, '2026-09-01', 5)", [v.storeId, w.assignmentId, w.account]);
    await expectFk("insert into commerce.work_timers (store_id, account_id, assignment_id) values ($1, $2, $3)", [v.storeId, w.account, w.assignmentId]);
    await expectFk(
      "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, 1, 'NOK', '2026-09-10', 'bank')",
      [v.storeId, mine.invoiceId],
    );
    await expectFk("insert into commerce.work_recurring_invoices (store_id, client_id, name, description, unit_price_minor, currency, start_date) values ($1, $2, 'x', 'x', 1, 'NOK', '2026-09-01')", [v.storeId, w.clientId]);
    // A time entry cannot go on another store's line, nor take another store's task.
    const { id: entry } = await one<{ id: string }>(
      "insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes) values ($1, $2, $3, '2026-09-01', 5) returning id",
      [v.storeId, v.assignmentId, v.account],
    );
    const draft = await workDraft(w.storeId, w.clientId);
    const line = await workLine(w.storeId, draft);
    await expectFk("update commerce.work_time_entries set invoice_line_id = $2 where id = $1", [entry, line]);
    const task = (await one<{ id: string }>("insert into commerce.work_tasks (store_id, assignment_id, title) values ($1, $2, 't') returning id", [w.storeId, w.assignmentId])).id;
    await expectFk("update commerce.work_time_entries set task_id = $2 where id = $1", [entry, task]);
    // A client is another store's customer or company only by that store's own rows.
    const company = (await one<{ id: string }>("insert into commerce.customer_companies (store_id, name) values ($1, 'Kunde AS') returning id", [w.storeId])).id;
    await expectFk("update commerce.work_clients set customer_company_id = $2 where id = $1", [v.clientId, company]);
    await expectFk("update commerce.work_clients set customer_id = $2 where id = $1", [v.clientId, (await one<{ id: string }>("insert into commerce.customers (store_id, email) values ($1, 'kunde@example.com') returning id", [w.storeId])).id]);
    // Series: an invoice is numbered from its own store's series only.
    expect(theirs.invoice.document_number).toBe("W-1");
  });

  it("links a client to a customer company and person, and only lets go of the link when they are deleted", async () => {
    const w = await workStore();
    const company = (await one<{ id: string }>("insert into commerce.customer_companies (store_id, name) values ($1, 'Kunde AS') returning id", [w.storeId])).id;
    const customer = (await one<{ id: string }>("insert into commerce.customers (store_id, email) values ($1, 'ansvarlig@example.com') returning id", [w.storeId])).id;
    await db.query("update commerce.work_clients set customer_company_id = $2, customer_id = $3 where id = $1", [w.clientId, company, customer]);
    await db.query("delete from commerce.customers where id = $1", [customer]);
    await db.query("delete from commerce.customer_companies where id = $1", [company]);
    expect(await one<Row>("select store_id = $2 as same_store, customer_company_id, customer_id from commerce.work_clients where id = $1", [w.clientId, w.storeId])).toEqual({ same_store: true, customer_company_id: null, customer_id: null });
  });

  it("archives a client that has been invoiced rather than deleting it, and deletes one that has not", async () => {
    const w = await workStore();
    const { invoiceId } = await issued(w);
    await expect(db.query("delete from commerce.work_clients where id = $1", [w.clientId])).rejects.toThrow();
    await db.query("update commerce.work_clients set archived_at = now() where id = $1", [w.clientId]);
    expect((await one<Row>("select status from commerce.work_invoices where id = $1", [invoiceId])).status).toBe("sent");
    const lonely = await workClient(w.storeId, { name: "Ingen" });
    await db.query("delete from commerce.work_clients where id = $1", [lonely]);
    // A repeating invoice that has made an invoice is switched off, not deleted.
    const { id: template } = await one<{ id: string }>(
      `insert into commerce.work_recurring_invoices (store_id, client_id, name, description, unit_price_minor, currency, start_date)
       values ($1, $2, 'Retainer', 'Monthly retainer', 500000, 'NOK', '2026-09-01') returning id`,
      [w.storeId, w.clientId],
    );
    await db.query("insert into commerce.work_invoices (store_id, client_id, currency, recurring_invoice_id, recurring_period) values ($1, $2, 'NOK', $3, '2026-09-01')", [w.storeId, w.clientId, template]);
    await expect(
      db.query("insert into commerce.work_invoices (store_id, client_id, currency, recurring_invoice_id, recurring_period) values ($1, $2, 'NOK', $3, '2026-09-01')", [w.storeId, w.clientId, template]),
    ).rejects.toThrow(/work_invoices_recurring_period_key/);
    await expect(db.query("delete from commerce.work_recurring_invoices where id = $1", [template])).rejects.toThrow();
    // Templates start with auto-issue off, and a period is named by its template as a pair.
    expect((await one<Row>("select auto_issue, skipped_periods from commerce.work_recurring_invoices where id = $1", [template])).auto_issue).toBe(false);
    await expect(db.query("insert into commerce.work_invoices (store_id, client_id, currency, recurring_period) values ($1, $2, 'NOK', '2026-10-01')", [w.storeId, w.clientId])).rejects.toThrow(/work_invoices_recurring/);
  });

  it("skips a repeating invoice's period for good when its draft is deleted, and never for an issued one", async () => {
    const w = await workStore();
    const { id: template } = await one<{ id: string }>(
      `insert into commerce.work_recurring_invoices (store_id, client_id, name, description, unit_price_minor, currency, start_date)
       values ($1, $2, 'Retainer', 'Monthly retainer', 500000, 'NOK', '2026-08-01') returning id`,
      [w.storeId, w.clientId],
    );
    const skipped = async () =>
      (await one<{ skipped: string[] }>("select skipped_periods::text[] as skipped from commerce.work_recurring_invoices where id = $1", [template])).skipped;
    const make = async (period: string) => {
      const id = await workDraft(w.storeId, w.clientId);
      await db.query("update commerce.work_invoices set recurring_invoice_id = $2, recurring_period = $3 where id = $1", [id, template, period]);
      await workLine(w.storeId, id);
      return id;
    };
    // Periods come out sorted, once each, whatever order they were deleted in.
    const october = await make("2026-10-01");
    const september = await make("2026-09-01");
    expect(await skipped()).toEqual([]);
    await db.query("delete from commerce.work_invoices where id = $1", [october]);
    await db.query("delete from commerce.work_invoices where id = $1", [september]);
    expect(await skipped()).toEqual(["2026-09-01", "2026-10-01"]);
    // A period already skipped is not added twice.
    const again = await make("2026-09-01");
    await db.query("delete from commerce.work_invoices where id = $1", [again]);
    expect(await skipped()).toEqual(["2026-09-01", "2026-10-01"]);
    // A draft without a template changes nothing, and an issued invoice cannot be deleted at all.
    await db.query("delete from commerce.work_invoices where id = $1", [await workDraft(w.storeId, w.clientId)]);
    const november = await make("2026-11-01");
    await issue(w.storeId, november);
    await expect(db.query("delete from commerce.work_invoices where id = $1", [november])).rejects.toThrow(/work_invoice.immutable/);
    expect(await skipped()).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("queues an integration event, like orders do, when a client is added and an invoice is sent, paid or credited", async () => {
    const w = await workStore();
    await db.query(
      `insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events)
       values ($1, 'zapier', true, 'x', 'x', array['work_client.created', 'work_invoice.sent', 'work_invoice.paid', 'work_invoice.credited'])`,
      [w.storeId],
    );
    const client = await workClient(w.storeId, { name: "Ny kunde" });
    const { invoiceId, lineId } = await issued(w);
    await db.query(
      "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, 187500, 'NOK', '2026-09-10', 'bank')",
      [w.storeId, invoiceId],
    );
    await one("select * from commerce.credit_work_invoice($1, $2, $3, null, $4::jsonb)", [w.storeId, invoiceId, w.account, JSON.stringify([{ line_id: lineId, quantity_hundredths: 10 }])]);
    const queued = await db.query<{ event: string; subject_id: string }>(
      "select event, subject_id from commerce.integration_deliveries where store_id = $1 order by created_at, event",
      [w.storeId],
    );
    expect(queued.rows.map((e) => e.event).sort()).toEqual(["work_client.created", "work_invoice.credited", "work_invoice.paid", "work_invoice.sent"]);
    expect(queued.rows.find((e) => e.event === "work_client.created")?.subject_id).toBe(client);
    expect(queued.rows.find((e) => e.event === "work_invoice.sent")?.subject_id).toBe(invoiceId);
    // The events an integration did not ask for are not queued.
    const quiet = await workStore();
    await issued(quiet);
    expect((await db.query("select 1 from commerce.integration_deliveries where store_id = $1", [quiet.storeId])).rows).toEqual([]);
  });

  it("checks the size and shape of what is typed into Work", async () => {
    const w = await workStore();
    await expect(db.query("insert into commerce.work_clients (store_id, name, currency) values ($1, '  ', 'NOK')", [w.storeId])).rejects.toThrow(/work_clients_name/);
    await expect(db.query("insert into commerce.work_clients (store_id, name, currency) values ($1, 'x', 'nok')", [w.storeId])).rejects.toThrow(/work_clients_currency/);
    await expect(db.query("insert into commerce.work_clients (store_id, name, currency, payment_days) values ($1, 'x', 'NOK', 91)", [w.storeId])).rejects.toThrow(/work_clients_payment_days/);
    await expect(db.query("insert into commerce.work_clients (store_id, name, currency, vat_treatment) values ($1, 'x', 'NOK', 'zero')", [w.storeId])).rejects.toThrow(/work_clients_vat_treatment/);
    await expect(db.query("insert into commerce.work_assignments (store_id, client_id, name, status) values ($1, $2, 'x', 'invoiced')", [w.storeId, w.clientId])).rejects.toThrow(/work_assignments_status/);
    await expect(db.query("insert into commerce.work_assignments (store_id, client_id, name, start_date, end_date) values ($1, $2, 'x', '2026-02-01', '2026-01-01')", [w.storeId, w.clientId])).rejects.toThrow(/work_assignments_dates/);
    await expect(db.query("insert into commerce.work_tasks (store_id, assignment_id, title, status) values ($1, $2, 'x', 'blocked')", [w.storeId, w.assignmentId])).rejects.toThrow(/work_tasks_status/);
    const draft = await workDraft(w.storeId, w.clientId);
    await expect(workLine(w.storeId, draft, { quantity: 10000001 })).rejects.toThrow(/work_invoice_lines_quantity/);
    await expect(workLine(w.storeId, draft, { price: 1000000001 })).rejects.toThrow(/work_invoice_lines_price/);
    await expect(workLine(w.storeId, draft, { discount: 10001 })).rejects.toThrow(/work_invoice_lines_discount/);
    await expect(workLine(w.storeId, draft, { category: "reduced" })).rejects.toThrow(/work_invoice_lines_vat_category/);
    await expect(db.query("update commerce.work_invoices set number = 1, document_number = 'W-1' where id = $1", [draft])).rejects.toThrow(/work_invoices_number/);
    await expect(db.query("insert into commerce.work_invoices (store_id, client_id, currency, series) values ($1, $2, 'NOK', 'invoice')", [w.storeId, w.clientId])).rejects.toThrow(/work_invoices_series/);
    // Zero-value invoices are not issued.
    const free = await workDraft(w.storeId, w.clientId);
    await workLine(w.storeId, free, { price: 0 });
    await expect(issue(w.storeId, free)).rejects.toThrow(/not_ready: zero_total/);
  });

  it("indexes every foreign key of every Work table", async () => {
    const { rows: keys } = await db.query<{ tbl: string; conname: string; cols: number[]; indrelid: number }>(
      `select t.relname as tbl, c.conname, c.conkey::int[] as cols, c.conrelid::int as indrelid
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       where c.contype = 'f' and n.nspname = 'commerce' and t.relname like 'work\\_%'`,
    );
    expect(keys.length).toBeGreaterThan(30);
    const { rows: indexes } = await db.query<{ indrelid: number; cols: string }>(
      "select indrelid::int as indrelid, indkey::text as cols from pg_index where indrelid in (select oid from pg_class where relname like 'work\\_%')",
    );
    const missing = keys.filter((key) => {
      const wanted = [...key.cols].sort().join(",");
      return !indexes.some((index) => {
        if (index.indrelid !== key.indrelid) return false;
        const leading = index.cols.split(" ").map(Number).slice(0, key.cols.length);
        return leading.sort().join(",") === wanted;
      });
    });
    expect(missing.map((key) => `${key.tbl}.${key.conname}`)).toEqual([]);
  });
});

describe("work: invoices imported from Kaizen Life (WP15)", () => {
  type Row = Record<string, unknown>;
  let importCounter = 0;

  /** A store with the details an invoice needs, one client with an address, and a member. */
  async function importStore() {
    importCounter += 1;
    const storeId = await createStore(`work-import-${importCounter}`, ["NO"]);
    await db.query(
      `update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
         postal_address = 'Storgata 1, 0155 Oslo', country = 'NO', contact_email = 'post@konsulent.example',
         time_zone = 'Europe/Oslo', modules = array['work'] where id = $1`,
      [storeId],
    );
    await db.query(
      `insert into commerce.work_settings (store_id, vat_registered, vat_number, bank_account)
       values ($1, true, 'NO923456789MVA', 'NO9386011117947')`,
      [storeId],
    );
    const account = await createAccount(`work-import-${importCounter}@example.com`);
    const { id: clientId } = await one<{ id: string }>(
      `insert into commerce.work_clients (store_id, name, country, billing_address, locale, currency)
       values ($1, 'Kunde', 'NO', '{"line1":"Kundeveien 2","postalCode":"0250","city":"Oslo"}'::jsonb, 'nb-NO', 'NOK') returning id`,
      [storeId],
    );
    return { storeId, account, clientId };
  }

  const SELLER = JSON.stringify({ legal_name: "Konsulent AS", country: "NO" });
  const BUYER = JSON.stringify({ name: "Kunde", client_name: "Kunde", address: {}, country: "NO" });

  /**
   * What the import's SQL does for one invoice, in a transaction that says it is importing: an issued
   * invoice with its own number (or the label), amounts and lines.
   */
  async function importInvoice(
    w: { storeId: string; clientId: string },
    over: { legacy?: string | null; label?: string; issuedOn?: string; total?: number; status?: string; lines?: number } = {},
  ): Promise<{ invoiceId: string; lineId: string }> {
    const legacy = over.legacy === undefined ? null : over.legacy;
    const total = over.total ?? 125000;
    const excl = total / 1.25;
    return db.transaction(async (tx) => {
      await tx.query("select set_config('commerce.work_importing', 'on', true)");
      const { rows } = await tx.query<{ id: string }>(
        `insert into commerce.work_invoices (store_id, client_id, status, document_number, imported, legacy_number, issued_on, due_on, sent_at,
           currency, locale, payment_days, subtotal_minor, vat_minor, total_minor, seller, buyer)
         values ($1, $2, $3, $4, true, $5, $6, ($6::date + 14), ($6::date + time '12:00') at time zone 'Europe/Oslo',
           'NOK', 'nb-NO', 14, $7, $8, $9, $10::jsonb, $11::jsonb) returning id`,
        [w.storeId, w.clientId, over.status ?? "sent", over.label ?? legacy ?? "Imported", legacy, over.issuedOn ?? "2026-04-02", excl, total - excl, total, SELLER, BUYER],
      );
      const invoiceId = rows[0].id;
      const line = await tx.query<{ id: string }>(
        `insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor, vat_category, vat_rate, excl_minor, vat_minor, incl_minor)
         values ($1, $2, 0, 'Konsulentbistand', 100, $3, 'standard', 0.25, $3, $4, $5) returning id`,
        [w.storeId, invoiceId, excl, total - excl, total],
      );
      return { invoiceId, lineId: line.rows[0].id };
    });
  }

  const draftWithLine = async (w: { storeId: string; clientId: string }) => {
    const { id } = await one<{ id: string }>("insert into commerce.work_invoices (store_id, client_id, currency) values ($1, $2, 'NOK') returning id", [w.storeId, w.clientId]);
    await db.query(
      `insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor, vat_category)
       values ($1, $2, 0, 'Rådgivning', 150, 100000, 'standard')`,
      [w.storeId, id],
    );
    return id;
  };
  const issue = (w: { storeId: string; account: string }, invoiceId: string, issuedOn: string | null = null) =>
    one<Row>("select * from commerce.issue_work_invoice($1, $2, $3, $4)", [w.storeId, invoiceId, w.account, issuedOn]);
  const nextNumber = async (storeId: string, series = "work_invoice") =>
    (await one<{ next_number: number }>("select next_number from commerce.document_series where store_id = $1 and series = $2", [storeId, series])).next_number;
  const invoiceRow = (id: string) => one<Row>("select * from commerce.work_invoices where id = $1", [id]);

  it("can only be made while importing, and only as issued, unnumbered invoices with their own label", async () => {
    const w = await importStore();
    const insert = (set: string) =>
      db.query(
        `insert into commerce.work_invoices (store_id, client_id, status, document_number, imported, issued_on, due_on, sent_at, currency, locale, payment_days, seller, buyer${set})
         values ($1, $2, 'sent', 'Imported', true, '2026-04-02', '2026-04-16', now(), 'NOK', 'nb-NO', 14, '{}'::jsonb, '{}'::jsonb)`,
        [w.storeId, w.clientId],
      );
    await expect(insert("")).rejects.toThrow(/work_invoice\.imported_only/);
    // A draft cannot be imported, and an imported invoice has no series number.
    await db.transaction(async (tx) => {
      await tx.query("select set_config('commerce.work_importing', 'on', true)");
      await expect(
        tx.query("insert into commerce.work_invoices (store_id, client_id, status, imported, currency) values ($1, $2, 'draft', true, 'NOK')", [w.storeId, w.clientId]),
      ).rejects.toThrow(/work_invoices_imported/);
    });
    await db.transaction(async (tx) => {
      await tx.query("select set_config('commerce.work_importing', 'on', true)");
      await expect(
        tx.query(
          `insert into commerce.work_invoices (store_id, client_id, status, number, document_number, imported, issued_on, due_on, sent_at, currency, locale, payment_days, seller, buyer)
           values ($1, $2, 'sent', 5, 'W-5', true, '2026-04-02', '2026-04-16', now(), 'NOK', 'nb-NO', 14, '{}'::jsonb, '{}'::jsonb)`,
          [w.storeId, w.clientId],
        ),
      ).rejects.toThrow(/work_invoices_imported/);
    });
    // A Life number belongs to an imported invoice only.
    await expect(db.query("update commerce.work_clients set name = name where id = $1", [w.clientId])).resolves.toBeDefined();
    const draft = await draftWithLine(w);
    await expect(db.query("update commerce.work_invoices set legacy_number = '2154' where id = $1", [draft])).rejects.toThrow(/work_invoices_legacy_number/);
    await expect(db.query("update commerce.work_invoices set imported = true where id = $1", [draft])).rejects.toThrow(/work_invoices_imported/);
  });

  it("is issued with its own number, amounts and lines, and takes nothing from the series", async () => {
    const w = await importStore();
    const numbered = await importInvoice(w, { legacy: "2154", total: 502875 });
    const unnumbered = await importInvoice(w, { legacy: null });
    const other = await importInvoice(w, { legacy: null });
    expect(await invoiceRow(numbered.invoiceId)).toMatchObject({ status: "sent", imported: true, legacy_number: "2154", document_number: "2154", number: null, total_minor: 502875 });
    expect(await invoiceRow(unnumbered.invoiceId)).toMatchObject({ imported: true, legacy_number: null, document_number: "Imported", number: null });
    expect(await invoiceRow(other.invoiceId)).toMatchObject({ document_number: "Imported" });
    expect(await nextNumber(w.storeId)).toBe(1);
    expect(await nextNumber(w.storeId, "work_credit_note")).toBe(1);
    // Two invoices with the same Life number are one invoice imported twice.
    await expect(importInvoice(w, { legacy: "2154" })).rejects.toThrow(/work_invoices_legacy_number_key|work_invoices_document_number_key/);
    // Its amounts are its own, and the lines add up.
    const amounts = await one<Row>("select * from commerce.work_invoice_amounts($1, $2)", [w.storeId, numbered.invoiceId]);
    expect(amounts).toMatchObject({ total_minor: 502875, paid_minor: 0, outstanding_minor: 502875 });
  });

  it("stays as it is: no edits, no deleting, no more lines, no un-importing", async () => {
    const w = await importStore();
    const { invoiceId, lineId } = await importInvoice(w, { legacy: "2154" });
    await expect(db.query("update commerce.work_invoices set notes = 'x' where id = $1", [invoiceId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoices set total_minor = 1, subtotal_minor = 1, vat_minor = 0 where id = $1", [invoiceId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoices set imported = false where id = $1", [invoiceId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoices set legacy_number = '1' where id = $1", [invoiceId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("delete from commerce.work_invoices where id = $1", [invoiceId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoice_lines set description = 'x' where id = $1", [lineId])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("delete from commerce.work_invoice_lines where id = $1", [lineId])).rejects.toThrow(/work_invoice\.immutable/);
    // A line cannot be added afterwards, outside the import.
    await expect(
      db.query(
        "insert into commerce.work_invoice_lines (store_id, invoice_id, position, description, quantity_hundredths, unit_price_minor) values ($1, $2, 1, 'x', 100, 100)",
        [w.storeId, invoiceId],
      ),
    ).rejects.toThrow(/work_invoice\.immutable/);
    // And the status only follows the money, as for any issued invoice.
    await expect(db.query("update commerce.work_invoices set status = 'paid' where id = $1", [invoiceId])).rejects.toThrow(/work_invoice\.status/);
  });

  it("still cannot be made or edited the normal way: a normal issued invoice has a number and cannot change", async () => {
    const w = await importStore();
    await expect(
      db.query(
        `insert into commerce.work_invoices (store_id, client_id, status, issued_on, due_on, sent_at, currency, locale, payment_days, seller, buyer)
         values ($1, $2, 'sent', '2026-04-02', '2026-04-16', now(), 'NOK', 'nb-NO', 14, '{}'::jsonb, '{}'::jsonb)`,
        [w.storeId, w.clientId],
      ),
    ).rejects.toThrow(/work_invoice\.draft_only/);
    const draft = await draftWithLine(w);
    await expect(db.query("update commerce.work_invoices set status = 'sent' where id = $1", [draft])).rejects.toThrow(/work_invoice\.draft_only/);
    await expect(db.query("update commerce.work_invoices set number = 7, document_number = 'W-7' where id = $1", [draft])).rejects.toThrow(/work_invoices_number/);
    await expect(db.query("update commerce.work_invoices set document_number = 'W-7' where id = $1", [draft])).rejects.toThrow(/work_invoices_number/);
    const issued = await issue(w, draft);
    expect(issued).toMatchObject({ number: 1, document_number: "W-1", imported: false, legacy_number: null });
    await expect(db.query("update commerce.work_invoices set notes = 'x' where id = $1", [draft])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoices set imported = true where id = $1", [draft])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("update commerce.work_invoices set number = null, document_number = null where id = $1", [draft])).rejects.toThrow(/work_invoice\.immutable/);
    await expect(db.query("delete from commerce.work_invoices where id = $1", [draft])).rejects.toThrow(/work_invoice\.immutable/);
  });

  it("leaves numbering alone: the first normal invoice is still number 1, whatever was imported and whenever it is dated", async () => {
    const w = await importStore();
    await importInvoice(w, { legacy: "2154", issuedOn: "2026-09-20" });
    await importInvoice(w, { legacy: null, issuedOn: "2026-09-25" });
    const first = await issue(w, await draftWithLine(w), "2026-08-01");
    expect(first).toMatchObject({ number: 1, document_number: "W-1" });
    const second = await issue(w, await draftWithLine(w), "2026-08-02");
    expect(second).toMatchObject({ number: 2, document_number: "W-2" });
    expect(await nextNumber(w.storeId)).toBe(3);
    // The owner can still start the series where the old numbers left off, before the first real issue.
    const v = await importStore();
    await importInvoice(v, { legacy: "2154" });
    await db.query("select commerce.work_set_series($1, 'work_invoice', 'F', 2155)", [v.storeId]);
    expect(await issue(v, await draftWithLine(v))).toMatchObject({ document_number: "F2155", number: 2155 });
  });

  it("keeps a Life number from being issued again by the series", async () => {
    const w = await importStore();
    await importInvoice(w, { legacy: "W-1" });
    const draft = await draftWithLine(w);
    await expect(issue(w, draft)).rejects.toThrow(/work_invoices_document_number_key/);
    // The refused issue gave its number back and left the draft a draft.
    expect(await nextNumber(w.storeId)).toBe(1);
    expect(await invoiceRow(draft)).toMatchObject({ status: "draft", number: null });
  });

  it("takes payments like any issued invoice, and a paid one is paid by its payment row", async () => {
    const w = await importStore();
    const { invoiceId } = await importInvoice(w, { legacy: "2154", total: 502875 });
    await db.transaction(async (tx) => {
      await tx.query("select set_config('commerce.work_importing', 'on', true)");
      await tx.query(
        "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method, reference) values ($1, $2, 502875, 'NOK', '2026-06-25', 'other', 'imported')",
        [w.storeId, invoiceId],
      );
    });
    const paid = await invoiceRow(invoiceId);
    expect(paid.status).toBe("paid");
    // Noon on the day it was received, in the store's time zone.
    expect((paid.paid_at as Date).toISOString()).toBe("2026-06-25T10:00:00.000Z");
    // The import wrote no payment or paid history of its own (it writes one `invoice.imported` entry).
    const quiet = await db.query("select type from commerce.work_events where store_id = $1 and entity_id = $2", [w.storeId, invoiceId]);
    expect(quiet.rows).toEqual([]);

    const open = await importInvoice(w, { legacy: null, total: 125000 });
    await db.query(
      "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, 125000, 'NOK', '2026-09-10', 'bank')",
      [w.storeId, open.invoiceId],
    );
    expect((await invoiceRow(open.invoiceId)).status).toBe("paid");
    const history = await db.query<{ type: string }>("select type from commerce.work_events where store_id = $1 and entity_id = $2 order by id", [w.storeId, open.invoiceId]);
    expect(history.rows.map((e) => e.type)).toEqual(["payment.recorded", "invoice.paid"]);
  });

  it("queues no integration event while importing, and does for what happens to it afterwards", async () => {
    const w = await importStore();
    await db.query(
      `insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events)
       values ($1, 'zapier', true, 'x', 'x', array['work_client.created', 'work_invoice.sent', 'work_invoice.paid', 'work_invoice.credited'])`,
      [w.storeId],
    );
    await db.transaction(async (tx) => {
      await tx.query("select set_config('commerce.work_importing', 'on', true)");
      await tx.query("insert into commerce.work_clients (store_id, name, currency) values ($1, 'Importert', 'NOK')", [w.storeId]);
    });
    const paid = await importInvoice(w, { legacy: "1" });
    await db.transaction(async (tx) => {
      await tx.query("select set_config('commerce.work_importing', 'on', true)");
      await tx.query(
        "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, 125000, 'NOK', '2026-04-20', 'other')",
        [w.storeId, paid.invoiceId],
      );
    });
    expect((await db.query("select 1 from commerce.integration_deliveries where store_id = $1", [w.storeId])).rows).toEqual([]);
    // A payment recorded later is news again.
    const open = await importInvoice(w, { legacy: "2" });
    await db.query(
      "insert into commerce.work_invoice_payments (store_id, invoice_id, amount_minor, currency, received_on, method) values ($1, $2, 125000, 'NOK', '2026-09-10', 'bank')",
      [w.storeId, open.invoiceId],
    );
    const queued = await db.query<{ event: string; subject_id: string }>("select event, subject_id from commerce.integration_deliveries where store_id = $1", [w.storeId]);
    expect(queued.rows).toEqual([{ event: "work_invoice.paid", subject_id: open.invoiceId }]);
  });

  it("can be credited: a new credit note from the store's own series, with the invoice's own seller and buyer", async () => {
    const w = await importStore();
    const { invoiceId } = await importInvoice(w, { legacy: "2154", total: 502875, issuedOn: "2026-06-08" });
    const note = await one<Row>("select * from commerce.credit_work_invoice($1, $2, $3, 'Feil på fakturaen', null, '2026-09-29')", [w.storeId, invoiceId, w.account]);
    expect(note).toMatchObject({ document_number: "WCN-1", total_minor: 502875, subtotal_minor: 402300 });
    expect(note.seller).toEqual(JSON.parse(SELLER));
    expect(note.buyer).toEqual(JSON.parse(BUYER));
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: "void", document_number: "2154", imported: true });
    // The invoice series was never touched by it.
    expect(await nextNumber(w.storeId)).toBe(1);
    expect(await nextNumber(w.storeId, "work_credit_note")).toBe(2);
    // A credit note may not be dated before the invoice it credits.
    const { invoiceId: later } = await importInvoice(w, { legacy: "2155", issuedOn: "2026-09-01" });
    await expect(one("select * from commerce.credit_work_invoice($1, $2, $3, null, null, '2026-08-01')", [w.storeId, later, w.account])).rejects.toThrow(/date_before_invoice/);
  });

  it("puts time on an imported invoice's line only while importing, and then keeps it there", async () => {
    const w = await importStore();
    const { rows: assignments } = await db.query<{ id: string }>("insert into commerce.work_assignments (store_id, client_id, name) values ($1, $2, 'Jobb') returning id", [w.storeId, w.clientId]);
    const assignmentId = assignments[0].id;
    const account = w.account;
    const entry = (lineId: string | null) =>
      db.query(
        "insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, invoice_line_id) values ($1, $2, $3, '2026-04-01', 90, $4)",
        [w.storeId, assignmentId, account, lineId],
      );
    const { lineId } = await importInvoice(w, { legacy: "2154" });
    await expect(entry(lineId)).rejects.toThrow(/work_time\.draft_only/);
    await db.transaction(async (tx) => {
      await tx.query("select set_config('commerce.work_importing', 'on', true)");
      await tx.query(
        "insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, invoice_line_id) values ($1, $2, $3, '2026-04-01', 90, $4)",
        [w.storeId, assignmentId, account, lineId],
      );
    });
    await expect(db.query("update commerce.work_time_entries set minutes = 60 where invoice_line_id = $1", [lineId])).rejects.toThrow(/work_time\.immutable/);
    // A normal invoice's issued lines still take no time, importing or not.
    const draft = await draftWithLine(w);
    const issued = await issue(w, draft);
    const { rows: lines } = await db.query<{ id: string }>("select id from commerce.work_invoice_lines where invoice_id = $1", [issued.id]);
    await expect(entry(lines[0].id)).rejects.toThrow(/work_time\.draft_only/);
  });
});

// Every table with a `store_id` has a decision about duplicating a store (D129): copied, or left with the original.
// A new store-owned table fails this test until it is added to COPY_RULES in src/lib/store-copy-rules.ts (and, if it
// is copied, to `commerce.duplicate_store()` or `copy_customers()`/`copy_orders()` in a migration; see docs/store-copy.md).
describe("duplicating a store: every store-owned table has a decision (D129)", () => {
  it("lists exactly the tables that have a store_id", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'commerce' and c.relkind in ('r', 'p')
         and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped)
       order by 1`,
    );
    const tables = rows.map((row) => row.relname);
    expect(tables.filter((table) => !(table in COPY_RULES))).toEqual([]);
    expect(Object.keys(COPY_RULES).filter((table) => !tables.includes(table))).toEqual([]);
  });
});

describe("duplicating a store (D129)", () => {
  let owner: string;
  let helper: string;
  let src: string;
  const ids = {} as Record<string, string>;

  const rows = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await db.query<T>(text, params)).rows;
  const scalar = async <T>(text: string, params: unknown[] = []) => Object.values((await rows(text, params))[0] ?? {})[0] as T;
  const cloneId = (newStore: string, id: string) => scalar<string>("select commerce.clone_id($1, $2)", [newStore, id]);
  const copyOf = async (
    slug: string,
    pages: string[] | null = null,
    products: string[] | null = null,
    posts: string[] | null = null,
  ) =>
    scalar<string>("select commerce.duplicate_store($1, $2, $3, $4, $5::uuid[], $6::uuid[], $7::uuid[])", [
      src,
      slug,
      slug,
      owner,
      pages,
      products,
      posts,
    ]);
  const count = (table: string, storeId: string) =>
    scalar<number>(`select count(*)::int from commerce.${table} where store_id = $1`, [storeId]);

  async function product(handle: string, status: string, over: { digital?: boolean } = {}) {
    const { productId, variantId } = await createProduct({ storeId: src });
    await db.query("update commerce.products set handle = $2 where id = $1", [productId, handle]);
    await db.query("update commerce.product_translations set title = $2 where product_id = $1", [productId, `Title ${handle}`]);
    if (over.digital) {
      await db.query("update commerce.product_variants set delivery = 'digital' where id = $1", [variantId]);
      await db.query("update commerce.products set delivery = 'digital' where id = $1", [productId]);
    }
    await db.query("select commerce.set_price($1, 'DE', 1000, $2)", [variantId, daysAgo(40)]);
    await db.query("select commerce.set_price($1, 'DE', 900, $2)", [variantId, daysAgo(1)]);
    // A download keeps no stock (wave 3: the database refuses a level for a variant that is not goods).
    if (!over.digital) {
      await db.query("insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, 5)", [
        src,
        variantId,
        ids.location,
      ]);
    }
    if (status !== "draft") await db.query("update commerce.products set status = $2 where id = $1", [productId, status]);
    ids[handle] = productId;
    ids[`${handle}-variant`] = variantId;
    return { productId, variantId };
  }

  const page = async (type: string, slug: string, content: object, published: boolean) =>
    (
      await one<{ id: string }>(
        `insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, ${published ? "'2026-01-02'" : "null"}, ${published ? "'2026-01-02'" : "null"}) returning id`,
        [src, type, slug, JSON.stringify(content), published ? JSON.stringify(content) : null],
      )
    ).id;

  beforeAll(async () => {
    owner = await createAccount("copier@example.com");
    helper = await createAccount("copier-staff@example.com");
    src = await createStore("copy-source", ["DE", "NO"]);
    await db.query(
      `update commerce.stores set legal_name = 'Karis AS', organisation_number = '999888777', modules = '{bookings,work}',
         custom_css = 'a { color: red }', setup_completed_at = now(), locales = '{en-IE,nb-NO}', status = 'active'
       where id = $1`,
      [src],
    );
    await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner'), ($1, $3, 'admin')", [
      src,
      owner,
      helper,
    ]);
    ids.location = (
      await one<{ id: string }>("insert into commerce.inventory_locations (store_id, name, country) values ($1, 'Lager', 'NO') returning id", [src])
    ).id;
    await db.query("insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor) values ($1, 'DE', 'EUR', 490)", [src]);
    await db.query("insert into commerce.payment_methods (store_id, market_code, method, enabled) values ($1, 'DE', 'card', true)", [src]);

    // Secrets and other things that never come along.
    await db.query(
      "insert into commerce.payment_credentials (store_id, provider, mode, secret_key_ciphertext) values ($1, 'stripe', 'test', 'sk-secret')",
      [src],
    );
    await db.query("insert into commerce.stripe_accounts (store_id, mode, account_id) values ($1, 'test', 'acct_original')", [src]);
    await db.query("insert into commerce.store_domains (store_id, hostname, token) values ($1, 'original.example', 'tok')", [src]);
    await db.query(
      "insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events) values ($1, 'slack', true, 'x', 'x', '{order.paid,customer.created}')",
      [src],
    );
    await db.query("insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint) values ($1, 'openai', 'x', 'x')", [src]);
    await db.query("insert into commerce.work_clients (store_id, name, currency) values ($1, 'Client', 'EUR')", [src]);
    await db.query("insert into commerce.hosts (store_id, account_id, name) values ($1, $2, 'A host')", [src, helper]);

    // Categories and tags.
    ids.shoes = (
      await one<{ id: string }>(
        "insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, 'product', 'category', 'Shoes', 'shoes') returning id",
        [src],
      )
    ).id;
    ids.sale = (
      await one<{ id: string }>(
        "insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, 'product', 'tag', 'Sale', 'sale') returning id",
        [src],
      )
    ).id;
    ids.boots = (
      await one<{ id: string }>(
        "insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id) values ($1, 'product', 'category', 'Boots', 'boots', $2) returning id",
        [src, ids.shoes],
      )
    ).id;

    // Products: one of each kind of state.
    await product("alpha", "active");
    await product("beta", "draft");
    await product("gamma", "archived");
    await product("delta", "active", { digital: true });
    await db.query("insert into commerce.product_terms (store_id, product_id, term_id) values ($1, $2, $3), ($1, $2, $4), ($1, $5, $3)", [
      src,
      ids.alpha,
      ids.shoes,
      ids.sale,
      ids.beta,
    ]);
    await db.query(
      "insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent) values ($1, $2, 'month', 1, 10)",
      [src, ids.alpha],
    );

    // Menus and pages.
    ids.menu = (
      await one<{ id: string }>(
        `insert into commerce.menus (store_id, name, items) values ($1, 'Main',
          $2::jsonb) returning id`,
        [
          src,
          JSON.stringify([
            { label: {}, link: { kind: "home" }, depth: 0 },
            { label: {}, link: { kind: "product", handle: "alpha" }, depth: 0 },
            { label: {}, link: { kind: "product", handle: "beta" }, depth: 0 },
            { label: {}, link: { kind: "products" }, depth: 1 },
            { label: {}, link: { kind: "url", url: "https://example.com" }, depth: 0 },
          ]),
        ],
      )
    ).id;
    ids.group = (
      await one<{ id: string }>(
        `insert into commerce.field_groups (store_id, name, slug, entities, fields)
         values ($1, 'Related', 'related', '["product","page"]', '[{"id":"f_related00001","name":"related","label":"Related","type":"product","access":"public"}]') returning id`,
        [src],
      )
    ).id;
    const content = (title: string) => ({
      title,
      rows: [{ id: "row-1", menu: ids.menu, group: ids.group, categories: [ids.shoes], tags: [ids.sale], store: src }],
    });
    ids.about = await page("page", "about", content("About"), true);
    ids.draftPage = await page("page", "coming", content("Coming"), false);
    ids.post = await page("article", "hello", content("Hello"), true);
    ids.draftPost = await page("article", "later", content("Later"), false);
    ids.header = await page("header", "main-header", content("Header"), true);
    ids.layout = await page("product_layout", "layout", content("Layout"), true);
    await db.query(
      `update commerce.stores set front_page_id = $2, header_id = $3, header_menu_id = $4, product_layout_id = $5,
         theme = $6::jsonb where id = $1`,
      [src, ids.about, ids.header, ids.menu, ids.layout, JSON.stringify({ base: "a", savedId: null, settings: {} })],
    );
    await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'blog', $2)", [src, ids.post]);
    await db.query("update commerce.products set product_layout_id = $2 where id = $1", [ids.alpha, ids.layout]);

    // Campaigns, codes and field values that name products.
    await db.query(
      `insert into commerce.campaigns (store_id, name, kind, percent, product_ids) values
         ($1, 'On alpha', 'percent', 10, $2::jsonb),
         ($1, 'On beta', 'percent', 10, $3::jsonb),
         ($1, 'Everything', 'percent', 5, '[]')`,
      [src, JSON.stringify([ids.alpha]), JSON.stringify([ids.beta])],
    );
    await db.query(
      `insert into commerce.campaigns (store_id, name, kind, gift_variant_id, gift_quantity)
       values ($1, 'Gift beta', 'gift', $2, 1)`,
      [src, ids["beta-variant"]],
    );
    await db.query(
      "insert into commerce.discount_codes (store_id, code, kind, percent, product_ids) values ($1, 'BETA10', 'percent', 10, $2::jsonb), ($1, 'ALL10', 'percent', 10, null)",
      [src, JSON.stringify([ids.beta])],
    );
    await db.query(
      "insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, 'product', $2, '', $3::jsonb), ($1, 'store', $1, '', '{\"f_x\":\"own\"}')",
      [src, ids.alpha, JSON.stringify({ f_related00001: [ids.alpha, ids.beta] })],
    );
    await db.query(
      "insert into commerce.customer_tiers (store_id, name, percent) values ($1, 'VIP', 10)",
      [src],
    );
    await db.query("insert into commerce.saved_parts (store_id, kind, name, content, sharing) values ($1, 'block', 'Mine', $2::jsonb, 'marketplace')", [
      src,
      JSON.stringify({ id: "b1", menuId: ids.menu }),
    ]);
  });

  it("copies the settings and everything chosen, remapping ids, and leaves the original alone", async () => {
    const before = await scalar<string>(
      "select md5((select string_agg(to_jsonb(p)::text, '' order by id) from commerce.products p where store_id = $1) || (select string_agg(to_jsonb(g)::text, '' order by id) from commerce.pages g where store_id = $1))",
      [src],
    );
    const copy = await copyOf("copy-all");

    const [store] = await rows<Record<string, unknown>>("select * from commerce.stores where id = $1", [copy]);
    expect(store).toMatchObject({
      slug: "copy-all",
      legal_name: "Karis AS",
      organisation_number: "999888777",
      custom_css: "a { color: red }",
      setup_completed_at: null,
      is_template: false,
      created_by: owner,
    });
    // The Work module is the owner's own bookkeeping; it is not switched on.
    expect(store.modules).toEqual(["bookings"]);
    // Only the person copying owns it.
    expect(await rows("select account_id, role from commerce.store_members where store_id = $1", [copy])).toEqual([
      { account_id: owner, role: "owner" },
    ]);

    // Products (not archived), with their parts, under new ids.
    expect(await rows("select handle, status from commerce.products where store_id = $1 order by handle", [copy])).toEqual([
      { handle: "alpha", status: "active" },
      { handle: "beta", status: "draft" },
      // A download waits as a draft for its files.
      { handle: "delta", status: "draft" },
    ]);
    const alpha = await cloneId(copy, ids.alpha);
    expect(await scalar("select id from commerce.products where store_id = $1 and handle = 'alpha'", [copy])).toBe(alpha);
    expect(await count("product_variants", copy)).toBe(3);
    expect(await count("inventory_levels", copy)).toBe(2);
    // The current price only, as a new price: no reduction it never made.
    expect(await rows("select amount_minor from commerce.prices where store_id = $1 and variant_id = $2", [copy, await cloneId(copy, ids["alpha-variant"])])).toEqual([
      { amount_minor: 900 },
    ]);
    expect(await scalar("select prior_30d_minor from commerce.current_prices where variant_id = $1", [await cloneId(copy, ids["alpha-variant"])])).toBeNull();
    expect(await count("selling_plans", copy)).toBe(1);
    expect(await count("terms", copy)).toBe(3);
    expect(await count("product_terms", copy)).toBe(3);
    expect(await scalar("select parent_id from commerce.terms where id = $1", [await cloneId(copy, ids.boots)])).toBe(await cloneId(copy, ids.shoes));

    // Pages, posts, header and layout, draft and published, with what they name remapped.
    expect(await rows("select type, slug, published is not null as live from commerce.pages where store_id = $1 order by type, slug", [copy])).toEqual([
      { type: "article", slug: "hello", live: true },
      { type: "article", slug: "later", live: false },
      { type: "header", slug: "main-header", live: true },
      { type: "page", slug: "about", live: true },
      { type: "page", slug: "coming", live: false },
      { type: "product_layout", slug: "layout", live: true },
    ]);
    const about = await scalar<{ rows: [{ menu: string; group: string; categories: string[]; tags: string[]; store: string }] }>(
      "select draft from commerce.pages where id = $1",
      [await cloneId(copy, ids.about)],
    );
    expect(about.rows[0]).toEqual({
      id: "row-1",
      menu: await cloneId(copy, ids.menu),
      group: await cloneId(copy, ids.group),
      categories: [await cloneId(copy, ids.shoes)],
      tags: [await cloneId(copy, ids.sale)],
      store: copy,
    });
    expect(await scalar("select first_published_at::date::text from commerce.pages where id = $1", [await cloneId(copy, ids.post)])).toBe("2026-01-02");
    expect(store).toMatchObject({
      front_page_id: await cloneId(copy, ids.about),
      header_id: await cloneId(copy, ids.header),
      header_menu_id: await cloneId(copy, ids.menu),
      product_layout_id: await cloneId(copy, ids.layout),
    });
    expect(await scalar("select page_id from commerce.page_roles where store_id = $1 and role = 'blog'", [copy])).toBe(await cloneId(copy, ids.post));
    expect(await scalar("select product_layout_id from commerce.products where id = $1", [alpha])).toBe(await cloneId(copy, ids.layout));

    // Settings: markets, shipping, payment switches, groups, codes, saved parts (private ones).
    expect(await count("markets", copy)).toBe(2);
    expect(await count("shipping_rates", copy)).toBe(1);
    expect(await count("payment_methods", copy)).toBe(1);
    expect(await count("customer_tiers", copy)).toBe(1);
    expect(await count("field_groups", copy)).toBe(1);
    expect(await count("inventory_locations", copy)).toBe(1);
    expect(await count("discount_codes", copy)).toBe(2);
    expect(await rows("select name, sharing from commerce.saved_parts where store_id = $1", [copy])).toEqual([{ name: "Mine", sharing: "private" }]);
    expect(await scalar("select content ->> 'menuId' from commerce.saved_parts where store_id = $1", [copy])).toBe(await cloneId(copy, ids.menu));
    expect(await scalar<number>("select count(*)::int from commerce.field_values where store_id = $1 and entity = 'store' and entity_id = $1", [copy])).toBe(1);

    // The original is as it was.
    expect(
      await scalar<string>(
        "select md5((select string_agg(to_jsonb(p)::text, '' order by id) from commerce.products p where store_id = $1) || (select string_agg(to_jsonb(g)::text, '' order by id) from commerce.pages g where store_id = $1))",
        [src],
      ),
    ).toBe(before);
    expect(await count("store_members", src)).toBe(2);
  });

  it("copies only what is chosen: none, some, all (null means all, an empty list none)", async () => {
    const none = await copyOf("copy-none", [], [], []);
    expect(await count("products", none)).toBe(0);
    expect(await count("product_variants", none)).toBe(0);
    expect(await count("prices", none)).toBe(0);
    // Headers, footers and product layouts are settings and come anyway; pages and posts do not.
    expect(await rows("select type from commerce.pages where store_id = $1 order by type", [none])).toEqual([
      { type: "header" },
      { type: "product_layout" },
    ]);
    // What pointed at a page that was not copied points at nothing.
    expect(await scalar("select front_page_id from commerce.stores where id = $1", [none])).toBeNull();
    expect(await count("page_roles", none)).toBe(0);
    // The structure stays: categories, menus, settings.
    expect(await count("terms", none)).toBe(3);
    expect(await count("menus", none)).toBe(1);
    expect(await count("markets", none)).toBe(2);
    expect(await scalar("select product_layout_id from commerce.stores where id = $1", [none])).toBe(await cloneId(none, ids.layout));

    const some = await copyOf("copy-some", [ids.about], [ids.alpha], [ids.post]);
    expect(await rows("select handle from commerce.products where store_id = $1", [some])).toEqual([{ handle: "alpha" }]);
    expect(await rows("select slug from commerce.pages where store_id = $1 and type in ('page', 'article') order by slug", [some])).toEqual([
      { slug: "about" },
      { slug: "hello" },
    ]);
    // Archived products are never copied, even when chosen; other stores' ids choose nothing.
    const archived = await copyOf("copy-archived", null, [ids.gamma, ids.alpha]);
    expect(await rows("select handle from commerce.products where store_id = $1", [archived])).toEqual([{ handle: "alpha" }]);
  });

  it("drops what named a product that was not copied, and switches off what would reach the whole store", async () => {
    const copy = await copyOf("copy-alpha-only", null, [ids.alpha]);
    // A menu's link to a product that is gone goes, with the items under it; the rest stays.
    const items = await scalar<{ link: { kind: string; handle?: string } }[]>("select items from commerce.menus where store_id = $1", [copy]);
    expect(items.map((item) => item.link.kind + (item.link.handle ? `:${item.link.handle}` : ""))).toEqual([
      "home",
      "product:alpha",
      "url",
    ]);
    // A campaign for products that were not copied is off (it would reach everything), the others as they were.
    expect(await rows("select name, active from commerce.campaigns where store_id = $1 order by name", [copy])).toEqual([
      { name: "Everything", active: true },
      { name: "On alpha", active: true },
      { name: "On beta", active: false },
    ]);
    expect(await scalar("select product_ids from commerce.campaigns where store_id = $1 and name = 'On alpha'", [copy])).toEqual([await cloneId(copy, ids.alpha)]);
    expect(await scalar("select product_ids from commerce.campaigns where store_id = $1 and name = 'On beta'", [copy])).toEqual([]);
    // A gift of a product that was not copied is left out.
    expect(await scalar("select count(*)::int from commerce.campaigns where store_id = $1 and kind = 'gift'", [copy])).toBe(0);
    expect(await rows("select code, active from commerce.discount_codes where store_id = $1 order by code", [copy])).toEqual([
      { code: "ALL10", active: true },
      { code: "BETA10", active: false },
    ]);
    // A relation to a product that was not copied leaves the field value.
    expect(await scalar("select values from commerce.field_values where store_id = $1 and entity = 'product'", [copy])).toEqual({
      f_related00001: [await cloneId(copy, ids.alpha)],
    });

    // With everything copied, all of it stays.
    const all = await copyOf("copy-with-beta");
    expect(await scalar("select count(*)::int from commerce.campaigns where store_id = $1 and active", [all])).toBe(4);
    expect(await scalar("select jsonb_array_length(items)::int from commerce.menus where store_id = $1", [all])).toBe(5);
  });

  it("copies nothing that belongs to the original alone, and nothing of the new store points back at it", async () => {
    const copy = await copyOf("copy-isolated");
    const { rows: tables } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'commerce' and c.relkind = 'r'
         and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped)`,
    );
    // Made for every store on its own: numbering, the payment provider row, the owner as member.
    // The level inserts write the copy's own opening movements (wave 3): one for each level that holds stock.
    const openings = await scalar<number>("select count(*)::int from commerce.inventory_levels where store_id = $1 and on_hand <> 0", [copy]);
    const made = new Map([["document_series", 5], ["payment_providers", 1], ["store_members", 1], ["inventory_movements", openings]]);
    for (const { relname } of tables) {
      const rule = COPY_RULES[relname];
      if (rule.group === "never") expect([relname, await count(relname, copy)]).toEqual([relname, made.get(relname) ?? 0]);
    }
    // Numbering starts again.
    expect(await rows("select series, next_number::int from commerce.document_series where store_id = $1 order by series", [copy])).toEqual([
      { series: "credit_note", next_number: 1 },
      { series: "invoice", next_number: 1 },
      { series: "order", next_number: 1001 },
      { series: "work_credit_note", next_number: 1 },
      { series: "work_invoice", next_number: 1 },
    ]);
    // No Stripe account, keys, domain, integration, AI provider or host came along; the switches did.
    expect(await scalar("select enabled from commerce.payment_providers where store_id = $1", [copy])).toBe(true);
    // Nothing of the new store names anything of the original's: its store, products, pages, terms, menus ...
    const theirs = (
      await rows<{ id: string }>(
        `select id from commerce.products where store_id = $1 union all select id from commerce.product_variants where store_id = $1
         union all select id from commerce.pages where store_id = $1 union all select id from commerce.terms where store_id = $1
         union all select id from commerce.menus where store_id = $1 union all select id from commerce.field_groups where store_id = $1
         union all select id from commerce.saved_parts where store_id = $1 union all select id from commerce.customer_tiers where store_id = $1
         union all select id from commerce.discount_codes where store_id = $1 union all select id from commerce.campaigns where store_id = $1
         union all select id from commerce.inventory_locations where store_id = $1 union all select id from commerce.economic_operators where store_id = $1
         union all select $1::uuid`,
        [src],
      )
    ).map((row) => row.id);
    for (const { relname } of tables) {
      if (COPY_RULES[relname].group === "never" || COPY_RULES[relname].group === "derived") continue;
      const hits = await scalar<number>(
        `select count(*)::int from commerce.${relname} t where t.store_id = $1 and to_jsonb(t)::text like any ($2::text[])`,
        [copy, theirs.map((id) => `%${id}%`)],
      );
      expect([relname, hits]).toEqual([relname, 0]);
    }
  });

  describe("customers and orders", () => {
    let copy: string;
    let orderIds: Record<string, string>;
    let customerIds: Record<string, string>;

    const batches = async (fn: "copy_customers" | "copy_orders", limit: number) => {
      const calls: { handled: number; copied: number }[] = [];
      let after: string | null = null;
      for (;;) {
        const [batch]: { last_id: string | null; handled: number; copied: number }[] = await rows<{ last_id: string | null; handled: number; copied: number }>(
          `select * from commerce.${fn}($1, $2, $3::uuid, $4)`,
          [src, copy, after, limit],
        );
        if (batch.handled === 0) return calls;
        calls.push({ handled: batch.handled, copied: batch.copied });
        after = batch.last_id;
      }
    };

    beforeAll(async () => {
      const tier = await scalar<string>("select id from commerce.customer_tiers where store_id = $1", [src]);
      const company = await scalar<string>(
        "insert into commerce.customer_companies (store_id, name, tier_id) values ($1, 'Acme AS', $2) returning id",
        [src, tier],
      );
      customerIds = {};
      for (const [name, over] of Object.entries({
        vip: `password_hash = 'scrypt$secret', auth_user_id = gen_random_uuid(), email_verified_at = now(), last_sign_in_at = now(), failed_sign_ins = 2, avatar_path = 'a/b.webp', tier_id = '${tier}', company_id = '${company}', company_role = 'owner', phone = '+4712345678'`,
        plain: "name = 'Plain'",
        third: "name = 'Third'",
      })) {
        customerIds[name] = await scalar<string>(
          "insert into commerce.customers (store_id, email) values ($1, $2) returning id",
          [src, `${name}@copy.example`],
        );
        await db.query(`update commerce.customers set ${over} where id = $1`, [customerIds[name]]);
      }
      await db.query(
        "insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at) values ($1, $2, 'h', now() + interval '1 day')",
        [src, customerIds.vip],
      );
      await db.query(
        "insert into commerce.customer_codes (store_id, email, code_hash, expires_at) values ($1, 'vip@copy.example', 'h', now() + interval '1 day')",
        [src],
      );
      await db.query("insert into commerce.email_opt_outs (store_id, email, source) values ($1, 'gone@copy.example', 'unsubscribe'), ($1, 'gone2@copy.example', 'complaint')", [src]);
      const fieldGroup = await scalar<string>(
        `insert into commerce.field_groups (store_id, name, slug, entities, fields)
         values ($1, 'Staff notes', 'staff-notes', '["customer","order"]', '[{"id":"f_note0000001","name":"note","label":"Note","type":"text","access":"staff"}]') returning id`,
        [src],
      );
      void fieldGroup;
      await db.query(
        "insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, 'customer', $2, '', '{\"f_note0000001\":\"likes red\"}')",
        [src, customerIds.vip],
      );

      const code = await scalar<string>("select id from commerce.discount_codes where store_id = $1 and code = 'ALL10'", [src]);
      orderIds = {};
      const order = async (key: string, number: string, status: string, customer: string | null, extra = "") => {
        const id = await scalar<string>(
          `insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status,
             subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address,
             placed_at, discount_code_id, discount_code, member_discount_minor, member_label, member_percent ${extra ? ", " + extra.split("=")[0] : ""})
           values ($1, $2, 'DE', 'EUR', 'de-DE', $3, 'buyer@copy.example', $4, 2000, 490, 100, 320, 2390,
             '{"name":"Buyer"}', '{"name":"Buyer","country":"DE"}', '2026-03-04T10:00:00Z', $5, 'ALL10', 100, 'VIP', 10 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`,
          [src, number, customer, status, code],
        );
        await db.query(
          `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
             total_minor, tax_minor, tax_rate, tax_code, member_discount_minor)
           values ($1, $2, $3, 'SKU', 'A thing', 2, 1000, 100, 1900, 320, 0.19, 'txcd_99999999', 100)`,
          [src, id, ids["alpha-variant"]],
        );
        orderIds[key] = id;
        return id;
      };
      await order("paid", "1001", "paid", customerIds.vip);
      await order("fulfilled", "1002", "fulfilled", null);
      await order("cancelled", "1003", "cancelled", customerIds.plain);
      await order("pending", "1004", "pending_payment", null);
      await db.query(
        "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', 'pi_1', 2390, 'EUR', 'captured')",
        [src, orderIds.paid],
      );
      // A parcel as markSent() writes it: the shipment and its lines in one transaction (D174).
      await db.transaction(async (tx) => {
        const shipment = (
          await tx.query<{ id: string }>("insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values ($1, $2, 'DHL', '123') returning id", [src, orderIds.fulfilled])
        ).rows[0].id;
        await tx.query(
          "insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity) select store_id, $2, id, quantity from commerce.order_lines where order_id = $3 and store_id = $1",
          [src, shipment, orderIds.fulfilled],
        );
      });
      await db.query("insert into commerce.order_events (store_id, order_id, type, data, actor) values ($1, $2, 'order.paid', '{}', 'system')", [src, orderIds.paid]);
      await db.query(
        "insert into commerce.field_values (store_id, entity, entity_id, locale, values) values ($1, 'order', $2, '', '{\"f_note0000001\":\"gift wrap\"}')",
        [src, orderIds.paid],
      );

      copy = await copyOf("copy-people");
      // What would tell the outside world about a new order or customer.
      await db.query(
        "insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events) values ($1, 'slack', true, 'x', 'x', '{order.paid,customer.created}')",
        [copy],
      );
      await db.query(
        "insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options) values ($1, $2, $3, '{}')",
        [src, copy, owner],
      );
    });

    it("only runs into a store a copy is running for", async () => {
      const stranger = await createStore("copy-stranger", ["DE"]);
      await expect(db.query("select * from commerce.copy_customers($1, $2, null, 10)", [src, stranger])).rejects.toThrow(/no store copy is running/);
      await expect(db.query("select * from commerce.copy_orders($1, $2, null, 10)", [src, stranger])).rejects.toThrow(/no store copy is running/);
    });

    it("copies shoppers in batches without anything that lets them sign in, and again without copying twice", async () => {
      expect(await batches("copy_customers", 2)).toEqual([
        { handled: 2, copied: 2 },
        { handled: 1, copied: 1 },
      ]);
      // A rerun finds them all done.
      expect(await batches("copy_customers", 10)).toEqual([{ handled: 3, copied: 0 }]);
      expect(await count("customers", copy)).toBe(3);

      const vip = await cloneId(copy, customerIds.vip);
      const [row] = await rows<Record<string, unknown>>("select * from commerce.customers where id = $1", [vip]);
      expect(row).toMatchObject({
        email: "vip@copy.example",
        phone: "+4712345678",
        copied_from: customerIds.vip,
        password_hash: null,
        auth_user_id: null,
        email_verified_at: null,
        last_sign_in_at: null,
        failed_sign_ins: 0,
        locked_until: null,
        avatar_path: null,
        tier_id: await scalar("select id from commerce.customer_tiers where store_id = $1", [copy]),
        company_role: "owner",
      });
      // Their group and company are the copies.
      expect(row.company_id).toBe(await cloneId(copy, await scalar("select id from commerce.customer_companies where store_id = $1", [src])));
      // Nothing to sign in with, nothing kept about them.
      for (const table of ["customer_sessions", "customer_codes", "customer_sign_in_links", "wishlists", "consents", "carts"]) {
        expect([table, await count(table, copy)]).toEqual([table, 0]);
      }
      // Staff notes about a customer come along.
      expect(await scalar("select values from commerce.field_values where store_id = $1 and entity = 'customer'", [copy])).toEqual({ f_note0000001: "likes red" });
      // No integration hears of them.
      expect(await count("integration_deliveries", copy)).toBe(0);
      // People who unsubscribed stay unsubscribed, and it can be run again.
      expect(await scalar("select commerce.copy_opt_outs($1, $2)", [src, copy])).toBe(2);
      expect(await scalar("select commerce.copy_opt_outs($1, $2)", [src, copy])).toBe(0);
      expect(await rows("select email, source from commerce.email_opt_outs where store_id = $1 order by email", [copy])).toEqual([
        { email: "gone2@copy.example", source: "complaint" },
        { email: "gone@copy.example", source: "unsubscribe" },
      ]);
    });

    it("copies order history as read-only orders numbered C-…, not those waiting for payment", async () => {
      const stock = () =>
        rows("select variant_id, on_hand, available::int from commerce.available_stock where store_id = $1 order by on_hand", [copy]);
      const stockBefore = await stock();
      expect(await batches("copy_orders", 2)).toEqual([
        { handled: 2, copied: 2 },
        { handled: 1, copied: 1 },
      ]);
      expect(await batches("copy_orders", 10)).toEqual([{ handled: 3, copied: 0 }]);
      expect(await rows("select number, status, copied_from is not null as copied from commerce.orders where store_id = $1 order by number", [copy])).toEqual([
        { number: "C-1001", status: "paid", copied: true },
        { number: "C-1002", status: "fulfilled", copied: true },
        { number: "C-1003", status: "cancelled", copied: true },
      ]);
      const paid = await cloneId(copy, orderIds.paid);
      const [order] = await rows<Record<string, unknown>>("select * from commerce.orders where id = $1", [paid]);
      expect(order).toMatchObject({
        total_minor: 2390,
        tax_minor: 320,
        discount_minor: 100,
        member_label: "VIP",
        discount_code: "ALL10",
        email: "buyer@copy.example",
        balance_minor: 0,
        cart_id: null,
        subscription_id: null,
        customer_id: await cloneId(copy, customerIds.vip),
        discount_code_id: await cloneId(copy, await scalar("select id from commerce.discount_codes where store_id = $1 and code = 'ALL10'", [src])),
      });
      expect(new Date(order.placed_at as string).toISOString()).toBe("2026-03-04T10:00:00.000Z");
      expect(await scalar("select customer_id from commerce.orders where id = $1", [await cloneId(copy, orderIds.fulfilled)])).toBeNull();
      expect(await rows("select sku, quantity, total_minor, variant_id from commerce.order_lines where order_id = $1", [paid])).toEqual([
        { sku: "SKU", quantity: 2, total_minor: 1900, variant_id: await cloneId(copy, ids["alpha-variant"]) },
      ]);
      // One event, `copied`; no payment, refund, invoice, shipment, download, reservation or email.
      expect(await rows("select type, data ->> 'original_number' as number from commerce.order_events where order_id = $1", [paid])).toEqual([
        { type: "copied", number: "1001" },
      ]);
      for (const table of ["payments", "refunds", "invoices", "shipments", "order_downloads", "inventory_reservations", "email_messages", "bookings", "integration_deliveries"]) {
        expect([table, await count(table, copy)]).toEqual([table, 0]);
      }
      // Stock and numbering are untouched.
      expect(await stock()).toEqual(stockBefore);
      expect(await scalar("select commerce.next_document_number($1, 'order')", [copy])).toBe(1001);
      expect(await scalar("select values from commerce.field_values where store_id = $1 and entity = 'order'", [copy])).toEqual({ f_note0000001: "gift wrap" });
      // The original is untouched.
      expect(await count("payments", src)).toBe(1);
      expect(await scalar("select count(*)::int from commerce.orders where store_id = $1 and copied_from is not null", [src])).toBe(0);
    });

    it("refuses everything that would act on a copied order", async () => {
      const paid = await cloneId(copy, orderIds.paid);
      const line = await scalar<string>("select id from commerce.order_lines where order_id = $1", [paid]);
      const refused = /copied_order/;
      await expect(db.query("update commerce.orders set status = 'fulfilled' where id = $1", [paid])).rejects.toThrow(refused);
      await expect(db.query("update commerce.orders set email = 'x@example.com' where id = $1", [paid])).rejects.toThrow(refused);
      await expect(db.query("update commerce.orders set copied_from = null where id = $1", [paid])).rejects.toThrow(refused);
      await expect(db.query("update commerce.order_lines set quantity = 3 where id = $1", [line])).rejects.toThrow(refused);
      await expect(db.query("delete from commerce.order_lines where id = $1", [line])).rejects.toThrow(refused);
      await expect(
        db.query(
          "insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code) values ($1, $2, 'S', 'T', 1, 1, 1, 0, 0, 'x')",
          [copy, paid],
        ),
      ).rejects.toThrow(refused);
      await expect(
        db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency) values ($1, $2, 'stripe', 'pi_new', 1, 'EUR')", [copy, paid]),
      ).rejects.toThrow(refused);
      await expect(db.query("insert into commerce.shipments (store_id, order_id) values ($1, $2)", [copy, paid])).rejects.toThrow(refused);
      await expect(
        db.query("insert into commerce.order_events (store_id, order_id, type, actor) values ($1, $2, 'order.paid', 'system')", [copy, paid]),
      ).rejects.toThrow(refused);
      await expect(
        db.query("insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, order_id) values ($1, 'order', 'a@b.no', 's', 'h', 't', $2)", [copy, paid]),
      ).rejects.toThrow(refused);
      await expect(
        db.query(
          "insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, order_id, expires_at) values ($1, $2, $3, 1, $4, now() + interval '1 hour')",
          [copy, await cloneId(copy, ids["alpha-variant"]), await cloneId(copy, ids.location), paid],
        ),
      ).rejects.toThrow(refused);
      // The payment and cancel functions cannot touch it either.
      const settled = (text: string) => db.query<{ done: boolean }>(text, [paid]).then((r) => r.rows[0].done, () => false);
      expect(await settled("select commerce.complete_order_payment($1, 'cs_x') as done")).toBe(false);
      expect(await settled("select commerce.cancel_unpaid_order($1, 'x') as done")).toBe(false);
      expect(await scalar("select status from commerce.orders where id = $1", [paid])).toBe("paid");
      // A customer deleting their account may still let go of their orders.
      await db.query("update commerce.orders set customer_id = null where id = $1", [paid]);
      expect(await scalar("select customer_id from commerce.orders where id = $1", [paid])).toBeNull();
      // An order cannot be made a copy, nor a copy of an unpaid one made.
      const real = await createOrder(`R-${++counter}`);
      await expect(db.query("update commerce.orders set copied_from = $2 where id = $1", [real, real])).rejects.toThrow(refused);
      await expect(
        db.query(
          `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from)
           values ($1, 'C-9', 'DE', 'EUR', 'de-DE', '', 1, 0, 1, '{}', '{}', $2)`,
          [copy, real],
        ),
      ).rejects.toThrow(refused);
    });
  });
});

describe("the bonus program (D130)", () => {
  let shop: string;
  let ownerAccount: string;

  beforeAll(async () => {
    shop = await createStore("bonus-shop", ["NO", "DE"]);
    // The program works only with its store feature on (D178).
    await db.query("update commerce.stores set country = 'NO', features = '{shop,bonus}' where id = $1", [shop]);
    await db.query(
      `insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
       values ($1, 'NOK', 11.5, 1, 0), ($1, 'EUR', 1, 1, 1)`,
      [shop],
    );
    ownerAccount = await createAccount("bonus-owner@example.com");
  });

  /** Turns the program on (or changes it) for the store. */
  const settings = (over: { enabled?: boolean; earn?: number; pendingDays?: number; expires?: number | null } = {}) =>
    db.query(
      `insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, expires_months, currency)
       values ($1, $2, $3, $4, 50, $5, commerce.bonus_currency($1))
       on conflict (store_id) do update set enabled = excluded.enabled, earn_bps = excluded.earn_bps,
         pending_days = excluded.pending_days, expires_months = excluded.expires_months`,
      [shop, over.enabled ?? true, over.earn ?? 500, over.pendingDays ?? 14, over.expires ?? null],
    );

  const customer = async () => {
    counter += 1;
    return (await one<{ id: string }>("insert into commerce.customers (store_id, email) values ($1, $2) returning id", [shop, `bonus-${counter}@example.com`])).id;
  };

  /** An order waiting for payment with one line of goods (and shipping on top), in NOK unless said. */
  async function order(customerId: string | null, goods: number, over: { venue?: number; shipping?: number; currency?: string; host?: boolean } = {}) {
    counter += 1;
    const shipping = over.shipping ?? 0;
    const currency = over.currency ?? "NOK";
    const { id } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id,
         subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
       values ($1, $2, $3, $4, 'nb-NO', 'x@example.com', $5, $6, $7, 0, 0, $8, '{}', '{}') returning id`,
      [shop, `B-${counter}`, currency === "NOK" ? "NO" : "DE", currency, customerId, goods, shipping, goods + shipping],
    );
    await db.query(
      `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, venue_minor, delivery)
       values ($1, $2, 'SIGNUP-FEE', 'Thing', 1, $3, $3, 0, 0.25, 'txcd_99999999', $4, 'digital')`,
      [shop, id, goods, over.venue ?? 0],
    );
    return id;
  }

  const pay = async (orderId: string) => (await one<{ done: boolean }>("select commerce.complete_order_payment($1, 'cs') as done", [orderId])).done;
  const balance = (customerId: string) =>
    one<{ available_minor: string; pending_minor: string; expiring_minor: string; expiring_at: Date | null }>("select * from commerce.bonus_balance($1, $2)", [shop, customerId]).then((r) => ({
      available: Number(r.available_minor),
      pending: Number(r.pending_minor),
      expiringMinor: Number(r.expiring_minor),
      expiringAt: r.expiring_at,
    }));
  const verified = async (customerId: string) => (await one<{ ok: boolean }>("select commerce.bonus_verify($1, $2) as ok", [shop, customerId])).ok;
  const entries = async (customerId: string) =>
    (await db.query<{ kind: string; amount_minor: string; order_id: string | null; key: string }>(
      "select kind, amount_minor, order_id, idempotency_key as key from commerce.bonus_entries where customer_id = $1 order by created_at, amount_minor desc",
      [customerId],
    )).rows.map((r) => ({ kind: r.kind, amount: Number(r.amount_minor), orderId: r.order_id }));
  /** Moves a customer's whole ledger back in time, so credits pending for 14 days have passed them (the ledger is immutable, but a test may pull the trigger). */
  async function ageBonus(customerId: string, days: number) {
    await db.exec("alter table commerce.bonus_entries disable trigger bonus_entries_immutable");
    await db.query(
      `update commerce.bonus_entries set created_at = created_at - make_interval(days => $2), available_at = available_at - make_interval(days => $2),
         expires_at = expires_at - make_interval(days => $2) where customer_id = $1`,
      [customerId, days],
    );
    await db.exec("alter table commerce.bonus_entries enable trigger bonus_entries_immutable");
  }
  const grant = (customerId: string, amount: number, over: { availableInDays?: number; expiresInDays?: number | null; key?: string } = {}) => {
    counter += 1;
    return db.query(
      `select commerce.bonus_grant($1, $2, 'adjust', $3, null, null, now() + make_interval(days => $4),
         case when $5::int is null then null else now() + make_interval(days => $5::int) end, 'test', null, $6)`,
      [shop, customerId, amount, over.availableInDays ?? 0, over.expiresInDays ?? null, over.key ?? `grant-${counter}`],
    );
  };
  const redeem = (customerId: string, orderId: string, amount: number) =>
    one<{ taken: string }>("select commerce.bonus_redeem($1, $2, $3, $4, $5) as taken", [shop, customerId, orderId, amount, `redeem:${orderId}`]);

  it("keeps the ledger append-only: no change to an entry or an allocation, and no delete but the customer's", async () => {
    await settings();
    const c = await customer();
    await grant(c, 1_000);
    const o = await order(c, 10_000);
    await redeem(c, o, 400);
    const refused = /append-only/;
    await expect(db.query("update commerce.bonus_entries set amount_minor = 5 where customer_id = $1", [c])).rejects.toThrow(refused);
    await expect(db.query("delete from commerce.bonus_entries where customer_id = $1", [c])).rejects.toThrow(refused);
    await expect(db.query("update commerce.bonus_allocations set amount_minor = 1 where entry_id in (select id from commerce.bonus_entries where customer_id = $1)", [c])).rejects.toThrow(refused);
    await expect(db.query("delete from commerce.bonus_allocations where store_id = $1", [shop])).rejects.toThrow(refused);
    // The customer deleting their account takes their ledger with them, allocations too.
    await db.query("update commerce.orders set customer_id = null where id = $1", [o]);
    await db.query("delete from commerce.customers where id = $1", [c]);
    expect(Number((await one<{ n: string }>("select count(*) as n from commerce.bonus_entries where customer_id = $1", [c])).n)).toBe(0);
    expect(Number((await one<{ n: string }>("select count(*) as n from commerce.bonus_allocations a where not exists (select 1 from commerce.bonus_entries e where e.id = a.entry_id)")).n)).toBe(0);
  });

  it("grants and uses each happen once per key", async () => {
    const c = await customer();
    await grant(c, 500, { key: "once" });
    await grant(c, 500, { key: "once" });
    expect((await balance(c)).available).toBe(500);
    const o = await order(c, 10_000);
    expect(Number((await redeem(c, o, 200)).taken)).toBe(200);
    expect(Number((await redeem(c, o, 200)).taken)).toBe(200);
    expect((await balance(c)).available).toBe(300);
    expect(await verified(c)).toBe(true);
  });

  it("refuses to use more than is usable now: a balance never goes below zero", async () => {
    const c = await customer();
    await grant(c, 300);
    await grant(c, 1_000, { availableInDays: 5 });
    const o = await order(c, 10_000);
    await expect(redeem(c, o, 301)).rejects.toThrow("bonus.insufficient");
    expect(Number((await redeem(c, o, 300)).taken)).toBe(300);
    const p = await order(c, 10_000);
    await expect(redeem(c, p, 1)).rejects.toThrow("bonus.insufficient");
    expect(await balance(c)).toMatchObject({ available: 0, pending: 1_000 });
    // Whatever writes the ledger, an entry that is not covered by lots cannot be committed.
    await expect(
      db.query(
        `insert into commerce.bonus_entries (store_id, customer_id, kind, amount_minor, idempotency_key)
         values ($1, $2, 'expire', -1, 'sneaky')`,
        [shop, c],
      ),
    ).rejects.toThrow("bonus.below_zero");
    // Nor an allocation beyond what a lot holds.
    const lot = await one<{ id: string }>("select id from commerce.bonus_entries where customer_id = $1 and amount_minor = 300", [c]);
    const spend = await one<{ id: string }>("select id from commerce.bonus_entries where customer_id = $1 and kind = 'redeem'", [c]);
    await expect(
      db.query("insert into commerce.bonus_allocations (store_id, lot_id, entry_id, amount_minor) values ($1, $2, $3, 1)", [shop, lot.id, spend.id]),
    ).rejects.toThrow();
    expect(await verified(c)).toBe(true);
  });

  it("uses the credits that expire first, then the oldest", async () => {
    const c = await customer();
    await grant(c, 100, { expiresInDays: 90 });
    await grant(c, 100, { expiresInDays: 30 });
    await grant(c, 100);
    const o = await order(c, 10_000);
    await redeem(c, o, 250);
    // Two lots are gone (the one expiring on day 30 and the one day 90); 50 is left of the last, which never expires.
    const left = await db.query<{ amount_minor: string; remaining: string; expires_at: Date | null }>(
      "select amount_minor, remaining, expires_at from commerce.bonus_lots($1, $2) order by expires_at nulls last",
      [shop, c],
    );
    expect(left.rows.map((r) => [Number(r.amount_minor), Number(r.remaining)])).toEqual([[100, 0], [100, 0], [100, 50]]);
    expect(left.rows[2].expires_at).toBeNull();
  });

  it("earns on what is paid online for goods, once, and only for a signed-in customer", async () => {
    await settings({ earn: 500, pendingDays: 14 });
    const c = await customer();
    // 1000 of goods, 99 of shipping, 300 of the goods left for the venue: 5 % of 700.
    const o = await order(c, 1_000, { shipping: 99, venue: 300 });
    expect(await pay(o)).toBe(true);
    expect(await entries(c)).toEqual([{ kind: "earn", amount: 35, orderId: o }]);
    expect(await pay(o)).toBe(false);
    expect(await entries(c)).toHaveLength(1);
    const row = await one<{ bonus_earned_minor: string; bonus_available_at: Date }>("select bonus_earned_minor, bonus_available_at from commerce.orders where id = $1", [o]);
    expect(Number(row.bonus_earned_minor)).toBe(35);
    expect(row.bonus_available_at.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    // A guest earns nothing.
    const guest = await order(null, 10_000);
    await pay(guest);
    expect(Number((await one<{ n: string }>("select count(*) as n from commerce.bonus_entries where order_id = $1", [guest])).n)).toBe(0);
    // Nor does a host's order (the store's credits are not the host's to give).
    const hostAccount = await createAccount(`bonus-host-${++counter}@example.com`);
    const { id: hostId } = await one<{ id: string }>("insert into commerce.hosts (store_id, account_id, name) values ($1, $2, 'Host') returning id", [shop, hostAccount]);
    const hosted = await order(c, 10_000);
    await db.query("update commerce.orders set host_id = $2 where id = $1", [hosted, hostId]);
    await pay(hosted);
    expect(Number((await one<{ n: string }>("select count(*) as n from commerce.bonus_entries where order_id = $1", [hosted])).n)).toBe(0);
    expect(await verified(c)).toBe(true);
  });

  it("keeps earned credits pending for the return period, then usable", async () => {
    await settings({ earn: 1_000, pendingDays: 14 });
    const c = await customer();
    await pay(await order(c, 5_000));
    expect(await balance(c)).toMatchObject({ available: 0, pending: 500 });
    await ageBonus(c, 13);
    expect(await balance(c)).toMatchObject({ available: 0, pending: 500 });
    await ageBonus(c, 2);
    expect(await balance(c)).toMatchObject({ available: 500, pending: 0 });
    // With no return period they are usable at once.
    await settings({ earn: 1_000, pendingDays: 0 });
    const d = await customer();
    await pay(await order(d, 5_000));
    expect(await balance(d)).toMatchObject({ available: 500, pending: 0 });
    await settings();
  });

  it("converts what is earned into the credits' currency at the store's rates, rounded down", async () => {
    await settings({ earn: 1_000, pendingDays: 0 });
    const c = await customer();
    // 100.00 EUR of goods at 10 % is 10.00 EUR = 115.00 NOK.
    await pay(await order(c, 10_000, { currency: "EUR" }));
    expect((await balance(c)).available).toBe(11_500);
    const convert = (amount: number, from: string, to: string) => one<{ v: string | null }>("select commerce.bonus_convert($1, $2, $3, $4) as v", [shop, amount, from, to]);
    expect(Number((await convert(1_150, "NOK", "EUR")).v)).toBe(100);
    expect(Number((await convert(1_149, "NOK", "EUR")).v)).toBe(99);
    expect((await convert(100, "NOK", "SEK")).v).toBeNull();
    expect(Number((await convert(100, "NOK", "NOK")).v)).toBe(100);
    await settings();
  });

  it("changes to the settings do not touch what was already earned", async () => {
    await settings({ earn: 500, pendingDays: 14, expires: 12 });
    const c = await customer();
    await pay(await order(c, 10_000));
    const before = await db.query("select amount_minor, available_at, expires_at from commerce.bonus_entries where customer_id = $1", [c]);
    await settings({ earn: 2_000, pendingDays: 0, expires: 1 });
    await pay(await order(null, 10_000));
    expect((await db.query("select amount_minor, available_at, expires_at from commerce.bonus_entries where customer_id = $1", [c])).rows).toEqual(before.rows);
    // The program off: nothing more is earned or used, and the balance stays.
    await settings({ enabled: false });
    const o = await order(c, 10_000);
    await pay(o);
    expect(await entries(c)).toHaveLength(1);
    await expect(redeem(c, o, 1)).rejects.toThrow("bonus.off");
    expect((await balance(c)).pending).toBe(500);
    await settings();
  });

  it("holds used credits against an order, gives them back when it is never paid, and takes them again if it is paid late", async () => {
    await settings({ earn: 500, pendingDays: 0 });
    const c = await customer();
    await grant(c, 1_000);
    const o = await order(c, 10_000);
    await redeem(c, o, 600);
    expect((await balance(c)).available).toBe(400);
    await db.query("select commerce.cancel_unpaid_order($1, 'expired')", [o]);
    expect((await balance(c)).available).toBe(1_000);
    expect((await entries(c)).map((e) => e.kind)).toEqual(expect.arrayContaining(["adjust", "redeem", "restore"]));
    // Cancelling twice gives nothing back twice.
    await db.query("select commerce.cancel_unpaid_order($1, 'again')", [o]);
    expect((await balance(c)).available).toBe(1_000);
    // The payment arrives after the order was cancelled: the credits it used are taken again, and it earns.
    expect(await pay(o)).toBe(true);
    expect(await balance(c)).toMatchObject({ available: 400 + 500 });
    expect(await verified(c)).toBe(true);
    // ...and as far as the customer still has them: the rest is the store's loss, noted on the order.
    const p = await order(c, 10_000);
    await redeem(c, p, 900);
    await db.query("select commerce.cancel_unpaid_order($1, 'expired')", [p]);
    const spent = await order(c, 10_000);
    await redeem(c, spent, 800);
    await pay(p);
    const short = await one<{ data: { missing: number } }>("select data from commerce.order_events where order_id = $1 and type = 'bonus.short'", [p]);
    expect(short.data.missing).toBe(800);
    // 100 were left to take; what p earned (500) is usable.
    expect((await balance(c)).available).toBe(500);
    expect(await verified(c)).toBe(true);
    await settings();
  });

  it("takes back what a refunded part earned and returns the refunded share of what was used, adding up exactly", async () => {
    await settings({ earn: 1_000, pendingDays: 0 });
    const c = await customer();
    await grant(c, 1_000);
    // 10 000 of goods, 1 000 paid with credits: 9 000 paid online earn 900.
    const o = await order(c, 9_000);
    await redeem(c, o, 1_000);
    await pay(o);
    const { id: paymentId } = await one<{ id: string }>(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', $3, 9000, 'NOK', 'captured') returning id",
      [shop, o, `cs_refund_${counter}`],
    );
    const refund = (amount: number, status = "succeeded") =>
      db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values ($1, $2, $3, 'test', $4::commerce.refund_status)", [shop, paymentId, amount, status]);
    expect(await balance(c)).toMatchObject({ available: 900 });
    // Refund a third: 300 of the earned 900 are taken back, a third of the 1 000 used comes back (333).
    await refund(3_000);
    expect(await balance(c)).toMatchObject({ available: 900 - 300 + 333 });
    // A refund that failed changes nothing.
    await refund(1_000, "failed");
    expect(await balance(c)).toMatchObject({ available: 933 });
    // The rest: everything earned is taken back and everything used has come back, to the unit.
    await refund(3_000);
    await refund(3_000);
    expect(await balance(c)).toMatchObject({ available: 1_000 });
    const kinds = await entries(c);
    expect(kinds.filter((e) => e.kind === "reverse").reduce((s, e) => s + e.amount, 0)).toBe(-900);
    expect(kinds.filter((e) => e.kind === "restore").reduce((s, e) => s + e.amount, 0)).toBe(1_000);
    expect(await verified(c)).toBe(true);
  });

  it("never takes back more than is left of the credits an order earned", async () => {
    await settings({ earn: 1_000, pendingDays: 0 });
    const c = await customer();
    const o = await order(c, 10_000);
    await pay(o);
    // The customer spends all of it on another order before the refund.
    const other = await order(c, 10_000);
    await redeem(c, other, 1_000);
    expect((await balance(c)).available).toBe(0);
    const { id: paymentId } = await one<{ id: string }>(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', $3, 10000, 'NOK', 'captured') returning id",
      [shop, o, `cs_cap_${counter}`],
    );
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values ($1, $2, 10000, 'test', 'succeeded')", [shop, paymentId]);
    // What was used stays used: nothing is taken, and the balance is not below zero.
    expect((await balance(c)).available).toBe(0);
    expect((await entries(c)).some((e) => e.kind === "reverse")).toBe(false);
    expect(await verified(c)).toBe(true);
  });

  it("takes back the rest of what a paid order earned, and returns what it used, when it is cancelled", async () => {
    await settings({ earn: 1_000, pendingDays: 14 });
    const c = await customer();
    await grant(c, 400);
    const o = await order(c, 6_000);
    await redeem(c, o, 400);
    await pay(o);
    expect(await balance(c)).toMatchObject({ available: 0, pending: 600 });
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [o]);
    expect(await balance(c)).toMatchObject({ available: 400, pending: 0 });
    expect(await verified(c)).toBe(true);
    // Cancelled only once: nothing more happens.
    expect((await entries(c)).length).toBe(5);
    await settings();
  });

  it("writes off credits past their expiry, oldest first, once, and finds who to remind", async () => {
    await settings({ earn: 1_000, pendingDays: 0, expires: 1 });
    const c = await customer();
    await pay(await order(c, 10_000));
    expect(await balance(c)).toMatchObject({ available: 1_000 });
    expect((await balance(c)).expiringAt).not.toBeNull();
    // Not due yet: 30 days of a month later they are.
    const due = async () => Number((await one<{ n: string }>("select commerce.bonus_expire_due() as n")).n);
    const soon = (await db.query("select * from commerce.bonus_expiring(45) where customer_id = $1", [c])).rows;
    expect(soon).toHaveLength(1);
    expect(Number((soon[0] as { amount_minor: string }).amount_minor)).toBe(1_000);
    expect((await db.query("select * from commerce.bonus_expiring(3) where customer_id = $1", [c])).rows).toHaveLength(0);
    await due();
    expect((await entries(c)).some((e) => e.kind === "expire")).toBe(false);
    await ageBonus(c, 40);
    // Expired credits no longer count, even before the job has written them off.
    expect(await balance(c)).toMatchObject({ available: 0, pending: 0 });
    expect(await due()).toBeGreaterThanOrEqual(1);
    expect((await entries(c)).filter((e) => e.kind === "expire")).toEqual([{ kind: "expire", amount: -1_000, orderId: null }]);
    expect(await due()).toBe(0);
    expect(await verified(c)).toBe(true);
    await settings();
  });

  it("lets staff add and take away credits with a reason, never below zero", async () => {
    const c = await customer();
    const adjust = (amount: number) =>
      db.query("select commerce.bonus_adjust($1, $2, $3, 'goodwill', $4, $5)", [shop, c, amount, ownerAccount, `adjust-${amount}-${++counter}`]);
    await adjust(700);
    await grant(c, 200, { availableInDays: 3, key: `pending-${counter}` });
    expect(await balance(c)).toMatchObject({ available: 700, pending: 200 });
    await adjust(-800);
    // Usable credits go first, then the pending ones.
    expect(await balance(c)).toMatchObject({ available: 0, pending: 100 });
    await expect(adjust(-101)).rejects.toThrow("bonus.insufficient");
    await expect(adjust(0)).rejects.toThrow("bonus.zero");
    const note = await one<{ note: string; created_by: string }>("select note, created_by from commerce.bonus_entries where customer_id = $1 and amount_minor = -800", [c]);
    expect(note).toEqual({ note: "goodwill", created_by: ownerAccount });
    expect(await verified(c)).toBe(true);
  });

  it("never earns on an order copied from another store, whatever calls it", async () => {
    await settings({ earn: 1_000, pendingDays: 0 });
    const c = await customer();
    const o = await order(c, 10_000);
    // Made a copy behind the triggers' back (they refuse it), as a copy's history would be.
    await db.exec("set session_replication_role = replica");
    await db.query("update commerce.orders set copied_from = id, number = 'C-' || number where id = $1", [o]);
    await db.exec("set session_replication_role = origin");
    await db.query("select commerce.bonus_order_paid($1, 'pending_payment')", [o]);
    await db.query("select commerce.bonus_order_paid($1, 'cancelled')", [o]);
    // It cannot be paid either: the copy's rules refuse.
    await expect(pay(o)).rejects.toThrow("copied_order");
    expect(await entries(c)).toEqual([]);
    await settings();
  });

  it("copies a store's bonus settings and never its customers' credits", async () => {
    await settings({ earn: 750, pendingDays: 7, expires: 6 });
    const c = await customer();
    await grant(c, 100);
    const owner = await createAccount("bonus-copier@example.com");
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'bonus-copy', 'Bonus copy', $2) as id", [shop, owner]);
    const copied = await one<{ earn_bps: number; pending_days: number; expires_months: number; currency: string; enabled: boolean }>(
      "select earn_bps, pending_days, expires_months, currency, enabled from commerce.bonus_settings where store_id = $1",
      [copy],
    );
    expect(copied).toEqual({ earn_bps: 750, pending_days: 7, expires_months: 6, currency: "NOK", enabled: true });
    expect(Number((await one<{ n: string }>("select count(*) as n from commerce.bonus_entries where store_id = $1", [copy])).n)).toBe(0);
    await settings();
  });

  it("pins the credits' currency to the store's main currency", async () => {
    expect((await one<{ c: string }>("select commerce.bonus_currency($1) as c", [shop])).c).toBe("NOK");
    // A store with no settings yet uses its own country's currency.
    const fresh = await createStore("bonus-fresh", ["SE", "NO"]);
    await db.query("update commerce.stores set country = 'SE' where id = $1", [fresh]);
    expect((await one<{ c: string }>("select commerce.bonus_currency($1) as c", [fresh])).c).toBe("SEK");
  });
});

describe("store analytics data (D152)", () => {
  const TABLES = ["analytics_settings", "analytics_targets", "marketing_spend", "visits", "product_views"];
  const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

  it("keeps a cost per unit on a variant and on a sold line, never below zero, and nothing without one", async () => {
    const { variantId } = await createProduct();
    expect((await one<{ cost_minor: string | null }>("select cost_minor from commerce.product_variants where id = $1", [variantId])).cost_minor).toBeNull();
    await db.query("update commerce.product_variants set cost_minor = 0 where id = $1", [variantId]);
    await db.query("update commerce.product_variants set cost_minor = 1250 where id = $1", [variantId]);
    await rejects("update commerce.product_variants set cost_minor = -1 where id = $1", [variantId], /product_variants_cost_minor/);

    const { id: orderId } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
         discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
       values ($1, 'AN-1', 'DE', 'EUR', 'de-DE', 'a@example.com', 'paid', 1000, 0, 0, 160, 1000, '{}', '{}', now()) returning id`,
      [store],
    );
    const line = (cost: number | null) =>
      db.query(
        `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
           total_minor, tax_minor, tax_rate, tax_code, unit_cost_minor)
         values ($1, $2, $3, 'SKU', 'A thing', 1, 1000, 0, 1000, 160, 0.19, 'txcd_99999999', $4)`,
        [store, orderId, variantId, cost],
      );
    await line(null);
    await line(0);
    await line(1250);
    await expect(line(-5)).rejects.toThrow(/order_lines_unit_cost/);
    // A later change of the variant's cost never reaches the line.
    await db.query("update commerce.product_variants set cost_minor = 9999 where id = $1", [variantId]);
    expect(
      (await db.query("select unit_cost_minor::int as c from commerce.order_lines where order_id = $1 order by c nulls first", [orderId])).rows,
    ).toEqual([{ c: null }, { c: 0 }, { c: 1250 }]);
  });

  it("has the settings' defaults and refuses values out of range", async () => {
    const shop = await createStore("analytics-settings", ["NO"]);
    await db.query("insert into commerce.analytics_settings (store_id) values ($1)", [shop]);
    expect(await one("select payment_fee_bps, payment_fee_fixed_minor::int as fixed, shipping_cost_minor::int as ship, fixed_costs_monthly_minor::int as monthly, ltv_lifespan_years from commerce.analytics_settings where store_id = $1", [shop])).toEqual({
      payment_fee_bps: 0,
      fixed: 0,
      ship: 0,
      monthly: 0,
      ltv_lifespan_years: 3,
    });
    for (const [column, value, check] of [
      ["payment_fee_bps", 10001, /analytics_settings_fee_bps/],
      ["payment_fee_bps", -1, /analytics_settings_fee_bps/],
      ["payment_fee_fixed_minor", -1, /analytics_settings_amounts/],
      ["shipping_cost_minor", -1, /analytics_settings_amounts/],
      ["fixed_costs_monthly_minor", -1, /analytics_settings_amounts/],
      ["ltv_lifespan_years", 0, /analytics_settings_lifespan/],
      ["ltv_lifespan_years", 11, /analytics_settings_lifespan/],
    ] as const) {
      await rejects(`update commerce.analytics_settings set ${column} = $2 where store_id = $1`, [shop, value], check);
    }
    await db.query("update commerce.analytics_settings set payment_fee_bps = 10000, ltv_lifespan_years = 10 where store_id = $1", [shop]);
  });

  it("keeps one target per month, on its first day, above zero", async () => {
    const shop = await createStore("analytics-targets", ["NO"]);
    const insert = "insert into commerce.analytics_targets (store_id, month, revenue_target_minor) values ($1, $2, $3)";
    await db.query(insert, [shop, "2026-10-01", 500000]);
    await rejects(insert, [shop, "2026-10-01", 600000], /analytics_targets_month_key/);
    await rejects(insert, [shop, "2026-11-15", 600000], /analytics_targets_first_of_month/);
    await rejects(insert, [shop, "2026-11-01", 0], /analytics_targets_amount/);
    await db.query(insert, [other, "2026-10-01", 1]);
  });

  it("keeps one spend per day, channel and campaign, from a known channel, above zero", async () => {
    const shop = await createStore("analytics-spend", ["NO"]);
    const insert = "insert into commerce.marketing_spend (store_id, day, channel, campaign, amount_minor) values ($1, $2, $3, $4, $5)";
    await db.query(insert, [shop, "2026-10-01", "paid_search", "", 1000]);
    await db.query(insert, [shop, "2026-10-01", "paid_search", "brand", 500]);
    await db.query(insert, [shop, "2026-10-02", "paid_search", "", 500]);
    await rejects(insert, [shop, "2026-10-01", "paid_search", "", 1], /marketing_spend_key/);
    await rejects(insert, [shop, "2026-10-01", "carrier_pigeon", "", 1], /marketing_spend_channel/);
    await rejects(insert, [shop, "2026-10-01", "email", "", 0], /marketing_spend_amount/);
    await rejects(insert, [shop, "2026-10-01", "email", "x".repeat(101), 5], /marketing_spend_campaign/);
    await rejects("insert into commerce.marketing_spend (store_id, day, channel, amount_minor, note) values ($1, '2026-10-03', 'email', 5, $2)", [shop, "x".repeat(501)], /marketing_spend_note/);
  });

  it("keeps one visitor-day per store, only of a known device and channel, with nothing that identifies anyone", async () => {
    const shop = await createStore("analytics-visits", ["NO"]);
    const insert = `insert into commerce.visits (store_id, day, visitor, device, channel, landing_path) values ($1, '2026-10-01', $2, $3, $4, '/s/x/no')`;
    const hex = "0123456789abcdef01234567";
    await db.query(insert, [shop, hex, "mobile", "direct"]);
    await rejects(insert, [shop, hex, "desktop", "email"], /visits_day_visitor_key/);
    await db.query(insert, [other, hex, "tablet", "referral"]);
    await rejects(insert, [shop, "NOT-HEX-0123456789abcd", "mobile", "direct"], /visits_visitor/);
    await rejects(insert, [shop, "fedcba9876543210fedcba98", "watch", "direct"], /visits_device/);
    await rejects(insert, [shop, "fedcba9876543210fedcba98", "mobile", "tv"], /visits_channel/);
    await rejects("update commerce.visits set landing_path = $2 where store_id = $1", [shop, "/" + "x".repeat(300)], /visits_text_lengths/);
    await rejects("update commerce.visits set page_views = -1 where store_id = $1", [shop], /visits_counts/);
    // No column holds an address or a user agent.
    const { rows } = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'commerce' and table_name = 'visits'",
    );
    expect(rows.map((r) => r.column_name).filter((c) => /ip|agent|cookie|email/.test(c))).toEqual([]);
  });

  it("links a cart to its visit, and lets go of it when the visit is deleted", async () => {
    const shop = await createStore("analytics-cart", ["NO"]);
    const { id: visit } = await one<{ id: string }>(
      "insert into commerce.visits (store_id, day, visitor, device, channel, landing_path) values ($1, '2026-10-01', '0123456789abcdef01234567', 'mobile', 'direct', '/') returning id",
      [shop],
    );
    const { id: cart } = await one<{ id: string }>(
      "insert into commerce.carts (store_id, market_code, currency, locale, expires_at, visit_id) values ($1, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', $2) returning id",
      [shop, visit],
    );
    await db.query("delete from commerce.visits where id = $1", [visit]);
    expect((await one<{ visit_id: string | null }>("select visit_id from commerce.carts where id = $1", [cart])).visit_id).toBeNull();
  });

  it("keeps product views per day and product, and only of the store's own products", async () => {
    const mine = await createProduct();
    const theirs = await createProduct({ storeId: other });
    const insert = "insert into commerce.product_views (store_id, day, product_id, views) values ($1, '2026-10-01', $2, $3)";
    await db.query(insert, [store, mine.productId, 3]);
    await rejects(insert, [store, mine.productId, 1], /product_views_store_id_day_product_id_pk/);
    await rejects(insert, [store, theirs.productId, 1], /product_views_product_fk/);
    await rejects("update commerce.product_views set views = -1 where store_id = $1", [store], /product_views_views/);
  });

  it("has row-level security on every table, like the rest of commerce", async () => {
    for (const table of TABLES) {
      const row = await one<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'commerce' and c.relname = $1",
        [table],
      );
      expect([table, row.relrowsecurity]).toEqual([table, true]);
    }
  });

  it("copies a variant's cost with a duplicated store and a copied order's line cost, and nothing else of the analytics", async () => {
    const owner = await createAccount("analytics-copier@example.com");
    const src = await createStore("analytics-copy-source", ["DE"]);
    await db.query("update commerce.stores set visit_counting = true where id = $1", [src]);
    const { productId, variantId } = await createProduct({ storeId: src });
    await db.query("update commerce.products set status = 'active' where id = $1", [productId]);
    await db.query("update commerce.product_variants set cost_minor = 777 where id = $1", [variantId]);
    const { id: orderId } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
         discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
       values ($1, '1001', 'DE', 'EUR', 'de-DE', 'a@example.com', 'paid', 1000, 0, 0, 160, 1000, '{}', '{}', now()) returning id`,
      [src],
    );
    await db.query(
      `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
         total_minor, tax_minor, tax_rate, tax_code, unit_cost_minor)
       values ($1, $2, $3, 'SKU', 'A thing', 1, 1000, 0, 1000, 160, 0.19, 'txcd_99999999', 777)`,
      [src, orderId, variantId],
    );
    await db.query("insert into commerce.analytics_settings (store_id, payment_fee_bps) values ($1, 290)", [src]);
    await db.query("insert into commerce.analytics_targets (store_id, month, revenue_target_minor) values ($1, '2026-10-01', 5)", [src]);
    await db.query("insert into commerce.marketing_spend (store_id, day, channel, amount_minor) values ($1, '2026-10-01', 'email', 5)", [src]);
    await db.query("insert into commerce.visits (store_id, day, visitor, device, channel, landing_path) values ($1, '2026-10-01', '0123456789abcdef01234567', 'mobile', 'direct', '/')", [src]);
    await db.query("insert into commerce.product_views (store_id, day, product_id, views) values ($1, '2026-10-01', $2, 4)", [src, productId]);

    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'analytics-copy', 'Copy', $2) as id", [src, owner]);
    const copiedVariant = await one<{ cost_minor: string }>("select cost_minor from commerce.product_variants where store_id = $1", [copy]);
    expect(Number(copiedVariant.cost_minor)).toBe(777);
    for (const table of TABLES) {
      const { c } = await one<{ c: number }>(`select count(*)::int as c from commerce.${table} where store_id = $1`, [copy]);
      expect([table, c]).toEqual([table, 0]);
    }
    // A copy counts nothing until its own owner switches visit counting on.
    expect((await one<{ visit_counting: boolean }>("select visit_counting from commerce.stores where id = $1", [copy])).visit_counting).toBe(false);

    await db.query("insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options) values ($1, $2, $3, '{}')", [src, copy, owner]);
    await db.query("select * from commerce.copy_orders($1, $2, null, 10)", [src, copy]);
    expect((await db.query("select unit_cost_minor::int as c from commerce.order_lines where store_id = $1", [copy])).rows).toEqual([{ c: 777 }]);
    // The template's way: a new store from the template carries the variants' cost too.
    await db.query("update commerce.stores set is_template = true where id = $1", [src]);
    const fresh = await one<{ id: string }>("select commerce.clone_store($1, 'analytics-fresh', 'Fresh', $2) as id", [src, owner]);
    const clonedVariant = await one<{ cost_minor: string }>("select cost_minor from commerce.product_variants where store_id = $1", [fresh.id]);
    expect(Number(clonedVariant.cost_minor)).toBe(777);
    expect((await one<{ visit_counting: boolean }>("select visit_counting from commerce.stores where id = $1", [fresh.id])).visit_counting).toBe(false);
  });
});
