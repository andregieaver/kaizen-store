import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * A plan (D912), against every migration applied to a real Postgres (PGlite): the kind's check takes it, and `check_plan_product()` holds
 * what a plan is, at the end of the transaction: sold only by subscription, by the store itself, each variant a service (access: no
 * shipping, no file, no stock) with no measure.
 */

let db: PGlite;
let store: string;
let counter = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

/** A product of the kind, with one variant delivered so, made in one transaction (the rules run at its end). */
async function product(kind: string, delivery: string, subscriptionOnly: boolean): Promise<string> {
  counter += 1;
  const handle = `plan-rule-${counter}`;
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      "insert into commerce.products (store_id, handle, tax_code, kind, delivery, subscription_only) values ($1, $2, 'txcd_10000000', $3, $4, $5) returning id",
      [store, handle, kind, delivery, subscriptionOnly],
    );
    await tx.query("insert into commerce.product_variants (store_id, product_id, sku, delivery) values ($1, $2, $3, $4)", [
      store,
      rows[0].id,
      `PLAN-RULE-${counter}`,
      delivery,
    ]);
  });
  return (await one<{ id: string }>("select id from commerce.products where store_id = $1 and handle = $2", [store, handle])).id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  store = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('plan-rules', 'Plan rules', 'NO') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

describe("a plan (D912)", () => {
  it("is a kind a product can be, sold only by subscription and delivered as a service", async () => {
    const id = await product("plan", "service", true);
    expect((await one<{ kind: string }>("select kind from commerce.products where id = $1", [id])).kind).toBe("plan");
    await rejects("update commerce.products set kind = 'membership' where id = $1", [id], /products_kind/);
  });

  it("is never sold once", async () => {
    await expect(product("plan", "service", false)).rejects.toThrow(/plan\.product/);
    const id = await product("plan", "service", true);
    await rejects("update commerce.products set subscription_only = false where id = $1", [id], /plan\.product/);
  });

  it("is access: a variant that ships or downloads, or has a measure, is refused", async () => {
    await expect(product("plan", "digital", true)).rejects.toThrow(/plan\.variants/);
    await expect(product("plan", "physical", true)).rejects.toThrow(/plan\.variants/);
    const id = await product("plan", "service", true);
    await rejects("update commerce.product_variants set delivery = 'digital' where product_id = $1", [id], /plan\.variants/);
    await rejects("update commerce.product_variants set measure_amount = 250, measure_unit = 'g' where product_id = $1", [id], /plan\.variants/);
  });

  it("can be made from goods in one save, the product and its variants in either order", async () => {
    const id = await product("goods", "digital", false);
    await db.transaction(async (tx) => {
      await tx.query("update commerce.products set kind = 'plan', subscription_only = true where id = $1", [id]);
      await tx.query("update commerce.product_variants set delivery = 'service' where product_id = $1", [id]);
    });
    expect((await one<{ kind: string }>("select kind from commerce.products where id = $1", [id])).kind).toBe("plan");
  });

  it("is on sale without a picture, having no page to show one on; goods still need one", async () => {
    const publish = async (id: string) => {
      await db.query("insert into commerce.product_translations (store_id, product_id, locale, title) values ($1, $2, 'nb', 'Plus')", [store, id]);
      await db.query("update commerce.products set status = 'active' where id = $1", [id]);
    };
    const plan = await product("plan", "service", true);
    await publish(plan);
    expect((await one<{ status: string }>("select status from commerce.products where id = $1", [plan])).status).toBe("active");
    await expect(publish(await product("goods", "digital", false))).rejects.toThrow(/without a picture/);
  });

  it("leaves every other kind as it was", async () => {
    const id = await product("goods", "physical", false);
    await db.query("update commerce.products set subscription_only = true where id = $1", [id]);
    await db.query("update commerce.products set subscription_only = false where id = $1", [id]);
  });
});
