import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MARKETS, MARKET_SLUGS } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";

import { createTestDatabase } from "./testing";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
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

let handleCounter = 0;

/** A draft product with one active variant, one picture and an English title. */
async function createProduct(
  options: { manufacturerCountry?: string } = {},
): Promise<{ productId: string; variantId: string; handle: string }> {
  handleCounter += 1;
  const handle = `test-product-${handleCounter}`;
  const { id: manufacturerId } = await one<{ id: string }>(
    `insert into commerce.economic_operators (name, postal_address, electronic_address, country)
     values ('Maker', 'Street 1, 10115 Berlin', 'safety@maker.example', $1) returning id`,
    [options.manufacturerCountry ?? "DE"],
  );
  const { id: productId } = await one<{ id: string }>(
    `insert into commerce.products (handle, manufacturer_id, tax_code)
     values ($1, $2, 'txcd_99999999') returning id`,
    [handle, manufacturerId],
  );
  await db.query(
    `insert into commerce.product_translations (product_id, locale, title) values ($1, 'en-IE', 'Test product')`,
    [productId],
  );
  await db.query(
    `insert into commerce.product_media (product_id, url) values ($1, 'https://example.com/a.jpg')`,
    [productId],
  );
  const { id: variantId } = await one<{ id: string }>(
    `insert into commerce.product_variants (product_id, sku) values ($1, $2) returning id`,
    [productId, `SKU-${handleCounter}`],
  );
  return { productId, variantId, handle };
}

describe("reference data", () => {
  it("has every EU member state and Norway, with the three launch markets active", async () => {
    const { rows } = await db.query<{ code: string; active: boolean; eu: boolean }>(
      `select code, active, commerce.is_eu_country(code) as eu
       from commerce.markets order by code`,
    );
    expect(rows).toHaveLength(28);
    expect(rows.filter((m) => m.eu)).toHaveLength(27);
    expect(rows.filter((m) => m.active).map((m) => m.code)).toEqual([
      "DK",
      "NO",
      "SE",
    ]);
    const norway = await one<{ currency: string; default_locale: string }>(
      "select currency, default_locale from commerce.markets where code = 'NO'",
    );
    expect(norway).toEqual({ currency: "NOK", default_locale: "nb-NO" });
  });

  it("routes exactly the active markets, with matching currencies", async () => {
    const { rows } = await db.query<{ code: string; currency: string; default_locale: string }>(
      "select code, currency, default_locale from commerce.markets where active order by code",
    );
    const routed = MARKET_SLUGS.map((slug) => ({
      code: MARKETS[slug].code,
      currency: MARKETS[slug].currency,
      default_locale: MARKETS[slug].locale,
    })).sort((a, b) => a.code.localeCompare(b.code));
    expect(rows).toEqual(routed);
  });

  it("uses only currencies the money helpers support", async () => {
    const { rows } = await db.query<{ currency: string }>(
      "select distinct currency from commerce.markets",
    );
    for (const { currency } of rows) {
      expect(() => minorUnitDigits(currency)).not.toThrow();
    }
  });

  it("rejects a price in the wrong currency for its market", async () => {
    const { variantId } = await createProduct();
    await expect(
      db.query(
        `insert into commerce.prices (variant_id, market_code, currency, amount_minor)
         values ($1, 'DE', 'SEK', 1000)`,
        [variantId],
      ),
    ).rejects.toThrow(/prices_market_currency_fk/);
  });
});

