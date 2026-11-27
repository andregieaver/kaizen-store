import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COPY_RULES } from "@/lib/store-copy-rules";

import { createTestDatabase } from "./testing";

/**
 * A purchase option for one variant (D911), against every migration applied to a real Postgres (PGlite): the option's variant is
 * always one of its own product's (`selling_plans_variant_of_product()`), a product still goes with its variants and options, and
 * both store copies (`clone_store()`, `duplicate_store()`, each wrapped by the migration) keep each option on the copy of its variant.
 */

let db: PGlite;
let owner: string;
let counter = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const scalar = async <T>(sql: string, params: unknown[] = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0] as T;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function createStore(slug: string): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [id],
  );
  return id;
}

/** A draft digital product sold as a subscription: one variant per billing period, as Kaizena Life's Plus is. */
async function plan(store: string): Promise<{ productId: string; monthly: string; yearly: string }> {
  counter += 1;
  const { id: productId } = await one<{ id: string }>(
    "insert into commerce.products (store_id, handle, tax_code, kind, delivery, subscription_only) values ($1, $2, 'txcd_10000000', 'goods', 'digital', true) returning id",
    [store, `pov-${counter}`],
  );
  const variant = async (period: string) =>
    (
      await one<{ id: string }>(
        "insert into commerce.product_variants (store_id, product_id, sku, delivery, options) values ($1, $2, $3, 'digital', $4) returning id",
        [store, productId, `POV-${counter}-${period}`, JSON.stringify({ Billing: period })],
      )
    ).id;
  return { productId, monthly: await variant("Monthly"), yearly: await variant("Yearly") };
}

const option = (store: string, productId: string, variantId: string | null, interval: "month" | "year") =>
  one<{ id: string }>(
    "insert into commerce.selling_plans (store_id, product_id, variant_id, interval) values ($1, $2, $3, $4) returning id",
    [store, productId, variantId, interval],
  ).then((r) => r.id);

beforeAll(async () => {
  db = await createTestDatabase();
  owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ('pov-owner@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

describe("an option's variant", () => {
  it("is one of its own product's variants, or none for every variant", async () => {
    const store = await createStore("pov-own");
    const plus = await plan(store);
    const monthly = await option(store, plus.productId, plus.monthly, "month");
    const yearly = await option(store, plus.productId, plus.yearly, "year");
    const everyone = await option(store, plus.productId, null, "month");
    const kept = await db.query<{ id: string; variant_id: string | null }>(
      "select id, variant_id from commerce.selling_plans where store_id = $1 order by interval, variant_id nulls last",
      [store],
    );
    expect(kept.rows).toEqual(
      expect.arrayContaining([
        { id: monthly, variant_id: plus.monthly },
        { id: yearly, variant_id: plus.yearly },
        { id: everyone, variant_id: null },
      ]),
    );
  });

  it("is never another product's variant, nor another store's", async () => {
    const store = await createStore("pov-other");
    const plus = await plan(store);
    const analyzer = await plan(store);
    await rejects(
      "insert into commerce.selling_plans (store_id, product_id, variant_id, interval) values ($1, $2, $3, 'month')",
      [store, plus.productId, analyzer.monthly],
      /selling_plans\.variant_of_product/,
    );
    const elsewhere = await createStore("pov-elsewhere");
    const theirs = await plan(elsewhere);
    await rejects(
      "insert into commerce.selling_plans (store_id, product_id, variant_id, interval) values ($1, $2, $3, 'month')",
      [store, plus.productId, theirs.monthly],
      /selling_plans\.variant_of_product|selling_plans_variant_fk/,
    );
    // Nor does moving it later get round the rule.
    const kept = await option(store, plus.productId, plus.monthly, "month");
    await rejects("update commerce.selling_plans set variant_id = $1 where id = $2", [analyzer.yearly, kept], /selling_plans\.variant_of_product/);
    await rejects("update commerce.selling_plans set product_id = $1 where id = $2", [analyzer.productId, kept], /selling_plans\.variant_of_product/);
  });

  it("goes with its product: deleting a product takes its variants and options together", async () => {
    const store = await createStore("pov-delete");
    const plus = await plan(store);
    await option(store, plus.productId, plus.monthly, "month");
    await option(store, plus.productId, plus.yearly, "year");
    await db.query("delete from commerce.products where id = $1", [plus.productId]);
    expect(await scalar<number>("select count(*)::int from commerce.selling_plans where store_id = $1", [store])).toBe(0);
  });
});

describe("copying a store", () => {
  it("adds no table, so COPY_RULES has nothing new for it", () => {
    expect(COPY_RULES.selling_plans.group).toBe("catalogue");
  });

  it("keeps each option on the copy of its variant in a store's copy (duplicate_store)", async () => {
    const src = await createStore("pov-dup-src");
    const plus = await plan(src);
    const monthly = await option(src, plus.productId, plus.monthly, "month");
    const yearly = await option(src, plus.productId, plus.yearly, "year");
    const everyone = await option(src, plus.productId, null, "month");
    const copy = await scalar<string>("select commerce.duplicate_store($1, 'pov-dup-copy', 'Copy', $2)", [src, owner]);
    const cloneId = (id: string) => scalar<string>("select commerce.clone_id($1, $2)", [copy, id]);
    const variantOf = (id: string) => scalar<string | null>("select variant_id from commerce.selling_plans where id = $1", [id]);
    expect(await variantOf(await cloneId(monthly))).toBe(await cloneId(plus.monthly));
    expect(await variantOf(await cloneId(yearly))).toBe(await cloneId(plus.yearly));
    expect(await variantOf(await cloneId(everyone))).toBeNull();
    // The original is untouched.
    expect(await variantOf(monthly)).toBe(plus.monthly);
  });

  it("copies nothing of a product left out of the copy", async () => {
    const src = await createStore("pov-pick-src");
    const plus = await plan(src);
    const kept = await plan(src);
    await option(src, plus.productId, plus.monthly, "month");
    const keptOption = await option(src, kept.productId, kept.yearly, "year");
    const copy = await scalar<string>("select commerce.duplicate_store($1, 'pov-pick-copy', 'Copy', $2, null, $3::uuid[], null)", [
      src,
      owner,
      [kept.productId],
    ]);
    expect(await scalar<number>("select count(*)::int from commerce.selling_plans where store_id = $1", [copy])).toBe(1);
    const cloneId = (id: string) => scalar<string>("select commerce.clone_id($1, $2)", [copy, id]);
    expect(await scalar("select variant_id from commerce.selling_plans where id = $1", [await cloneId(keptOption)])).toBe(await cloneId(kept.yearly));
  });

  it("keeps each option on the copy of its variant in a store made from a template (clone_store)", async () => {
    const template = await createStore("pov-template");
    const plus = await plan(template);
    const yearly = await option(template, plus.productId, plus.yearly, "year");
    const copy = await scalar<string>("select commerce.clone_store($1, 'pov-tpl-copy', 'New', $2)", [template, owner]);
    const cloneId = (id: string) => scalar<string>("select commerce.clone_id($1, $2)", [copy, id]);
    expect(await scalar("select variant_id from commerce.selling_plans where id = $1", [await cloneId(yearly)])).toBe(await cloneId(plus.yearly));
  });
});
