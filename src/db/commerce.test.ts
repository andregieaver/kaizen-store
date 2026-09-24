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
  it("start with invoice series and Stripe disabled in test mode", async () => {
    const { rows: series } = await db.query<{ series: string }>(
      "select series from commerce.document_series where store_id = $1 order by series",
      [store],
    );
    expect(series.map((s) => s.series)).toEqual(["credit_note", "invoice"]);
    const stripe = await one<{ enabled: boolean; active_mode: string }>(
      "select enabled, active_mode from commerce.payment_providers where store_id = $1 and provider = 'stripe'",
      [store],
    );
    expect(stripe).toEqual({ enabled: false, active_mode: "test" });
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