describe("price history", () => {
  it("keeps one current price and closes the previous one", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 1999, $2)", [
      variantId,
      daysAgo(10),
    ]);
    await db.query("select commerce.set_price($1, 'DE', 1799)", [variantId]);

    const { rows } = await db.query<{ amount_minor: number; open: boolean }>(
      `select amount_minor::int, valid_to is null as open from commerce.prices
       where variant_id = $1 order by valid_from`,
      [variantId],
    );
    expect(rows).toEqual([
      { amount_minor: 1999, open: false },
      { amount_minor: 1799, open: true },
    ]);
  });

  it("treats setting the same amount as a no-op", async () => {
    const { variantId } = await createProduct();
    const first = await one<{ id: number }>(
      "select commerce.set_price($1, 'DE', 500, $2) as id",
      [variantId, daysAgo(1)],
    );
    const again = await one<{ id: number }>(
      "select commerce.set_price($1, 'DE', 500) as id",
      [variantId],
    );
    expect(again.id).toBe(first.id);
  });

  it("refuses to backdate a price before the current one", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 500)", [variantId]);
    await expect(
      db.query("select commerce.set_price($1, 'DE', 400, $2)", [
        variantId,
        daysAgo(1),
      ]),
    ).rejects.toThrow(/must start after the current one/);
  });

  it("refuses a second open price inserted directly", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 500)", [variantId]);
    await expect(
      db.query(
        `insert into commerce.prices (variant_id, market_code, currency, amount_minor)
         values ($1, 'DE', 'EUR', 450)`,
        [variantId],
      ),
    ).rejects.toThrow(/prices_one_current_idx/);
  });

  it("cannot be rewritten or deleted", async () => {
    const { variantId } = await createProduct();
    await db.query("select commerce.set_price($1, 'DE', 500)", [variantId]);
    await expect(
      db.query(
        "update commerce.prices set amount_minor = 1 where variant_id = $1",
        [variantId],
      ),
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
  it("activates a product with a complete listing", async () => {
    const { productId } = await createProduct();
    await db.query(
      "update commerce.products set status = 'active' where id = $1",
      [productId],
    );
    const { status } = await one<{ status: string }>(
      "select status from commerce.products where id = $1",
      [productId],
    );
    expect(status).toBe("active");
  });

  it("refuses to activate a product without a manufacturer", async () => {
    const { productId } = await createProduct();
    await db.query(
      "update commerce.products set manufacturer_id = null where id = $1",
      [productId],
    );
    await expect(
      db.query("update commerce.products set status = 'active' where id = $1", [
        productId,
      ]),
    ).rejects.toThrow(/without a manufacturer/);
  });

  it("requires an EU responsible person for a non-EU manufacturer", async () => {
    const { productId } = await createProduct({ manufacturerCountry: "CN" });
    await expect(
      db.query("update commerce.products set status = 'active' where id = $1", [
        productId,
      ]),
    ).rejects.toThrow(/needs an EU responsible person/);

    const { id: responsibleId } = await one<{ id: string }>(
      `insert into commerce.economic_operators (name, postal_address, electronic_address, country)
       values ('EU Rep', 'Rue 2, 1000 Brussels', 'rep@example.eu', 'BE') returning id`,
    );
    await db.query(
      "update commerce.products set status = 'active', responsible_person_id = $2 where id = $1",
      [productId, responsibleId],
    );
  });

  it("refuses to activate a product without a picture", async () => {
    const { productId } = await createProduct();
    await db.query("delete from commerce.product_media where product_id = $1", [
      productId,
    ]);
    await expect(
      db.query("update commerce.products set status = 'active' where id = $1", [
        productId,
      ]),
    ).rejects.toThrow(/without a picture/);
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

  it("lists launch markets where an active product's scheme is not registered", async () => {
    const { productId, handle } = await createProduct();
    await db.query(
      "insert into commerce.product_schemes (product_id, scheme) values ($1, 'packaging')",
      [productId],
    );
    await db.query("update commerce.products set status = 'active' where id = $1", [
      productId,
    ]);

    const missing = async () =>
      (
        await db.query<{ market_code: string }>(
          `select market_code from commerce.missing_registrations
           where handle = $1 order by market_code`,
          [handle],
        )
      ).rows.map((r) => r.market_code);

    expect(await missing()).toEqual(["DK", "NO", "SE"]);

    await db.query(
      `insert into commerce.producer_registrations
         (market_code, scheme, registration_number, authority, valid_from, valid_to) values
         ('NO', 'packaging', 'NO-123456', 'Miljødirektoratet', current_date - 10, null),
         ('SE', 'packaging', 'SE-OLD-1', 'Naturvårdsverket', current_date - 400, current_date - 1)`,
    );
    // Norway is now covered; Sweden's registration has expired.
    expect(await missing()).toEqual(["DK", "SE"]);
  });
});

describe("stock", () => {
  it("subtracts only live reservations from on-hand stock", async () => {
    const { variantId } = await createProduct();
    const { id: locationId } = await one<{ id: string }>(
      "insert into commerce.inventory_locations (name, country) values ('Main', 'DE') returning id",
    );
    const { id: cartId } = await one<{ id: string }>(
      `insert into commerce.carts (market_code, currency, locale, expires_at)
       values ('DE', 'EUR', 'de-DE', now() + interval '1 day') returning id`,
    );
    await db.query(
      "insert into commerce.inventory_levels (variant_id, location_id, on_hand) values ($1, $2, 10)",
      [variantId, locationId],
    );
    await db.query(
      `insert into commerce.inventory_reservations (variant_id, location_id, quantity, cart_id, expires_at, released_at) values
         ($1, $2, 3, $3, now() + interval '15 minutes', null),
         ($1, $2, 2, $3, now() - interval '1 minute', null),
         ($1, $2, 1, $3, now() + interval '15 minutes', now())`,
      [variantId, locationId, cartId],
    );
    const stock = await one<{ available: number }>(
      "select available::int from commerce.available_stock where variant_id = $1",
      [variantId],
    );
    expect(stock.available).toBe(7);
  });
});

describe("orders", () => {
  it("rejects totals that do not add up", async () => {
    await expect(
      db.query(
        `insert into commerce.orders (number, market_code, currency, locale, email,
           subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
           billing_address, shipping_address)
         values ('K-BAD', 'DE', 'EUR', 'de-DE', 'a@example.com',
           1000, 490, 0, 160, 1000, '{}', '{}')`,
      ),
    ).rejects.toThrow(/orders_total_adds_up/);
  });

  it("keeps order events and invoices append-only", async () => {
    const { id: orderId } = await one<{ id: string }>(
      `insert into commerce.orders (number, market_code, currency, locale, email,
         subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
         billing_address, shipping_address)
       values ('K-1', 'DE', 'EUR', 'de-DE', 'a@example.com',
         1000, 490, 0, 238, 1490, '{}', '{}') returning id`,
    );
    await db.query(
      "insert into commerce.order_events (order_id, type, actor) values ($1, 'order.placed', 'system')",
      [orderId],
    );
    await expect(
      db.query("update commerce.order_events set type = 'x' where order_id = $1", [
        orderId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from commerce.order_events where order_id = $1", [orderId]),
    ).rejects.toThrow(/append-only/);

    await db.query(
      `insert into commerce.invoices (order_id, series, number, document_number, currency, total_minor, tax_minor)
       values ($1, 'invoice', 9001, 'INV-9001', 'EUR', 1490, 238)`,
      [orderId],
    );
    await expect(
      db.query("update commerce.invoices set total_minor = 1 where order_id = $1", [
        orderId,
      ]),
    ).rejects.toThrow(/append-only/);
  });
});

describe("document numbers", () => {
  it("issues consecutive numbers and reuses one from a rolled-back transaction", async () => {
    const next = async () =>
      (
        await one<{ n: number }>(
          "select commerce.next_document_number('credit_note')::int as n",
        )
      ).n;

    const first = await next();
    expect(await next()).toBe(first + 1);

    await db
      .transaction(async (tx) => {
        await tx.query("select commerce.next_document_number('credit_note')");
        throw new Error("abandon");
      })
      .catch(() => undefined);

    expect(await next()).toBe(first + 2);
  });

  it("refuses an unknown series", async () => {
    await expect(
      db.query("select commerce.next_document_number('nope')"),
    ).rejects.toThrow(/unknown document series/);
  });
});

describe("webhook events", () => {
  it("stores each provider event once", async () => {
    const insert = () =>
      db.query(
        `insert into commerce.webhook_events (provider, event_id, type, payload)
         values ('stripe', 'evt_1', 'checkout.session.completed', '{}')`,
      );
    await insert();
    await expect(insert()).rejects.toThrow(/webhook_events_provider_event_key/);
  });
});

describe("staff and settings", () => {
  it("always keeps at least one active owner", async () => {
    const { id: owner } = await one<{ id: string }>(
      "insert into commerce.staff (email, role) values ('owner@example.com', 'owner') returning id",
    );
    await expect(
      db.query("update commerce.staff set disabled_at = now() where id = $1", [owner]),
    ).rejects.toThrow(/at least one active owner/);
    await expect(
      db.query("update commerce.staff set role = 'admin' where id = $1", [owner]),
    ).rejects.toThrow(/at least one active owner/);
    await expect(db.query("delete from commerce.staff where id = $1", [owner])).rejects.toThrow(
      /at least one active owner/,
    );

    // With a second owner, the first can step down.
    await db.query(
      "insert into commerce.staff (email, role, invited_by) values ('second@example.com', 'owner', $1)",
      [owner],
    );
    await db.query("update commerce.staff set role = 'admin' where id = $1", [owner]);
  });

  it("treats staff emails case-insensitively", async () => {
    await db.query("insert into commerce.staff (email) values ('Case@Example.com')");
    await expect(
      db.query("insert into commerce.staff (email) values ('case@example.com')"),
    ).rejects.toThrow(/staff_email_idx/);
  });

  it("starts with Stripe disabled in test mode", async () => {
    const stripe = await one<{ enabled: boolean; active_mode: string }>(
      "select enabled, active_mode from commerce.payment_providers where provider = 'stripe'",
    );
    expect(stripe).toEqual({ enabled: false, active_mode: "test" });
  });

  it("keeps the settings audit log append-only", async () => {
    await db.query(
      "insert into commerce.settings_audit_log (action, details) values ('test.action', '{}')",
    );
    await expect(
      db.query("update commerce.settings_audit_log set action = 'x'"),
    ).rejects.toThrow(/append-only/);
    await expect(db.query("delete from commerce.settings_audit_log")).rejects.toThrow(
      /append-only/,
    );
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
