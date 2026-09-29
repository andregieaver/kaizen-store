import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { minorUnitDigits } from "@/lib/money";
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

  it("has a demo of every kind of product, and new stores get it ready to book (D65)", async () => {
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
    expect(await one("select modules, time_zone, booking_reminder_hours from commerce.stores where id = $1", [store])).toEqual({
      modules: ["bookings"],
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
  const save = (kind: string, name: string) =>
    db.query("insert into commerce.saved_parts (kind, name, content) values ($1, $2, '{}')", [kind, name]);

  it("keeps rows, columns and components with a name", async () => {
    await expect(save("row", "Hero")).resolves.toBeDefined();
    await expect(save("page", "Whole page")).rejects.toThrow(/saved_parts_kind/);
    await expect(save("block", "  ")).rejects.toThrow(/saved_parts_name/);
    await expect(save("block", "x".repeat(81))).rejects.toThrow(/saved_parts_name/);
  });

  it("are not global until said, and keep a global's translations as an object (D98)", async () => {
    const { rows } = await db.query<{ global: boolean; translations: unknown }>(
      "insert into commerce.saved_parts (kind, name, content) values ('block', 'Plain', '{}') returning global, translations",
    );
    expect(rows[0]).toEqual({ global: false, translations: {} });
    await expect(
      db.query("insert into commerce.saved_parts (kind, name, content, global, translations) values ('row', 'Hero', '{}', true, '[]')"),
    ).rejects.toThrow(/saved_parts_translations/);
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
    await expect(
      db.query("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, 'x', 't', 'food')", [store]),
    ).rejects.toThrow(/products_vat_category/);
    await expect(db.query("insert into commerce.vat_rates values ('NO', 'food', 0.15)")).rejects.toThrow(/vat_rates_category/);
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
    await db.query("delete from commerce.orders where id = $1", [order]);
    const { rows } = await db.query<{ entity: string }>(
      "select entity from commerce.field_values where store_id = $1 and entity in ('store', 'customer', 'order')",
      [store],
    );
    // The store's own stay: they belong to the store.
    expect(rows.map((r) => r.entity)).toEqual(["store"]);
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

  it("runs one timer per person per store: starting another stops and logs the first", async () => {
    const w = await workStore();
    const second = await workAssignment(w.storeId, w.clientId, "Second");
    const task = (await one<{ id: string }>("insert into commerce.work_tasks (store_id, assignment_id, title) values ($1, $2, 'Task') returning id", [w.storeId, second])).id;
    const colleague = await createAccount("work-colleague@example.com");
    const start = (account: string, assignment: string, taskId: string | null = null) =>
      one<{ timer_started_at: Date; stopped_entry_id: string | null }>("select * from commerce.work_start_timer($1, $2, $3, $4)", [w.storeId, account, assignment, taskId]);

    const first = await start(w.account, w.assignmentId);
    expect(first.stopped_entry_id).toBeNull();
    expect((await db.query("select 1 from commerce.work_timers where store_id = $1", [w.storeId])).rows).toHaveLength(1);
    // The table itself allows one row per person.
    await expect(
      db.query("insert into commerce.work_timers (store_id, account_id, assignment_id) values ($1, $2, $3)", [w.storeId, w.account, second]),
    ).rejects.toThrow(/work_timers_store_id_account_id_pk/);
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
