import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COPY_RULES } from "@/lib/store-copy-rules";

import { createTestDatabase } from "./testing";

/**
 * The unit price's rules in the database (D160, docs/wave-1d-unit-price.md section 3), against every migration applied to a real
 * Postgres (PGlite): the column checks on variants and order lines, `unit_price_required()`, the deferred check that refuses an
 * active required product without a measure and a measure on anything but physical goods, grandfathering, the frozen snapshot on a
 * sold line, tenant isolation, and the copy functions.
 */

let db: PGlite;
let shop: string;
let other: string;
let owner: string;
let counter = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const scalar = async <T>(sql: string, params: unknown[] = []) => Object.values((await rows(sql, params))[0] ?? {})[0] as T;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function createStore(slug: string): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = any($2)`,
    [id, ["NO", "DE"]],
  );
  return id;
}

type Made = { productId: string; variantId: string; sku: string };

/** A product with one active physical variant and everything publishing needs; draft until `status` says otherwise. */
async function product(store: string, over: { status?: "draft" | "active"; measure?: [string, string, string | null] | null; soldByMeasure?: boolean; kind?: string; delivery?: string } = {}): Promise<Made> {
  counter += 1;
  const { id: maker } = await one<{ id: string }>(
    "insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country) values ($1, 'Maker', 'Street 1, Berlin', 'a@maker.example', 'DE') returning id",
    [store],
  );
  const { id: productId } = await one<{ id: string }>(
    "insert into commerce.products (store_id, handle, manufacturer_id, tax_code, kind, delivery, sold_by_measure) values ($1, $2, $3, 'txcd_99999999', $4, $5, $6) returning id",
    [store, `up-${counter}`, maker, over.kind ?? "goods", over.delivery ?? "physical", over.soldByMeasure ?? false],
  );
  await db.query("insert into commerce.product_translations (store_id, product_id, locale, title) values ($1, $2, 'en-IE', 'Test')", [store, productId]);
  await db.query("insert into commerce.product_media (store_id, product_id, url) values ($1, $2, 'https://example.com/a.jpg')", [store, productId]);
  const sku = `UP-${counter}`;
  const delivery = over.delivery ?? (over.kind && over.kind !== "goods" ? "service" : "physical");
  const variantId = await addVariant(store, productId, sku, over.measure ?? null, delivery);
  if (over.status === "active") {
    await db.query("select commerce.set_price($1, 'NO', 4990, now() - interval '40 days')", [variantId]);
    await db.query("select commerce.set_price($1, 'DE', 499, now() - interval '40 days')", [variantId]);
    await db.query("update commerce.products set status = 'active' where id = $1", [productId]);
  }
  return { productId, variantId, sku };
}

async function addVariant(store: string, productId: string, sku: string, measure: [string, string, string | null] | null = null, delivery = "physical", active = true): Promise<string> {
  const { id } = await one<{ id: string }>(
    `insert into commerce.product_variants (store_id, product_id, sku, delivery, active, measure_amount, measure_unit, measure_base)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [store, productId, sku, delivery, active, measure?.[0] ?? null, measure?.[1] ?? null, measure?.[2] ?? null],
  );
  return id;
}

async function category(store: string, slug: string, over: { parent?: string; requires?: boolean; kind?: string; type?: string } = {}): Promise<string> {
  const { id } = await one<{ id: string }>(
    "insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id, requires_unit_price) values ($1, $2, $3, $4, $4, $5, $6) returning id",
    [store, over.type ?? "product", over.kind ?? "category", slug, over.parent ?? null, over.requires ?? false],
  );
  return id;
}
const assign = (store: string, productId: string, termId: string) =>
  db.query("insert into commerce.product_terms (store_id, product_id, term_id) values ($1, $2, $3)", [store, productId, termId]);

