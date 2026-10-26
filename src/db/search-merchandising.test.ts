import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Search synonyms and rules (wave 6 unit F, D324, `docs/wave-6-catalogue.md` F.1 and F.2), as the database holds them. */

let db: PGlite;
let store: string;
let other: string;
let product: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "sm-a");
  other = await createInvoiceStore(db, "sm-b");
  product = await scalar<string>(
    "insert into commerce.products (store_id, handle, tax_code, vat_category, kind) values ($1, 'sofa', 'txcd_99999999', 'standard', 'goods') returning id",
    [store],
  );
});

afterAll(async () => {
  await db.close();
});

describe("search synonyms", () => {
  it("hold groups of the right size, at most 500 a store", async () => {
    await rejects("insert into commerce.search_synonyms (store_id, locale, kind, words) values ($1, 'en', 'both', array['sofa'])", [store], /search_synonyms_words/);
    await rejects("insert into commerce.search_synonyms (store_id, locale, kind, words) values ($1, 'en', 'one_way', array['tee'])", [store], /search_synonyms_words/);
    await db.query(
      "insert into commerce.search_synonyms (store_id, locale, kind, words) select $1, 'en', 'both', array['a' || n, 'b' || n] from generate_series(1, 500) n",
      [store],
    );
    await rejects("insert into commerce.search_synonyms (store_id, locale, kind, words) values ($1, 'en', 'both', array['x', 'y'])", [store], /at most 500/);
    // Another store has its own 500.
    await db.query("insert into commerce.search_synonyms (store_id, locale, kind, words) values ($1, 'en', 'both', array['x', 'y'])", [other]);
  });
});

describe("search rules", () => {
  it("hold what each action needs", async () => {
    await rejects("insert into commerce.search_rules (store_id, action, product_id) values ($1, 'pin', $2)", [store, product], /search_rules_shape/);
    await rejects("insert into commerce.search_rules (store_id, action, queries) values ($1, 'redirect', array['sale'])", [store], /search_rules_shape/);
    await rejects("insert into commerce.search_rules (store_id, action) values ($1, 'boost')", [store], /search_rules_shape/);
    await db.query("insert into commerce.search_rules (store_id, action, product_id) values ($1, 'boost', $2)", [store, product]);
    await db.query("insert into commerce.search_rules (store_id, action, target, queries) values ($1, 'redirect', '/sale', array['sale'])", [store]);
  });

  it("name only the store's own products, and go with them", async () => {
    await rejects("insert into commerce.search_rules (store_id, action, product_id) values ($1, 'bury', $2)", [other, product], /search_rules_product_fk/);
    const before = await scalar<number>("select count(*)::int from commerce.search_rules where store_id = $1", [store]);
    await db.query("delete from commerce.products where id = $1", [product]);
    expect(await scalar<number>("select count(*)::int from commerce.search_rules where store_id = $1", [store])).toBe(before - 1);
  });

  it("keep at most 200 a store", async () => {
    await db.query("insert into commerce.search_rules (store_id, action, target, queries) select $1, 'redirect', '/x', array['q' || n] from generate_series(1, 199) n", [store]);
    await rejects("insert into commerce.search_rules (store_id, action, target, queries) values ($1, 'redirect', '/y', array['y'])", [store], /at most 200/);
  });
});
