import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Segments and customer tags (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4): the limits and checks the database holds. */

let db: PGlite;
let store: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const rules = JSON.stringify({ match: "all", conditions: [] });

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "seg-a");
});

afterAll(async () => {
  await db.close();
});

describe("segments", () => {
  it("have unique names per store, any case, and rules of at most twenty conditions", async () => {
    await db.query("insert into commerce.segments (store_id, title, rules) values ($1, 'VIP', $2)", [store, rules]);
    await rejects("insert into commerce.segments (store_id, title, rules) values ($1, 'vip', $2)", [store, rules], /segments_title_idx/);
    await rejects("insert into commerce.segments (store_id, title, rules) values ($1, ' x', $2)", [store, rules], /segments_title/);
    const many = JSON.stringify({ match: "all", conditions: Array.from({ length: 21 }, () => ({ kind: "account", has: true })) });
    await rejects("insert into commerce.segments (store_id, title, rules) values ($1, 'Many', $2)", [store, many], /segments_rules/);
  });

  it("are at most a hundred a store", async () => {
    const other = await createInvoiceStore(db, "seg-b");
    for (let i = 0; i < 100; i++) await db.query("insert into commerce.segments (store_id, title, rules) values ($1, $2, $3)", [other, `S${i}`, rules]);
    await rejects("insert into commerce.segments (store_id, title, rules) values ($1, 'One more', $2)", [other, rules], /segments.limit/);
  });
});

describe("customer tags", () => {
  it("are one per address and key, in lower case, without commas, at most fifty a person", async () => {
    await db.query("insert into commerce.customer_tags (store_id, email, key, label) values ($1, 'kari@example.com', 'vip', 'VIP')", [store]);
    await rejects("insert into commerce.customer_tags (store_id, email, key, label) values ($1, 'kari@example.com', 'vip', 'Vip')", [store], /duplicate key/);
    await rejects("insert into commerce.customer_tags (store_id, email, key, label) values ($1, 'Kari@example.com', 'x', 'x')", [store], /customer_tags_email/);
    await rejects("insert into commerce.customer_tags (store_id, email, key, label) values ($1, 'kari@example.com', 'a,b', 'a,b')", [store], /customer_tags_label_chars/);
    for (let i = 1; i < 50; i++) await db.query("insert into commerce.customer_tags (store_id, email, key, label) values ($1, 'kari@example.com', $2, $2)", [store, `t${i}`]);
    await rejects("insert into commerce.customer_tags (store_id, email, key, label) values ($1, 'kari@example.com', 'last', 'last')", [store], /customer_tags.limit/);
    expect(await scalar<number>("select count(*)::int from commerce.customer_tags where store_id = $1", [store])).toBe(50);
  });
});
