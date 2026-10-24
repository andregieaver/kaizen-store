import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Codes in depth (wave 5 unit E1, D299, `docs/wave-5-marketing.md` 7.1): the columns' checks and a code's text being one store's once. */

let db: PGlite;
let store: string;
let other: string;
let discount: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "dc-a");
  other = await createInvoiceStore(db, "dc-b");
  discount = await scalar<string>(
    "insert into commerce.discount_codes (store_id, code, kind, percent, unique_codes) values ($1, 'VIP', 'percent', 10, true) returning id",
    [store],
  );
});

afterAll(async () => {
  await db.close();
});

describe("discount codes in depth", () => {
  it("hold the minimum, the lists and their sizes", async () => {
    await rejects("insert into commerce.discount_codes (store_id, code, kind, percent, min_quantity) values ($1, 'Q0', 'percent', 10, 0)", [store], /discount_codes_min_quantity/);
    await rejects("insert into commerce.discount_codes (store_id, code, kind, percent, min_quantity) values ($1, 'Q1', 'percent', 10, 1001)", [store], /discount_codes_min_quantity/);
    await rejects("insert into commerce.discount_codes (store_id, code, kind, percent, term_ids) values ($1, 'T', 'percent', 10, '{}')", [store], /discount_codes_term_ids/);
    await rejects("insert into commerce.discount_codes (store_id, code, kind, percent, tier_ids) values ($1, 'G', 'percent', 10, '\"x\"')", [store], /discount_codes_tier_ids/);
    const many = JSON.stringify(Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    await rejects("insert into commerce.discount_codes (store_id, code, kind, percent, customer_ids) values ($1, 'C', 'percent', 10, $2)", [store, many], /discount_codes_customer_ids/);
    await db.query("insert into commerce.discount_codes (store_id, code, kind, percent, min_quantity) values ($1, 'Q3', 'percent', 10, 3)", [store]);
  });

  it("keep a code's text one store's once, generated or not", async () => {
    await db.query("insert into commerce.discount_code_items (store_id, discount_id, code, batch) values ($1, $2, 'VIP-ABCDEFGH', 1)", [store, discount]);
    await rejects("insert into commerce.discount_code_items (store_id, discount_id, code, batch) values ($1, $2, 'VIP-ABCDEFGH', 1)", [store, discount], /duplicate key/);
    await rejects("insert into commerce.discount_code_items (store_id, discount_id, code, batch) values ($1, $2, 'Q3', 1)", [store, discount], /the store has a code/);
    await rejects("insert into commerce.discount_codes (store_id, code, kind, percent) values ($1, 'VIP-ABCDEFGH', 'percent', 5)", [store], /generated code/);
    await rejects("update commerce.discount_codes set code = 'VIP-ABCDEFGH' where store_id = $1 and code = 'Q3'", [store], /generated code/);
    // Another store may use the same words.
    await db.query("insert into commerce.discount_codes (store_id, code, kind, percent) values ($1, 'VIP-ABCDEFGH', 'percent', 5)", [other]);
    await rejects("insert into commerce.discount_code_items (store_id, discount_id, code, batch) values ($1, $2, 'VIP-B', 0)", [store, discount], /discount_code_items_batch/);
  });

  it("keep a generated code itself, and go with its code", async () => {
    await rejects("update commerce.discount_code_items set code = 'VIP-ZZZZZZZZ' where store_id = $1", [store], /stays itself/);
    await db.query("update commerce.discount_code_items set batch = 2 where store_id = $1", [store]);
    await db.query("delete from commerce.discount_codes where id = $1", [discount]);
    expect(Number(await scalar("select count(*) from commerce.discount_code_items where store_id = $1", [store]))).toBe(0);
  });
});

describe("several codes on one order (D299 E2)", () => {
  it("keep a code's combinations to the three classes", async () => {
    await rejects(
      "insert into commerce.discount_codes (store_id, code, kind, percent, combines_with) values ($1, 'C1', 'percent', 10, '[\"everything\"]')",
      [store],
      /discount_codes_combines_with/,
    );
    await rejects("insert into commerce.discount_codes (store_id, code, kind, percent, combines_with) values ($1, 'C2', 'percent', 10, '{}')", [store], /discount_codes_combines_with/);
    await db.query(
      "insert into commerce.discount_codes (store_id, code, kind, percent, combines_with) values ($1, 'C3', 'percent', 10, '[\"products\", \"shipping\"]')",
      [store],
    );
  });

  it("keep an order's codes in five places, as they were used", async () => {
    const order = await placeOrder(db, store, { lines: [{ sku: "DC-1", unit: 10_000 }], pay: false });
    const row = (position: number, amount = 1000) =>
      db.query("insert into commerce.order_discount_codes (store_id, order_id, position, code, amount_minor) values ($1, $2, $3, 'C3', $4)", [
        store,
        order.id,
        position,
        amount,
      ]);
    await expect(row(0)).rejects.toThrow(/order_discount_codes_position/);
    await expect(row(6)).rejects.toThrow(/order_discount_codes_position/);
    await expect(row(1, -1)).rejects.toThrow(/order_discount_codes_amount/);
    await row(1);
    await expect(row(1)).rejects.toThrow(/duplicate key/);
    await rejects("update commerce.order_discount_codes set amount_minor = 0 where order_id = $1", [order.id], /stay as they were used/);
    await rejects("delete from commerce.order_discount_codes where order_id = $1", [order.id], /stay as they were used/);
  });
});

describe("sign-up welcome codes (D304 J3)", () => {
  it("are one per store, discount and address, in lower case, and go with their discount", async () => {
    const [{ id }] = (await db.query<{ id: string }>("insert into commerce.discount_codes (store_id, code, kind, percent, unique_codes) values ($1, 'HELLO', 'percent', 10, true) returning id", [store])).rows;
    await db.query("insert into commerce.signup_incentives (store_id, discount_id, email, form_id) values ($1, $2, 'kari@example.com', 'f1')", [store, id]);
    await rejects("insert into commerce.signup_incentives (store_id, discount_id, email, form_id) values ($1, $2, 'kari@example.com', 'f2')", [store, id], /signup_incentives_once/);
    await rejects("insert into commerce.signup_incentives (store_id, discount_id, email, form_id) values ($1, $2, 'Ola@example.com', 'f1')", [store, id], /signup_incentives_email/);
    await db.query("delete from commerce.discount_codes where id = $1", [id]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from commerce.signup_incentives where discount_id = $1", [id])).rows[0].n).toBe(0);
  });
});
