import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * How a visitor is first shown a store's language and whether the currency goes with it (D479): the rules the database holds on
 * `stores.language_rule`, `currency_follows_language` and `language_currencies`, with every migration applied (PGlite).
 */

let db: PGlite;
let storeId: string;

const set = (column: string, value: unknown) => db.query(`update commerce.stores set ${column} = $2 where id = $1`, [storeId, value]);

beforeAll(async () => {
  db = await createTestDatabase();
  const { rows } = await db.query<{ id: string }>("insert into commerce.stores (slug, name, country) values ('lang-rule', 'Lang', 'NO') returning id");
  storeId = rows[0].id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("a store's language rule (D479)", () => {
  it("is the browser's language for a new store, the currency apart; a store made before kept its country's own", async () => {
    const { rows } = await db.query<{ language_rule: string; currency_follows_language: boolean; language_currencies: unknown }>(
      "select language_rule, currency_follows_language, language_currencies from commerce.stores where id = $1",
      [storeId],
    );
    expect(rows[0]).toEqual({ language_rule: "browser", currency_follows_language: false, language_currencies: {} });
    // Kaizena Flow's own store was made by a migration before D479's: it kept what every store did.
    const house = await db.query<{ language_rule: string }>("select language_rule from commerce.stores where house");
    expect(house.rows.map((r) => r.language_rule)).toEqual(["own"]);
  });

  it("takes one of the four rules", async () => {
    for (const rule of ["location", "location-browser", "browser", "own"]) await set("language_rule", rule);
    await expect(set("language_rule", "geo")).rejects.toThrow(/stores_language_rule/);
  });

  it("goes with a store's copy (D129)", async () => {
    await db.query(
      "update commerce.stores set language_rule = 'location', currency_follows_language = true, language_currencies = '{\"en\": \"EUR\"}' where id = $1",
      [storeId],
    );
    const owner = (await db.query<{ id: string }>("insert into commerce.accounts (email) values ('lang-owner@example.com') returning id")).rows[0].id;
    const copy = (
      await db.query<{ id: string }>("select commerce.duplicate_store($1, 'lang-copy', 'Lang copy', $2, null::uuid[], null::uuid[], null::uuid[]) as id", [storeId, owner])
    ).rows[0].id;
    const { rows } = await db.query("select language_rule, currency_follows_language, language_currencies from commerce.stores where id = $1", [copy]);
    expect(rows[0]).toEqual({ language_rule: "location", currency_follows_language: true, language_currencies: { en: "EUR" } });
  });

  it("keeps a currency or `own` per two-letter language, nothing else", async () => {
    await set("language_currencies", JSON.stringify({ en: "EUR", de: "own" }));
    await expect(set("language_currencies", JSON.stringify({ en: "eur" }))).rejects.toThrow(/stores_language_currencies/);
    await expect(set("language_currencies", JSON.stringify({ en: 5 }))).rejects.toThrow(/stores_language_currencies/);
    await expect(set("language_currencies", JSON.stringify(["EUR"]))).rejects.toThrow(/stores_language_currencies/);
  });
});