const required = (store: string, productId: string) => scalar<boolean>("select commerce.unit_price_required($1, $2)", [store, productId]);

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await createStore("up-shop");
  other = await createStore("up-other");
  owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ('up-owner@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

describe("the columns", () => {
  const goodCombinations: [string, string, string | null][] = [
    ["250", "g", null],
    ["250", "g", "kg"],
    ["250", "g", "100g"],
    ["0.5", "kg", "kg"],
    ["1.5", "kg", "100g"],
    ["330", "ml", "l"],
    ["330", "ml", "100ml"],
    ["33", "cl", "100ml"],
    ["0.75", "l", "l"],
    ["0.75", "l", "100ml"],
    ["150", "cm", "m"],
    ["3", "m", "m"],
    ["0.5", "m2", "m2"],
    ["6", "piece", "piece"],
    ["0.0001", "g", null],
    ["1000000", "kg", null],
    ["12345.6789", "g", null],
  ];

  it("accepts every unit with a base of its own family, and no base", async () => {
    for (const [amount, unit, base] of goodCombinations) {
      const made = await product(shop, { measure: [amount, unit, base] });
      const row = await one<{ measure_amount: string; measure_unit: string; measure_base: string | null }>("select measure_amount::text, measure_unit, measure_base from commerce.product_variants where id = $1", [made.variantId]);
      expect(row.measure_unit).toBe(unit);
      expect(row.measure_base).toBe(base);
    }
  });

  it("keeps up to four decimals as they are", async () => {
    const made = await product(shop, { measure: ["0.7500", "l", null] });
    expect(await scalar("select measure_amount::text from commerce.product_variants where id = $1", [made.variantId])).toBe("0.7500");
  });

  it("refuses an amount without a unit, a unit without an amount, and a base without an amount", async () => {
    const p = await product(shop);
    await rejects("update commerce.product_variants set measure_amount = 5 where id = $1", [p.variantId], /product_variants_measure_pair/);
    await rejects("update commerce.product_variants set measure_unit = 'g' where id = $1", [p.variantId], /product_variants_measure_pair/);
    await rejects("update commerce.product_variants set measure_base = 'kg' where id = $1", [p.variantId], /product_variants_measure_base/);
  });

  it("refuses an amount of 0 or less, above a million, or rounding to nothing", async () => {
    const p = await product(shop);
    for (const amount of ["0", "-1", "1000000.0001", "0.00004"]) {
      await rejects("update commerce.product_variants set measure_amount = $2, measure_unit = 'g' where id = $1", [p.variantId, amount], /product_variants_measure_amount/);
    }
  });

  it("refuses a unit that is not one of the nine", async () => {
    const p = await product(shop);
    for (const unit of ["t", "mg", "mm", "oz", "G", "kg ", "", "m3", "cm2"]) {
      await rejects("update commerce.product_variants set measure_amount = 5, measure_unit = $2 where id = $1", [p.variantId, unit], /product_variants_measure_unit/);
    }
  });

  it("refuses a base that cannot compare the unit", async () => {
    const p = await product(shop);
    const bad: [string, string][] = [["g", "l"], ["g", "100ml"], ["kg", "m"], ["ml", "kg"], ["cl", "100g"], ["l", "kg"], ["cm", "100g"], ["cm", "m2"], ["m", "kg"], ["m2", "m"], ["piece", "kg"], ["piece", "100g"], ["g", "tonne"], ["g", "1kg"]];
    for (const [unit, base] of bad) {
      await rejects("update commerce.product_variants set measure_amount = 5, measure_unit = $2, measure_base = $3 where id = $1", [p.variantId, unit, base], /product_variants_measure_base/);
    }
  });

  it("allows only goods to be sold by measure, and only product categories to need a unit price", async () => {
    await rejects("update commerce.products set sold_by_measure = true, kind = 'stay' where id = $1", [(await product(shop)).productId], /products_sold_by_measure_goods/);
    await expect(category(shop, "tag-needing", { kind: "tag", requires: true })).rejects.toThrow(/terms_requires_unit_price/);
    await expect(category(shop, "page-cat-needing", { type: "page", requires: true })).rejects.toThrow(/terms_requires_unit_price/);
    await expect(category(shop, "article-cat-needing", { type: "article", requires: true })).rejects.toThrow(/terms_requires_unit_price/);
    await expect(category(shop, "fine-category", { requires: true })).resolves.toBeDefined();
  });
});

describe("what a product needs: unit_price_required()", () => {
  it("is false for a plain product", async () => {
    expect(await required(shop, (await product(shop)).productId)).toBe(false);
  });

  it("is true for the product's own flag", async () => {
    expect(await required(shop, (await product(shop, { soldByMeasure: true })).productId)).toBe(true);
  });

  it("is true for a product in a marked category, and in a category under a marked ancestor", async () => {
    const root = await category(shop, "req-root", { requires: true });
    const child = await category(shop, "req-child", { parent: root });
    const grandchild = await category(shop, "req-grandchild", { parent: child });
    const direct = await product(shop);
    await assign(shop, direct.productId, root);
    expect(await required(shop, direct.productId)).toBe(true);
    const deep = await product(shop);
    await assign(shop, deep.productId, grandchild);
    expect(await required(shop, deep.productId)).toBe(true);
  });

  it("is false for a category above or beside a marked one, and for a marked tag-like unrelated category", async () => {
    const top = await category(shop, "nr-top");
    const marked = await category(shop, "nr-marked", { parent: top, requires: true });
    const sibling = await category(shop, "nr-sibling", { parent: top });
    expect(marked).toBeDefined();
    const above = await product(shop);
    await assign(shop, above.productId, top);
    expect(await required(shop, above.productId)).toBe(false);
    const beside = await product(shop);
    await assign(shop, beside.productId, sibling);
    expect(await required(shop, beside.productId)).toBe(false);
  });

  it("is not made true by a tag", async () => {
    const tag = await category(shop, "a-tag", { kind: "tag" });
    const p = await product(shop);
    await assign(shop, p.productId, tag);
    expect(await required(shop, p.productId)).toBe(false);
  });

  it("is not made true by another store's marked category, with any slug", async () => {
    await category(other, "req-root", { requires: true });
    const p = await product(shop);
    expect(await required(shop, p.productId)).toBe(false);
    // And asked in the other store's name about this store's product it knows nothing.
    const marked = await category(shop, "iso-marked", { requires: true });
    await assign(shop, p.productId, marked);
    expect(await required(shop, p.productId)).toBe(true);
    expect(await required(other, p.productId)).toBe(false);
    // An unknown product is simply not required.
    expect(await required(shop, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("never meets a parent loop: the database refuses to make one", async () => {
    const a = await category(shop, "loop-a");
    const b = await category(shop, "loop-b", { parent: a });
    await rejects("update commerce.terms set parent_id = $2 where id = $1", [a, b], /a category cannot be inside itself/);
  });
});

describe("the deferred check: an active required product needs a measure on every active physical variant", () => {
  it("lets a draft be incomplete, and refuses activating it", async () => {
    const p = await product(shop, { soldByMeasure: true });
    await db.query("select commerce.set_price($1, 'NO', 4990, now() - interval '40 days')", [p.variantId]);
    await db.query("select commerce.set_price($1, 'DE', 499, now() - interval '40 days')", [p.variantId]);
    await rejects("update commerce.products set status = 'active' where id = $1", [p.productId], /unit_price\.measure_required/);
    expect(await scalar("select status::text from commerce.products where id = $1", [p.productId])).toBe("draft");
  });

  it("names the variants that are missing it", async () => {
    const p = await product(shop, { soldByMeasure: true });
    await addVariant(shop, p.productId, `${p.sku}-B`);
    await db.query("select commerce.set_price(v.id, 'NO', 4990, now() - interval '40 days') from commerce.product_variants v where v.product_id = $1", [p.productId]);
    await db.query("select commerce.set_price(v.id, 'DE', 499, now() - interval '40 days') from commerce.product_variants v where v.product_id = $1", [p.productId]);
    await db.query("update commerce.product_variants set measure_amount = 250, measure_unit = 'g' where id = $1", [p.variantId]);
    try {
      await db.query("update commerce.products set status = 'active' where id = $1", [p.productId]);
      expect.unreachable("should have been refused");
    } catch (error) {
      expect((error as { message: string; detail?: string }).message).toMatch(/unit_price\.measure_required/);
      expect((error as { detail?: string }).detail).toBe(`${p.sku}-B`);
    }
  });

  it("accepts activating once every active physical variant has one", async () => {
    const p = await product(shop, { soldByMeasure: true, measure: ["250", "g", null], status: "active" });
    expect(await scalar("select status::text from commerce.products where id = $1", [p.productId])).toBe("active");
  });

  it("checks at commit, so the measure and the activation can come in one transaction", async () => {
    const p = await product(shop, { soldByMeasure: true });
    await db.query("select commerce.set_price($1, 'NO', 4990, now() - interval '40 days')", [p.variantId]);
    await db.query("select commerce.set_price($1, 'DE', 499, now() - interval '40 days')", [p.variantId]);
    await db.transaction(async (tx) => {
      await tx.query("update commerce.products set status = 'active' where id = $1", [p.productId]);
      await tx.query("update commerce.product_variants set measure_amount = 330, measure_unit = 'ml' where id = $1", [p.variantId]);
    });
    expect(await scalar("select status::text from commerce.products where id = $1", [p.productId])).toBe("active");
    // And the other way round: a transaction that ends without it is refused as a whole.
    const q = await product(shop, { soldByMeasure: true });
    await db.query("select commerce.set_price($1, 'NO', 4990, now() - interval '40 days')", [q.variantId]);
    await db.query("select commerce.set_price($1, 'DE', 499, now() - interval '40 days')", [q.variantId]);
    await expect(
      db.transaction(async (tx) => {
        await tx.query("update commerce.products set status = 'active' where id = $1", [q.productId]);
      }),
    ).rejects.toThrow(/unit_price\.measure_required/);
    expect(await scalar("select status::text from commerce.products where id = $1", [q.productId])).toBe("draft");
  });

  it("refuses taking the measure away from an active required product, and adding a variant without one", async () => {
    const p = await product(shop, { soldByMeasure: true, measure: ["250", "g", null], status: "active" });
    await rejects("update commerce.product_variants set measure_amount = null, measure_unit = null where id = $1", [p.variantId], /unit_price\.measure_required/);
    await rejects("insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, 'NEW-NO-MEASURE')", [shop, p.productId], /unit_price\.measure_required/);
    // A new variant with a measure is fine, and an inactive one needs none.
    await addVariant(shop, p.productId, "NEW-WITH", ["500", "g", null]);
    await addVariant(shop, p.productId, "NEW-OFF", null, "physical", false);
  });

  it("does not need a measure on an inactive variant or a digital one, nor on a draft or archived product", async () => {
    const p = await product(shop, { soldByMeasure: true, measure: ["250", "g", null], status: "active" });
    const off = await addVariant(shop, p.productId, "OFF", null, "physical", false);
    // Switching the inactive one on needs the measure.
    await rejects("update commerce.product_variants set active = true where id = $1", [off], /unit_price\.measure_required/);
    await db.query("update commerce.products set status = 'archived' where id = $1", [p.productId]);
    await db.query("update commerce.product_variants set active = true where id = $1", [off]);
  });

  it("refuses putting an active product in a marked category, and activating one that is in one", async () => {
    const marked = await category(shop, "put-in-marked", { requires: true });
    const active = await product(shop, { status: "active" });
    await rejects("insert into commerce.product_terms (store_id, product_id, term_id) values ($1, $2, $3)", [shop, active.productId, marked], /unit_price\.measure_required/);
    const draft = await product(shop);
    await assign(shop, draft.productId, marked);
    await db.query("select commerce.set_price($1, 'NO', 4990, now() - interval '40 days')", [draft.variantId]);
    await db.query("select commerce.set_price($1, 'DE', 499, now() - interval '40 days')", [draft.variantId]);
    await rejects("update commerce.products set status = 'active' where id = $1", [draft.productId], /unit_price\.measure_required/);
    // Under a marked ancestor too.
    const sub = await category(shop, "put-in-sub", { parent: marked });
    const second = await product(shop);
    await assign(shop, second.productId, sub);
    await db.query("select commerce.set_price($1, 'NO', 4990, now() - interval '40 days')", [second.variantId]);
    await db.query("select commerce.set_price($1, 'DE', 499, now() - interval '40 days')", [second.variantId]);
    await rejects("update commerce.products set status = 'active' where id = $1", [second.productId], /unit_price\.measure_required/);
    await db.query("update commerce.product_variants set measure_amount = 1, measure_unit = 'kg' where id = $1", [second.variantId]);
    await db.query("update commerce.products set status = 'active' where id = $1", [second.productId]);
  });

  it("does not check a product nothing requires", async () => {
    const p = await product(shop, { status: "active" });
    expect(await required(shop, p.productId)).toBe(false);
    await addVariant(shop, p.productId, "FREE-1");
  });
});

describe("grandfathering: marking a category afterwards leaves active products alone", () => {
  it("keeps an active product on sale, reports it as required, and refuses its next save of status or measure", async () => {
    const p = await product(shop, { status: "active" });
    const food = await category(shop, "grand-food");
    await assign(shop, p.productId, food);
    // The owner marks the category: nothing refuses, nothing changes.
    await db.query("update commerce.terms set requires_unit_price = true where id = $1", [food]);
    expect(await scalar("select status::text from commerce.products where id = $1", [p.productId])).toBe("active");
    expect(await required(shop, p.productId)).toBe(true);
    // It is found by the report's own query.
    const gaps = await rows<{ id: string }>(
      `select p.id from commerce.products p
        where p.store_id = $1 and p.status = 'active' and p.kind = 'goods' and commerce.unit_price_required(p.store_id, p.id)
          and exists (select 1 from commerce.product_variants v where v.product_id = p.id and v.active and v.delivery = 'physical' and v.measure_amount is null)`,
      [shop],
    );
    expect(gaps.map((g) => g.id)).toContain(p.productId);
    // Its next save of the status is refused until it has a measure.
    await rejects("update commerce.products set status = 'active' where id = $1", [p.productId], /unit_price\.measure_required/);
    await db.query("update commerce.product_variants set measure_amount = 250, measure_unit = 'g' where id = $1", [p.variantId]);
    await db.query("update commerce.products set status = 'active' where id = $1", [p.productId]);
    // Unmarking changes nothing for products that already have measures.
    await db.query("update commerce.terms set requires_unit_price = false where id = $1", [food]);
    expect(await scalar("select measure_amount::text from commerce.product_variants where id = $1", [p.variantId])).toBe("250.0000");
  });

  it("lets a grandfathered product be edited in other ways", async () => {
    const p = await product(shop, { status: "active" });
    const cat = await category(shop, "grand-edit");
    await assign(shop, p.productId, cat);
    await db.query("update commerce.terms set requires_unit_price = true where id = $1", [cat]);
    await db.query("update commerce.products set withdrawal_exclusion = 'perishable' where id = $1", [p.productId]);
    await db.query("update commerce.product_variants set weight_grams = 300 where id = $1", [p.variantId]);
  });
});

describe("a measure is for physical goods only", () => {
  it("refuses a measure on a digital variant", async () => {
    const p = await product(shop);
    await db.query("update commerce.product_variants set delivery = 'digital' where id = $1", [p.variantId]);
    await rejects("update commerce.product_variants set measure_amount = 5, measure_unit = 'g' where id = $1", [p.variantId], /unit_price\.not_applicable/);
    await rejects("insert into commerce.product_variants (store_id, product_id, sku, delivery, measure_amount, measure_unit) values ($1, $2, 'DIG-M', 'digital', 5, 'g')", [shop, p.productId], /unit_price\.not_applicable/);
  });

  it("refuses turning a measured variant into a download", async () => {
    const p = await product(shop, { measure: ["250", "g", null] });
    await rejects("update commerce.product_variants set delivery = 'digital' where id = $1", [p.variantId], /unit_price\.not_applicable/);
  });

  it("refuses a measure on the variants of an appointment, a stay and a rental", async () => {
    for (const kind of ["appointment", "stay", "rental"]) {
      const p = await product(shop, { kind });
      await rejects("update commerce.product_variants set measure_amount = 5, measure_unit = 'g' where id = $1", [p.variantId], /unit_price\.not_applicable/);
    }
  });

  it("refuses changing a measured product into a booking", async () => {
    const p = await product(shop, { measure: ["250", "g", null] });
    await rejects("update commerce.products set kind = 'stay' where id = $1", [p.productId], /unit_price\.not_applicable/);
  });

  it("applies to inactive variants and drafts too", async () => {
    const p = await product(shop, { kind: "stay", status: "draft" });
    await rejects("insert into commerce.product_variants (store_id, product_id, sku, delivery, active, measure_amount, measure_unit) values ($1, $2, 'OFF-M', 'service', false, 5, 'g')", [shop, p.productId], /unit_price\.not_applicable/);
  });
});

describe("the snapshot on a sold line", () => {
  let order: string;
  let line: string;

  beforeAll(async () => {
    order = (
      await one<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
         values ($1, 'UP-1001', 'NO', 'NOK', 'nb-NO', 'a@example.com', 4990, 0, 0, 998, 4990, '{}', '{}') returning id`,
        [shop],
      )
    ).id;
    line = await insertLine(order, ["250", "g", "kg"]);
  });

  const insertLine = async (orderId: string, measure: [string | null, string | null, string | null] | null, sku = `LINE-${counter++}`) =>
    (
      await one<{ id: string }>(
        `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, measure_amount, measure_unit, measure_base)
         values ($1, $2, $3, 'Kaffe 250 g', 1, 4990, 0, 4990, 998, 0.25, 'txcd_99999999', $4, $5, $6) returning id`,
        [shop, orderId, sku, measure?.[0] ?? null, measure?.[1] ?? null, measure?.[2] ?? null],
      )
    ).id;

  it("takes a snapshot with the effective base, or none", async () => {
    expect(await one("select measure_amount::text, measure_unit, measure_base from commerce.order_lines where id = $1", [line])).toEqual({ measure_amount: "250.0000", measure_unit: "g", measure_base: "kg" });
    await expect(insertLine(order, null)).resolves.toBeDefined();
    await expect(insertLine(order, ["500", "g", "100g"])).resolves.toBeDefined();
  });

  it("holds the same checks as the variant, and needs the base whenever there is an amount", async () => {
    await expect(insertLine(order, ["250", "g", null])).rejects.toThrow(/order_lines_measure_base/);
    await expect(insertLine(order, [null, null, "kg"])).rejects.toThrow(/order_lines_measure_base/);
    await expect(insertLine(order, ["0", "g", "kg"])).rejects.toThrow(/order_lines_measure_amount/);
    await expect(insertLine(order, ["5", "g", "l"])).rejects.toThrow(/order_lines_measure_base/);
    await expect(insertLine(order, ["5", "tonne", "kg"])).rejects.toThrow(/order_lines_measure_(unit|base)/);
    await expect(insertLine(order, ["5", null, "kg"])).rejects.toThrow(/order_lines_measure_pair/);
    await expect(insertLine(order, ["1000001", "g", "kg"])).rejects.toThrow(/order_lines_measure_amount/);
  });

  it("never changes after the line is inserted, by anyone", async () => {
    await rejects("update commerce.order_lines set measure_amount = 500 where id = $1", [line], /unit_price\.frozen/);
    await rejects("update commerce.order_lines set measure_unit = 'kg', measure_amount = 0.25 where id = $1", [line], /unit_price\.frozen/);
    await rejects("update commerce.order_lines set measure_base = '100g' where id = $1", [line], /unit_price\.frozen/);
    await rejects("update commerce.order_lines set measure_amount = null, measure_unit = null, measure_base = null where id = $1", [line], /unit_price\.frozen/);
    // A line that had none cannot be given one either.
    const bare = await insertLine(order, null);
    await rejects("update commerce.order_lines set measure_amount = 5, measure_unit = 'g', measure_base = 'kg' where id = $1", [bare], /unit_price\.frozen/);
  });

  it("allows other columns to change and the snapshot to be set to its present values", async () => {
    await db.query("update commerce.order_lines set title = 'Kaffe, 250 g' where id = $1", [line]);
    await db.query("update commerce.order_lines set measure_amount = 250, measure_unit = 'g', measure_base = 'kg', title = 'Kaffe 250 g' where id = $1", [line]);
    expect(await scalar("select measure_base from commerce.order_lines where id = $1", [line])).toBe("kg");
  });

  it("is not changed by the variant being edited afterwards", async () => {
    const p = await product(shop, { measure: ["250", "g", null] });
    const o = (
      await one<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
         values ($1, 'UP-1002', 'NO', 'NOK', 'nb-NO', 'a@example.com', 4990, 0, 0, 998, 4990, '{}', '{}') returning id`,
        [shop],
      )
    ).id;
    const l = await insertLine(o, ["250", "g", "kg"]);
    await db.query("update commerce.product_variants set measure_amount = 500 where id = $1", [p.variantId]);
    expect(await scalar("select measure_amount::text from commerce.order_lines where id = $1", [l])).toBe("250.0000");
  });
});

describe("copying", () => {
  it("adds no table, so COPY_RULES has nothing new for it", () => {
    expect(Object.keys(COPY_RULES).filter((t) => /unit|measure/.test(t))).toEqual([]);
  });

  it("keeps the measure, the flag and the marked categories in a copy of a store, and a grandfathered product stays so", async () => {
    const src = await createStore("up-dup-src");
    const marked = await category(src, "dup-marked", { requires: true });
    const child = await category(src, "dup-child", { parent: marked });
    const measured = await product(src, { measure: ["0.33", "l", "100ml"], soldByMeasure: true, status: "active" });
    await assign(src, measured.productId, child);
    // Grandfathered: active, then its category is marked afterwards.
    const late = await category(src, "dup-late");
    const grandfathered = await product(src, { status: "active" });
    await assign(src, grandfathered.productId, late);
    await db.query("update commerce.terms set requires_unit_price = true where id = $1", [late]);
    const plain = await product(src, { status: "active", measure: ["6", "piece", null] });
    // The copied variants and products take the source's ids by `clone_id`.
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'up-dup-copy', 'Copy', $2) as id", [src, owner]);
    const cloneId = (id: string) => scalar<string>("select commerce.clone_id($1, $2)", [copy, id]);
    expect(
      await one("select measure_amount::text, measure_unit, measure_base from commerce.product_variants where id = $1", [await cloneId(measured.variantId)]),
    ).toEqual({ measure_amount: "0.3300", measure_unit: "l", measure_base: "100ml" });
    expect(await scalar("select sold_by_measure from commerce.products where id = $1", [await cloneId(measured.productId)])).toBe(true);
    expect(await scalar("select sold_by_measure from commerce.products where id = $1", [await cloneId(plain.productId)])).toBe(false);
    expect(await scalar("select requires_unit_price from commerce.terms where id = $1", [await cloneId(marked)])).toBe(true);
    expect(await scalar("select requires_unit_price from commerce.terms where id = $1", [await cloneId(child)])).toBe(false);
    expect(await scalar("select measure_unit from commerce.product_variants where id = $1", [await cloneId(plain.variantId)])).toBe("piece");
    // The grandfathered one came as it was: active, required, no measure; and it is still refused its next save.
    const g = await cloneId(grandfathered.productId);
    expect(await scalar("select status::text from commerce.products where id = $1", [g])).toBe("active");
    expect(await required(copy, g)).toBe(true);
    await rejects("update commerce.products set status = 'active' where id = $1", [g], /unit_price\.measure_required/);
    // The copy's rules still hold: a switch-off that spans the copy's transaction does not leak out of it.
    expect(await scalar("select current_setting('commerce.unit_price_copying', true)")).not.toBe("on");
  });

  it("copies an order's lines with their snapshot, and nothing else of it changes", async () => {
    const src = await createStore("up-ord-src");
    const o = (
      await one<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
         values ($1, 'UP-2001', 'NO', 'NOK', 'nb-NO', 'a@example.com', 4990, 0, 0, 998, 4990, '{}', '{}') returning id`,
        [src],
      )
    ).id;
    for (const [sku, measure] of [["A", ["250", "g", "kg"]], ["B", [null, null, null]]] as const) {
      await db.query(
        `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, measure_amount, measure_unit, measure_base)
         values ($1, $2, $3, $3, 1, 4990, 0, 4990, 998, 0.25, 'txcd_99999999', $4, $5, $6)`,
        [src, o, sku, measure[0], measure[1], measure[2]],
      );
    }
    await db.query("update commerce.orders set status = 'paid' where id = $1", [o]);
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'up-ord-copy', 'Copy', $2) as id", [src, owner]);
    await db.query("insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options) values ($1, $2, $3, '{}')", [src, copy, owner]);
    const [batch] = await rows<{ handled: number; copied: number }>("select * from commerce.copy_orders($1, $2, null, 10)", [src, copy]);
    expect(batch.copied).toBe(1);
    const copied = await rows("select sku, measure_amount::text, measure_unit, measure_base from commerce.order_lines where store_id = $1 order by sku", [copy]);
    expect(copied).toEqual([
      { sku: "A", measure_amount: "250.0000", measure_unit: "g", measure_base: "kg" },
      { sku: "B", measure_amount: null, measure_unit: null, measure_base: null },
    ]);
    // A copy is as frozen as the original (the copied-order rule comes first).
    await rejects("update commerce.order_lines set measure_amount = 1 where store_id = $1 and sku = 'A'", [copy], /lines of a copied order cannot be changed|unit_price\.frozen/);
  });

  it("makes a new store from the template with its measures and marks", async () => {
    const template = await createStore("up-template");
    const marked = await category(template, "tpl-marked", { requires: true });
    const p = await product(template, { measure: ["500", "g", "100g"], soldByMeasure: true, status: "active" });
    await assign(template, p.productId, marked);
    const { id: copy } = await one<{ id: string }>("select commerce.clone_store($1, 'up-tpl-copy', 'Copy', $2) as id", [template, owner]);
    const cloneId = (id: string) => scalar<string>("select commerce.clone_id($1, $2)", [copy, id]);
    expect(await one("select measure_amount::text, measure_unit, measure_base from commerce.product_variants where id = $1", [await cloneId(p.variantId)])).toEqual({
      measure_amount: "500.0000",
      measure_unit: "g",
      measure_base: "100g",
    });
    expect(await scalar("select sold_by_measure from commerce.products where id = $1", [await cloneId(p.productId)])).toBe(true);
    expect(await scalar("select requires_unit_price from commerce.terms where id = $1", [await cloneId(marked)])).toBe(true);
    expect(await scalar("select status::text from commerce.products where id = $1", [await cloneId(p.productId)])).toBe("active");
  });
});

describe("the plan comparison", () => {
  it("lists the feature once, in no plan yet", async () => {
    const found = await rows<{ category: string }>("select category from commerce.plan_features where name = 'Unit price (price per kg, litre, metre)'");
    expect(found).toHaveLength(1);
    expect(found[0].category).toBe("Checkout and selling");
    expect(
      await scalar<number>("select count(*)::int from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = 'Unit price (price per kg, litre, metre)'"),
    ).toBe(0);
  });
});
