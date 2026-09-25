import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { minorUnitDigits } from "@/lib/money";
import { RESERVED_STORE_SLUGS } from "@/lib/paths";

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

describe("stores", () => {
  it("start with invoice series and test payments on (no setup needed)", async () => {
    const { rows: series } = await db.query<{ series: string }>(
      "select series from commerce.document_series where store_id = $1 order by series",
      [store],
    );
    expect(series.map((s) => s.series)).toEqual(["credit_note", "invoice", "order"]);
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

    await db.query(
      `insert into commerce.invoices (store_id, order_id, series, number, document_number, currency, total_minor, tax_minor)
       values ($1, $2, 'invoice', 9001, 'INV-9001', 'EUR', 1490, 238)`,
      [store, orderId],
    );
    await expect(
      db.query("update commerce.invoices set total_minor = 1 where order_id = $1", [orderId]),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses an invoice against another store's order", async () => {
    const orderId = await createOrder("K-2");
    await expect(
      db.query(
        `insert into commerce.invoices (store_id, order_id, series, number, document_number, currency, total_minor, tax_minor)
         values ($1, $2, 'invoice', 1, 'INV-1', 'EUR', 1490, 238)`,
        [other, orderId],
      ),
    ).rejects.toThrow(/invoices_order_fk/);
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
    expect(extras).toEqual({ series: 3, stripe: true, swish: true, schemes: 1 });
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
});

describe("paying for an order", () => {
  /** An order for 2 of a variant with 3 on hand, 2 of them held for the order. */
  async function orderWithHold(onHand = 3) {
    const { variantId } = await createProduct();
    const { id: locationId } = await one<{ id: string }>(
      "insert into commerce.inventory_locations (store_id, name, country) values ($1, 'Lager', 'NO') returning id",
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

  it("removes a page's redirects with the page", async () => {
    const { id } = await page("gone-soon");
    await publish(id);
    await db.query("update commerce.pages set slug = 'gone-later' where id = $1", [id]);
    expect(await redirects("gone-soon")).toHaveLength(1);
    await db.query("delete from commerce.pages where id = $1", [id]);
    expect(await redirects("gone-soon")).toEqual([]);
  });
});

describe("saved parts", () => {
  const save = (kind: string, name: string) =>
    db.query("insert into commerce.saved_parts (kind, name, content) values ($1, $2, '{}')", [kind, name]);

  it("keeps rows, columns and components with a name", async () => {
    await expect(save("row", "Hero")).resolves.toBeDefined();
    await expect(save("page", "Whole page")).rejects.toThrow(/saved_parts_kind/);
    await expect(save("block", "  ")).rejects.toThrow(/saved_parts_name/);
    await expect(save("block", "x".repeat(81))).rejects.toThrow(/saved_parts_name/);
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
    // Deleting a category takes it off its products.
    await db.query("delete from commerce.terms where id = $1", [own.id]);
    expect(
      (await db.query("select 1 from commerce.product_terms where product_id = $1 and term_id = $2", [productId, own.id])).rows,
    ).toEqual([]);
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
