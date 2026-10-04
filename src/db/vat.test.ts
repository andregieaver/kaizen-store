import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COPY_RULES } from "@/lib/store-copy-rules";

import { createTestDatabase } from "./testing";

/**
 * The VAT engine's rules in the database (D157, docs/wave-1a-tax.md section 3), against every migration applied to a real
 * Postgres (PGlite): categories as data, rates with history written only by `set_vat_rate()`, the one reader
 * `vat_rate(country, category, at)`, shipping VAT rules, the tax profile, the check log, what an order may hold, the
 * copy functions, and the migration itself keeping what was there.
 */

let db: PGlite;
let shop: string;
let owner: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('vat-shop', 'VAT shop', 'SE') returning id")).id;
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = any($2)`,
    [shop, ["DE", "SE", "DK"]],
  );
  owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ('vat-owner@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const scalar = async <T>(sql: string, params: unknown[] = []) => Object.values((await rows(sql, params))[0] ?? {})[0] as T;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

/** The rate on a day (noon UTC unless a time is given). */
const rateOn = (country: string, category: string, at: string) =>
  scalar<string>("select commerce.vat_rate($1::char(2), $2, $3::timestamptz)::text", [country, category, at]);

const setRate = (country: string, category: string, rate: number, from: string, over: { source?: string; note?: string; account?: string | null } = {}) =>
  db.query("select commerce.set_vat_rate($1::char(2), $2, $3, $4::date, $5, $6::date, $7, $8)", [
    country,
    category,
    rate,
    from,
    over.source ?? "Test source, https://example.com/rates",
    "2026-10-03",
    over.note ?? "",
    over.account === undefined ? owner : over.account,
  ]);

describe("categories", () => {
  it("has the built-in three and the six reduced-rate categories, all active", async () => {
    const found = await rows<{ code: string; built_in: boolean; active: boolean }>("select code, built_in, active from commerce.vat_categories order by sort");
    expect(found.map((c) => c.code)).toEqual(["standard", "accommodation", "food", "books", "periodicals", "medicines", "culture_events", "children_goods", "exempt"]);
    expect(found.filter((c) => c.built_in).map((c) => c.code).sort()).toEqual(["accommodation", "exempt", "standard"]);
    expect(found.every((c) => c.active)).toBe(true);
  });

  it("is never deleted", async () => {
    await rejects("delete from commerce.vat_categories where code = 'food'", [], /vat_category_kept/);
    await rejects("delete from commerce.vat_categories where code = 'standard'", [], /vat_category_kept/);
  });

  it("keeps its code and its built-in flag", async () => {
    await rejects("update commerce.vat_categories set code = 'foods' where code = 'food'", [], /vat_category_fixed/);
    await rejects("update commerce.vat_categories set built_in = true where code = 'food'", [], /vat_category_fixed|vat_categories_built_in/);
  });

  it("does not let a built-in category be renamed or switched off", async () => {
    await rejects("update commerce.vat_categories set name_en = 'Other' where code = 'standard'", [], /vat_category_built_in/);
    await rejects("update commerce.vat_categories set active = false where code = 'exempt'", [], /vat_category_built_in/);
    await rejects("update commerce.vat_categories set active = false where code = 'accommodation'", [], /vat_category_built_in/);
    // Its description may be reworded.
    await db.query("update commerce.vat_categories set description = 'Most goods and services.' where code = 'standard'");
  });

  it("lets a platform admin add a category and switch it off and on, but not make it built in", async () => {
    await db.query("insert into commerce.vat_categories (code, name_en, sort, updated_by) values ('pet_food', 'Pet food', 100, $1)", [owner]);
    await db.query("update commerce.vat_categories set active = false where code = 'pet_food'");
    expect(await scalar("select active from commerce.vat_categories where code = 'pet_food'")).toBe(false);
    await db.query("update commerce.vat_categories set active = true where code = 'pet_food'");
    await rejects("insert into commerce.vat_categories (code, name_en, built_in) values ('luxury', 'Luxury', true)", [], /vat_categories_built_in/);
  });

  it("has codes and names of one shape", async () => {
    for (const code of ["Food2", "1abc", "a", "x".repeat(32), "a-b"]) {
      await rejects("insert into commerce.vat_categories (code, name_en) values ($1, 'X')", [code], /vat_categories_code/);
    }
    await rejects("insert into commerce.vat_categories (code, name_en) values ('okcode', '')", [], /vat_categories_name/);
    await rejects("insert into commerce.vat_categories (code, name_en) values ('okcode', $1)", ["x".repeat(61)], /vat_categories_name/);
    await rejects("insert into commerce.vat_categories (code, name_en, description) values ('okcode', 'Ok', $1)", ["x".repeat(201)], /vat_categories_description/);
  });

  it("is what a product's category must be (a foreign key replaced the check)", async () => {
    const make = (category: string) =>
      db.query("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, $2, 'txcd_99999999', $3)", [shop, `vat-p-${++counter}`, category]);
    await make("food");
    await make("accommodation");
    await make("exempt");
    await rejects("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, 'vat-bad', 'txcd_99999999', 'caviar')", [shop], /products_vat_category_fk/);
    expect(await scalar("select count(*)::int from pg_constraint where conname = 'products_vat_category'")).toBe(0);
  });

  it("cannot be deleted while a product has it, and a switched-off one stays on its products", async () => {
    await db.query("insert into commerce.vat_categories (code, name_en) values ('gadgets', 'Gadgets')");
    await db.query("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, 'vat-gadget', 'txcd_99999999', 'gadgets')", [shop]);
    await db.query("update commerce.vat_categories set active = false where code = 'gadgets'");
    expect(await scalar("select vat_category from commerce.products where handle = 'vat-gadget'")).toBe("gadgets");
  });
});

describe("the seeded rates", () => {
  it("has a source and a date checked on every row, none verified, none from the future, none out of range", async () => {
    const all = await rows<{
      country_code: string; category: string; rate: string; valid_from: string; source: string; checked_on: string; verified_at: string | null; verified_by: string | null;
    }>("select country_code, category, rate::text, valid_from::text, source, checked_on::text, verified_at, verified_by from commerce.vat_rates where created_by is null");
    expect(all.length).toBeGreaterThan(28);
    const today = new Date().toISOString().slice(0, 10);
    for (const r of all) {
      expect([r.country_code, r.category, typeof r.source, r.source.length >= 8 && r.source.length <= 400]).toEqual([r.country_code, r.category, "string", true]);
      expect([r.country_code, r.category, r.checked_on <= today]).toEqual([r.country_code, r.category, true]);
      expect([r.country_code, r.category, r.valid_from <= today]).toEqual([r.country_code, r.category, true]);
      expect([r.country_code, r.category, r.verified_at, r.verified_by]).toEqual([r.country_code, r.category, null, null]);
      const rate = Number(r.rate);
      expect([r.country_code, r.category, rate >= 0 && rate <= 0.3]).toEqual([r.country_code, r.category, true]);
    }
  });

  it("has a standard rate for every country, equal to the country's own", async () => {
    const missing = await rows(
      `select c.code from commerce.countries c
        where not exists (select 1 from commerce.vat_rates r where r.country_code = c.code and r.category = 'standard' and r.valid_to is null)`,
    );
    expect(missing).toEqual([]);
    const different = await rows(
      `select c.code from commerce.countries c join commerce.vat_rates r on r.country_code = c.code and r.category = 'standard' and r.valid_to is null
        where r.rate <> c.standard_vat_rate`,
    );
    expect(different).toEqual([]);
    expect(await scalar("select count(*)::int from commerce.vat_rates where category = 'standard'")).toBe(28);
    expect(await rateOn("FI", "standard", "2026-10-03T12:00:00Z")).toBe("0.2550");
  });

  it("keeps the three accommodation rates, now with their source", async () => {
    for (const [country, rate] of [["NO", "0.1200"], ["SE", "0.1200"], ["DE", "0.0700"]]) {
      expect(await rateOn(country, "accommodation", "2026-10-03T12:00:00Z")).toBe(rate);
    }
    const sources = await rows<{ source: string; checked_on: string }>("select source, checked_on::text from commerce.vat_rates where category = 'accommodation'");
    expect(sources).toHaveLength(3);
    expect(sources.every((s) => !s.source.startsWith("Kaizen seed"))).toBe(true);
  });

  it("lists how many rows each category has, so a reviewer sees the coverage", async () => {
    const counts = await rows<{ category: string; countries: number }>(
      "select category, count(distinct country_code)::int as countries from commerce.vat_rates group by category order by category",
    );
    console.info("VAT rate coverage (countries with a row per category):", Object.fromEntries(counts.map((c) => [c.category, c.countries])));
    const byCategory = Object.fromEntries(counts.map((c) => [c.category, c.countries]));
    expect(byCategory.standard).toBe(28);
    expect(byCategory.food).toBeGreaterThanOrEqual(3);
    // No row is the honest answer where no source was read.
    expect(byCategory.medicines ?? 0).toBe(0);
    expect(byCategory.children_goods ?? 0).toBe(0);
  });

  it("answers the standard rate where a country has no reduced rate for a category (Denmark's food)", async () => {
    expect(await rateOn("DK", "food", "2026-10-03T12:00:00Z")).toBe("0.2500");
    expect(await rateOn("DK", "medicines", "2026-10-03T12:00:00Z")).toBe("0.2500");
  });

  it("has Sweden's food rate with history across 1 April 2026", async () => {
    expect(await rateOn("SE", "food", "2026-03-31T12:00:00Z")).toBe("0.1200");
    expect(await rateOn("SE", "food", "2026-04-01T12:00:00Z")).toBe("0.0600");
    // Midnight in Stockholm (UTC+2 on that day): 22:00 UTC on 31 March is already 1 April there.
    expect(await rateOn("SE", "food", "2026-03-31T21:59:59Z")).toBe("0.1200");
    expect(await rateOn("SE", "food", "2026-03-31T22:00:00Z")).toBe("0.0600");
  });

  it("gives every country a time zone", async () => {
    expect(await rows("select code from commerce.countries where time_zone is null")).toEqual([]);
    expect(await scalar("select time_zone from commerce.countries where code = 'NO'")).toBe("Europe/Oslo");
  });
});

describe("vat_rate(country, category, at)", () => {
  it("is 0 for exempt, whatever the country, and the old two-argument form still works", async () => {
    expect(await rateOn("DE", "exempt", "2026-10-03T12:00:00Z")).toBe("0");
    expect(await scalar<string>("select commerce.vat_rate('DE', 'standard')::text")).toBe("0.1900");
    expect(await scalar<string>("select commerce.vat_rate('NO', 'accommodation')::text")).toBe("0.1200");
    expect(await scalar<string>("select commerce.vat_rate('NO', 'exempt')::text")).toBe("0");
    expect(await scalar<string>("select commerce.vat_rate('SE', 'food')::text")).toBe("0.0600");
  });

  it("is the same in the two-argument form as in the three-argument form with now(), for every country and category", async () => {
    const different = await rows(
      `select c.code, k.code as category from commerce.countries c, commerce.vat_categories k
        where commerce.vat_rate(c.code, k.code) is distinct from commerce.vat_rate(c.code, k.code, now())`,
    );
    expect(different).toEqual([]);
  });

  it("is 0 for an unknown country, the country's own standard rate being its fallback", async () => {
    expect(await rateOn("ZZ", "standard", "2026-10-03T12:00:00Z")).toBe("0");
  });

  it("falls back to the country's cached standard rate before the standard history begins", async () => {
    expect(await rateOn("DE", "standard", "2020-01-01T12:00:00Z")).toBe("0.1900");
  });

  it("reads a rate before and after a change date, and a scheduled change shows only from its day", async () => {
    await setRate("DK", "food", 0.1, "2027-01-01");
    expect(await rateOn("DK", "food", "2026-12-31T12:00:00Z")).toBe("0.2500");
    expect(await rateOn("DK", "food", "2027-01-01T12:00:00Z")).toBe("0.1000");
    await setRate("DK", "food", 0.08, "2027-07-01");
    expect(await rateOn("DK", "food", "2027-06-30T12:00:00Z")).toBe("0.1000");
    expect(await rateOn("DK", "food", "2027-07-01T12:00:00Z")).toBe("0.0800");
    expect(await rateOn("DK", "food", "2030-01-01T12:00:00Z")).toBe("0.0800");
  });

  it("changes at midnight in the country's own time zone", async () => {
    // Denmark is UTC+2 in summer: 1 July 00:00 there is 30 June 22:00 UTC.
    expect(await rateOn("DK", "food", "2027-06-30T21:59:59Z")).toBe("0.1000");
    expect(await rateOn("DK", "food", "2027-06-30T22:00:00Z")).toBe("0.0800");
    // In winter (UTC+1) 1 January 00:00 is 31 December 23:00 UTC.
    expect(await rateOn("DK", "food", "2026-12-31T22:59:59Z")).toBe("0.2500");
    expect(await rateOn("DK", "food", "2026-12-31T23:00:00Z")).toBe("0.1000");
  });
});

describe("set_vat_rate()", () => {
  it("ends the open period, begins a new one and writes the audit log", async () => {
    await setRate("FR", "books", 0.055, "2026-02-01", { note: "TEST first" });
    await setRate("FR", "books", 0.05, "2026-06-01", { note: "TEST second" });
    const periods = await rows<{ rate: string; valid_from: string; valid_to: string | null; created_by: string }>(
      "select rate::text, valid_from::text, valid_to::text, created_by from commerce.vat_rates where country_code = 'FR' and category = 'books' order by valid_from",
    );
    expect(periods).toEqual([
      { rate: "0.0550", valid_from: "2026-02-01", valid_to: "2026-06-01", created_by: owner },
      { rate: "0.0500", valid_from: "2026-06-01", valid_to: null, created_by: owner },
    ]);
    const audit = await one<{ action: string; account_id: string; store_id: string | null; details: Record<string, unknown> }>(
      "select action, account_id, store_id, details from commerce.audit_log where action = 'vat.rate_set' and details->>'country' = 'FR' order by id desc limit 1",
    );
    expect(audit).toMatchObject({ action: "vat.rate_set", account_id: owner, store_id: null });
    expect(audit.details).toMatchObject({ country: "FR", category: "books", rate: 0.05, previous_rate: 0.055, valid_from: "2026-06-01" });
  });

  it("refuses a start that is not after the latest period, so history is never rewritten", async () => {
    await rejects("select commerce.set_vat_rate('FR', 'books', 0.04, '2026-06-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_backdated/);
    await rejects("select commerce.set_vat_rate('FR', 'books', 0.04, '2026-03-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_backdated/);
  });

  it("refuses exempt, an unknown country or category, a rate out of range and missing dates", async () => {
    await rejects("select commerce.set_vat_rate('FR', 'exempt', 0.1, '2030-01-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_exempt/);
    await rejects("select commerce.set_vat_rate('ZZ', 'books', 0.1, '2030-01-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_country/);
    await rejects("select commerce.set_vat_rate('FR', 'caviar', 0.1, '2030-01-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_category/);
    await rejects("select commerce.set_vat_rate('FR', 'books', 1, '2030-01-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_value/);
    await rejects("select commerce.set_vat_rate('FR', 'books', -0.1, '2030-01-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_value/);
    await rejects("select commerce.set_vat_rate('FR', 'books', null, '2030-01-01', 'A source here', '2026-10-03', '', null)", [], /vat_rate_value/);
    await rejects("select commerce.set_vat_rate('FR', 'books', 0.1, null, 'A source here', '2026-10-03', '', null)", [], /vat_rate_dates/);
    await rejects("select commerce.set_vat_rate('FR', 'books', 0.1, '2030-01-01', 'A source here', null, '', null)", [], /vat_rate_dates/);
  });

  it("needs a source of 8 to 400 characters", async () => {
    await rejects("select commerce.set_vat_rate('FR', 'books', 0.1, '2030-01-01', 'short', '2026-10-03', '', null)", [], /vat_rates_source/);
    await rejects("select commerce.set_vat_rate('FR', 'books', 0.1, '2030-01-01', $1, '2026-10-03', '', null)", ["x".repeat(401)], /vat_rates_source/);
    // and the failed attempts left the open period alone
    expect(await scalar("select valid_to from commerce.vat_rates where country_code = 'FR' and category = 'books' and valid_from = '2026-06-01'")).toBeNull();
  });

  it("makes a zero rate possible (books in Norway)", async () => {
    await setRate("IT", "books", 0, "2026-05-01");
    expect(await rateOn("IT", "books", "2026-10-03T12:00:00Z")).toBe("0.0000");
  });

  it("starts a category's history in a country that had none", async () => {
    await setRate("PT", "medicines", 0.06, "2026-01-01");
    expect(await rateOn("PT", "medicines", "2026-10-03T12:00:00Z")).toBe("0.0600");
    expect(await rateOn("PT", "children_goods", "2026-10-03T12:00:00Z")).toBe("0.2300");
  });

  it("moves a country's standard rate and its cached copy, with history", async () => {
    await setRate("MT", "standard", 0.19, "2026-01-02");
    // a change that has already begun updates the cache at once; the old row is closed
    expect(await scalar("select standard_vat_rate::text from commerce.countries where code = 'MT'")).toBe("0.1900");
    expect(await rateOn("MT", "standard", "2026-01-01T12:00:00Z")).toBe("0.1800");
    expect(await rateOn("MT", "standard", "2026-10-03T12:00:00Z")).toBe("0.1900");
    expect(await scalar("select valid_to::text from commerce.vat_rates where country_code = 'MT' and category = 'standard' and valid_from = '2026-01-01'")).toBe("2026-01-02");
  });

  it("leaves the cache alone for a change in the future, and the daily sync brings it in step", async () => {
    await setRate("LU", "standard", 0.16, "2999-01-01");
    expect(await scalar("select standard_vat_rate::text from commerce.countries where code = 'LU'")).toBe("0.1700");
    // the sync follows the row in force today, so the cache that has drifted is put right
    await db.query("update commerce.countries set standard_vat_rate = 0.5 where code = 'LU'");
    expect(await scalar("select commerce.sync_standard_vat_rates()")).toBeGreaterThanOrEqual(1);
    expect(await scalar("select standard_vat_rate::text from commerce.countries where code = 'LU'")).toBe("0.1700");
    expect(await scalar("select commerce.sync_standard_vat_rates()")).toBe(0);
  });
});

describe("a rate's history", () => {
  it("is never deleted", async () => {
    await rejects("delete from commerce.vat_rates where country_code = 'DE' and category = 'standard'", [], /vat_rate_history/);
  });

  it("is never edited in place", async () => {
    await rejects("update commerce.vat_rates set rate = 0.2 where country_code = 'DE' and category = 'standard'", [], /vat_rate_history/);
    await rejects("update commerce.vat_rates set valid_from = '2025-01-01' where country_code = 'DE' and category = 'standard'", [], /vat_rate_history/);
    await rejects("update commerce.vat_rates set source = 'Something else entirely' where country_code = 'DE' and category = 'standard'", [], /vat_rate_history/);
    await rejects("update commerce.vat_rates set checked_on = '2026-10-01' where country_code = 'DE' and category = 'standard'", [], /vat_rate_history/);
    await rejects("update commerce.vat_rates set category = 'food' where country_code = 'DE' and category = 'standard'", [], /vat_rate_history/);
  });

  it("may only have its period ended, once, and its note and verification set", async () => {
    await db.query("update commerce.vat_rates set note = 'A note' where country_code = 'DE' and category = 'books'");
    await rejects("update commerce.vat_rates set valid_to = valid_from where country_code = 'DE' and category = 'books'", [], /vat_rates_period/);
    await db.query("update commerce.vat_rates set valid_to = '2999-01-01' where country_code = 'DE' and category = 'books'");
    await rejects("update commerce.vat_rates set valid_to = '2998-01-01' where country_code = 'DE' and category = 'books'", [], /vat_rate_history/);
  });

  it("never overlaps another period of the same country and category", async () => {
    const insert = (from: string, to: string | null) =>
      db.query(
        "insert into commerce.vat_rates (country_code, category, rate, valid_from, valid_to, source, checked_on) values ('BE', 'periodicals', 0.06, $1, $2, 'A source here', '2026-10-03')",
        [from, to],
      );
    await insert("2026-01-01", "2026-06-01");
    await rejects("insert into commerce.vat_rates (country_code, category, rate, valid_from, source, checked_on) values ('BE', 'periodicals', 0.06, '2026-03-01', 'A source here', '2026-10-03')", [], /vat_rate_overlap/);
    await rejects("insert into commerce.vat_rates (country_code, category, rate, valid_from, valid_to, source, checked_on) values ('BE', 'periodicals', 0.06, '2025-01-01', '2026-02-01', 'A source here', '2026-10-03')", [], /vat_rate_overlap/);
    await rejects("insert into commerce.vat_rates (country_code, category, rate, valid_from, valid_to, source, checked_on) values ('BE', 'periodicals', 0.06, '2025-01-01', '2027-01-01', 'A source here', '2026-10-03')", [], /vat_rate_overlap/);
    // next to it is fine, and another country or category is another history
    await insert("2026-06-01", null);
    await db.query("insert into commerce.vat_rates (country_code, category, rate, valid_from, source, checked_on) values ('BE', 'books', 0.06, '2026-01-01', 'A source here', '2026-10-03')");
    await rejects("insert into commerce.vat_rates (country_code, category, rate, valid_from, source, checked_on) values ('BE', 'periodicals', 0.06, '2030-01-01', 'A source here', '2026-10-03')", [], /vat_rate_overlap/);
  });

  it("has no rate for exempt goods, and a period that ends after it begins", async () => {
    await rejects("insert into commerce.vat_rates (country_code, category, rate, valid_from, source, checked_on) values ('BE', 'exempt', 0, '2026-01-01', 'A source here', '2026-10-03')", [], /vat_rates_not_exempt/);
    await rejects("insert into commerce.vat_rates (country_code, category, rate, valid_from, valid_to, source, checked_on) values ('AT', 'books', 0.1, '2026-02-01', '2026-01-01', 'A source here', '2026-10-03')", [], /vat_rates_period/);
  });

  it("is verified once, by a named person, who and when, and the verification is audit-logged and kept", async () => {
    await db.query("select commerce.verify_vat_rate('NO', 'food', '2026-01-01', $1)", [owner]);
    const row = await one<{ verified_by: string; verified_at: string }>("select verified_by, verified_at from commerce.vat_rates where country_code = 'NO' and category = 'food'");
    expect(row.verified_by).toBe(owner);
    expect(row.verified_at).not.toBeNull();
    expect(await scalar("select count(*)::int from commerce.audit_log where action = 'vat.rate_verified' and details->>'country' = 'NO'")).toBe(1);
    await rejects("select commerce.verify_vat_rate('NO', 'food', '2026-01-01', $1)", [owner], /already verified/);
    await rejects("select commerce.verify_vat_rate('NO', 'food', '2026-01-01', null)", [], /names the person/);
    await rejects("select commerce.verify_vat_rate('NO', 'food', '1999-01-01', $1)", [owner], /no such rate/);
    await rejects("update commerce.vat_rates set verified_at = null, verified_by = null where country_code = 'NO' and category = 'food'", [], /vat_rate_verified/);
    await rejects("update commerce.vat_rates set verified_by = null where country_code = 'NO' and category = 'food'", [], /vat_rate_verified|vat_rates_verified/);
  });
});

describe("shipping VAT rules", () => {
  it("is the standard rule in every country and ignores an unverified rule", async () => {
    expect(await scalar("select count(*)::int from commerce.shipping_vat_rules")).toBe(28);
    expect(await scalar("select count(*)::int from commerce.shipping_vat_rules where rule <> 'standard' or verified_at is not null")).toBe(0);
    expect(await scalar("select commerce.shipping_vat_rule('DE')")).toBe("standard");
    expect(await scalar("select commerce.shipping_vat_rule('ZZ')")).toBe("standard");
  });

  it("applies a rule only once it is verified, and says so in the audit log", async () => {
    await db.query("select commerce.set_shipping_vat_rule('DE', 'follows_goods', 'Draft rule from the accountant', '2026-10-03', 'Not yet checked', false, $1)", [owner]);
    expect(await scalar("select rule from commerce.shipping_vat_rules where country_code = 'DE'")).toBe("follows_goods");
    expect(await scalar("select commerce.shipping_vat_rule('DE')")).toBe("standard");
    await db.query("select commerce.set_shipping_vat_rule('DE', 'follows_goods', 'Accountant, UStG commentary', '2026-10-03', 'Verified', true, $1)", [owner]);
    expect(await scalar("select commerce.shipping_vat_rule('DE')")).toBe("follows_goods");
    expect(await scalar("select verified_by from commerce.shipping_vat_rules where country_code = 'DE'")).toBe(owner);
    expect(await scalar("select count(*)::int from commerce.audit_log where action = 'vat.shipping_rule_set' and details->>'country' = 'DE'")).toBe(2);
    // changing it unverifies it
    await db.query("select commerce.set_shipping_vat_rule('DE', 'highest', 'Accountant, a new reading', '2026-10-03', '', false, $1)", [owner]);
    expect(await scalar("select commerce.shipping_vat_rule('DE')")).toBe("standard");
  });

  it("refuses a verified rule without its source, date or person, an unknown rule and an unknown country", async () => {
    await rejects("select commerce.set_shipping_vat_rule('SE', 'highest', '', '2026-10-03', '', true, $1)", [owner], /shipping_vat_verified/);
    await rejects("select commerce.set_shipping_vat_rule('SE', 'highest', 'Accountant, a reading', null, '', true, $1)", [owner], /shipping_vat_verified/);
    await rejects("select commerce.set_shipping_vat_rule('SE', 'highest', 'Accountant, a reading', '2026-10-03', '', true, null)", [], /shipping_vat_verified/);
    await rejects("select commerce.set_shipping_vat_rule('SE', 'sometimes', 'Accountant, a reading', '2026-10-03', '', false, $1)", [owner], /shipping_vat_rules_rule/);
    await rejects("select commerce.set_shipping_vat_rule('ZZ', 'highest', 'Accountant, a reading', '2026-10-03', '', false, $1)", [owner], /shipping_vat_country/);
  });
});

describe("the tax profile", () => {
  const fresh = async (slug: string, country: string | null) =>
    (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, $2) returning id", [slug, country])).id;

  it("is made on first save and has nothing by default", async () => {
    const s = await fresh("tp-default", "SE");
    expect(await scalar("select count(*)::int from commerce.store_tax_profile where store_id = $1", [s])).toBe(0);
    await db.query("insert into commerce.store_tax_profile (store_id) values ($1)", [s]);
    expect(await one("select vat_registered, vat_number, oss_scheme, ioss_markets from commerce.store_tax_profile where store_id = $1", [s])).toEqual({
      vat_registered: false, vat_number: null, oss_scheme: "none", ioss_markets: [],
    });
  });

  it("holds a number with its own country's prefix, Greece's as EL", async () => {
    const se = await fresh("tp-se", "SE");
    await db.query("insert into commerce.store_tax_profile (store_id, vat_number) values ($1, 'SE556677889901')", [se]);
    await rejects("update commerce.store_tax_profile set vat_number = 'DE123456789' where store_id = $1", [se], /tax_profile_vat_prefix/);
    const gr = await fresh("tp-gr", "GR");
    await rejects("insert into commerce.store_tax_profile (store_id, vat_number) values ($1, 'GR123456789')", [gr], /tax_profile_vat_prefix/);
    await db.query("insert into commerce.store_tax_profile (store_id, vat_number) values ($1, 'EL123456789')", [gr]);
    const no = await fresh("tp-no", "NO");
    await db.query("insert into commerce.store_tax_profile (store_id, vat_number) values ($1, 'NO923456783MVA')", [no]);
    const nowhere = await fresh("tp-nowhere", null);
    await db.query("insert into commerce.store_tax_profile (store_id, vat_number) values ($1, 'DE123456789')", [nowhere]);
  });

  it("holds numbers of the right shapes only", async () => {
    const s = await fresh("tp-shapes", "SE");
    await db.query("insert into commerce.store_tax_profile (store_id) values ($1)", [s]);
    for (const bad of ["se556677889901", "S556677889901", "SE", "SE1", "SE" + "1".repeat(13), "SE 556677889901"]) {
      await rejects("update commerce.store_tax_profile set vat_number = $2 where store_id = $1", [s, bad], /store_tax_profile_vat_number|tax_profile_vat_prefix/);
    }
    for (const bad of ["IM123", "EU1234567890", "IM12345678901", "im1234567890"]) {
      await rejects("update commerce.store_tax_profile set ioss_number = $2 where store_id = $1", [s, bad], /store_tax_profile_ioss_number/);
    }
    await db.query("update commerce.store_tax_profile set ioss_number = 'IM1234567890' where store_id = $1", [s]);
  });

  it("takes IOSS markets that are EU countries, each once", async () => {
    const s = await fresh("tp-ioss", "NO");
    await db.query("insert into commerce.store_tax_profile (store_id, ioss_markets) values ($1, '{DE,SE}')", [s]);
    await rejects("update commerce.store_tax_profile set ioss_markets = '{DE,NO}' where store_id = $1", [s], /tax_profile_ioss_markets/);
    await rejects("update commerce.store_tax_profile set ioss_markets = '{DE,DE}' where store_id = $1", [s], /tax_profile_ioss_markets/);
    await rejects("update commerce.store_tax_profile set ioss_markets = '{XX}' where store_id = $1", [s], /tax_profile_ioss_markets/);
    await rejects("update commerce.store_tax_profile set ioss_markets = '{de}' where store_id = $1", [s], /tax_profile_ioss_markets/);
    await db.query("update commerce.store_tax_profile set ioss_markets = '{}' where store_id = $1", [s]);
  });

  it("needs a member state for the Union scheme, and an EU number only for the non-Union one", async () => {
    const s = await fresh("tp-oss", "SE");
    await rejects("insert into commerce.store_tax_profile (store_id, oss_scheme) values ($1, 'union')", [s], /tax_profile_oss_member_state/);
    await rejects("insert into commerce.store_tax_profile (store_id, oss_scheme, oss_member_state) values ($1, 'union', 'NO')", [s], /tax_profile_oss_member_state/);
    await db.query("insert into commerce.store_tax_profile (store_id, oss_scheme, oss_member_state) values ($1, 'union', 'SE')", [s]);
    await rejects("update commerce.store_tax_profile set oss_number = 'EU123456789' where store_id = $1", [s], /store_tax_profile_oss_number/);
    await db.query("update commerce.store_tax_profile set oss_scheme = 'non_union', oss_number = 'EU123456789' where store_id = $1", [s]);
    await rejects("update commerce.store_tax_profile set oss_number = 'EU123' where store_id = $1", [s], /store_tax_profile_oss_number/);
    await rejects("update commerce.store_tax_profile set oss_scheme = 'both', oss_number = null where store_id = $1", [s], /store_tax_profile_oss_scheme/);
  });

  describe("the check it rests on", () => {
    const seller = async (store: string, number: string, status: "valid" | "invalid" | "unavailable") =>
      (
        await one<{ id: string }>(
          `insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'seller', $2, left($2, 2), $3, 'vies') returning id`,
          [store, number, status],
        )
      ).id;

    it("is the seller's check of this number, with its result copied, and nothing without a number", async () => {
      const s = await fresh("tp-check", "SE");
      await db.query("insert into commerce.store_tax_profile (store_id, vat_number) values ($1, 'SE556677889901')", [s]);
      const valid = await seller(s, "SE556677889901", "valid");
      await db.query("update commerce.store_tax_profile set vat_number_check_id = $2, vat_number_checked_at = now(), vat_number_valid = true where store_id = $1", [s, valid]);
      await rejects("update commerce.store_tax_profile set vat_number_valid = false where store_id = $1", [s], /tax_profile_check/);
      const invalid = await seller(s, "SE556677889901", "invalid");
      await db.query("update commerce.store_tax_profile set vat_number_check_id = $2, vat_number_valid = false where store_id = $1", [s, invalid]);
      const down = await seller(s, "SE556677889901", "unavailable");
      await db.query("update commerce.store_tax_profile set vat_number_check_id = $2, vat_number_valid = null where store_id = $1", [s, down]);
      // a number cannot change under a check of another one
      await rejects("update commerce.store_tax_profile set vat_number = 'SE556677889902' where store_id = $1", [s], /tax_profile_check/);
      // saving another number clears the three
      await db.query(
        "update commerce.store_tax_profile set vat_number = 'SE556677889902', vat_number_check_id = null, vat_number_checked_at = null, vat_number_valid = null where store_id = $1",
        [s],
      );
      await rejects("update commerce.store_tax_profile set vat_number_valid = true where store_id = $1", [s], /tax_profile_check/);
      await rejects("update commerce.store_tax_profile set vat_number = null where store_id = $1", [s], /store_tax_profile_vat_check|tax_profile_check/).catch(() => undefined);
    });

    it("cannot be a buyer's check, nor another store's", async () => {
      const s = await fresh("tp-check2", "SE");
      const other = await fresh("tp-check3", "SE");
      await db.query("insert into commerce.store_tax_profile (store_id, vat_number) values ($1, 'SE556677889901')", [s]);
      const buyer = (
        await one<{ id: string }>(
          "insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', 'SE556677889901', 'SE', 'valid', 'vies') returning id",
          [s],
        )
      ).id;
      await rejects("update commerce.store_tax_profile set vat_number_check_id = $2, vat_number_valid = true where store_id = $1", [s, buyer], /tax_profile_check/);
      const foreign = await seller(other, "SE556677889901", "valid");
      await rejects("update commerce.store_tax_profile set vat_number_check_id = $2, vat_number_valid = true where store_id = $1", [s, foreign], /tax_profile_check/);
    });

    it("has no check, result or time without a number", async () => {
      const s = await fresh("tp-check4", "SE");
      await rejects("insert into commerce.store_tax_profile (store_id, vat_number_valid) values ($1, true)", [s], /store_tax_profile_vat_check|tax_profile_check/);
    });
  });

  it("is a settings table in the copy rules, the check log stays behind", () => {
    expect(COPY_RULES.store_tax_profile?.group).toBe("settings");
    expect(COPY_RULES.vat_checks?.group).toBe("never");
  });

  it("is copied by duplicate_store() with its choices and without its numbers; clone_store() copies nothing", async () => {
    const s = await fresh("tp-copy", "SE");
    const check = (
      await one<{ id: string }>(
        "insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'seller', 'SE556677889901', 'SE', 'valid', 'vies') returning id",
        [s],
      )
    ).id;
    await db.query(
      `insert into commerce.store_tax_profile (store_id, vat_registered, vat_number, vat_number_check_id, vat_number_checked_at, vat_number_valid, dispatch_country,
         oss_scheme, oss_member_state, oss_registered_on, ioss_number, ioss_intermediary, ioss_markets, ioss_registered_on)
       values ($1, true, 'SE556677889901', $2, now(), true, 'CN', 'union', 'SE', '2026-07-01', 'IM1234567890', 'Intermediary AB', '{DE,FR}', '2026-08-01')`,
      [s, check],
    );
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, 'tp-copy-dup', 'Copy', $2) as id", [s, owner]);
    expect(await one("select * from commerce.store_tax_profile where store_id = $1", [copy])).toMatchObject({
      vat_registered: true,
      vat_number: null,
      vat_number_check_id: null,
      vat_number_checked_at: null,
      vat_number_valid: null,
      dispatch_country: "CN",
      oss_scheme: "union",
      oss_member_state: "SE",
      oss_number: null,
      oss_registered_on: null,
      ioss_number: null,
      ioss_intermediary: null,
      ioss_markets: ["DE", "FR"],
      ioss_registered_on: null,
      updated_by: owner,
    });
    expect(await scalar("select count(*)::int from commerce.vat_checks where store_id = $1", [copy])).toBe(0);

    const { id: cloned } = await one<{ id: string }>("select commerce.clone_store($1, 'tp-copy-clone', 'Clone', $2) as id", [s, owner]);
    expect(await scalar("select count(*)::int from commerce.store_tax_profile where store_id = $1", [cloned])).toBe(0);

    // a store without a profile has none made up for its copy
    const bare = await fresh("tp-bare", "SE");
    const { id: fromBare } = await one<{ id: string }>("select commerce.duplicate_store($1, 'tp-bare-copy', 'Copy', $2) as id", [bare, owner]);
    expect(await scalar("select count(*)::int from commerce.store_tax_profile where store_id = $1", [fromBare])).toBe(0);
  });
});

describe("the check log", () => {
  const check = async (store: string, over: { number?: string; cart?: string | null } = {}) =>
    (
      await one<{ id: string }>(
        `insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, name, address, request_identifier)
         values ($1, 'buyer', $3, $2, left($2, 2), 'valid', 'vies', 'Muster GmbH', 'Berlin', 'WAPI1') returning id`,
        [store, over.number ?? "DE123456789", over.cart ?? null],
      )
    ).id;

  it("is never changed, whoever asks", async () => {
    const id = await check(shop);
    await rejects("update commerce.vat_checks set status = 'invalid' where id = $1", [id], /vat_check_immutable/);
    await rejects("update commerce.vat_checks set name = null where id = $1", [id], /vat_check_immutable/);
  });

  it("holds numbers of one shape, whose prefix is the country prefix, and short error codes", async () => {
    await rejects("insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', 'DE123456789', 'SE', 'valid', 'vies')", [shop], /vat_checks_number/);
    await rejects("insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', '123', 'DE', 'valid', 'vies')", [shop], /vat_checks_number/);
    await rejects("insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', 'DE123456789', 'DE', 'maybe', 'vies')", [shop], /vat_checks_status/);
    await rejects("insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', 'DE123456789', 'DE', 'valid', 'google')", [shop], /vat_checks_source/);
    await rejects("insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'friend', 'DE123456789', 'DE', 'valid', 'vies')", [shop], /vat_checks_purpose/);
    await rejects("insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source, error) values ($1, 'buyer', 'DE123456789', 'DE', 'unavailable', 'vies', $2)", [shop, "x".repeat(81)], /vat_checks_error/);
  });

  it("can only be pointed at by the store's own cart, and an unused one can go while a used one stays", async () => {
    const other = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('vat-other', 'Other', 'SE') returning id")).id;
    const otherCheck = await check(other);
    const cart = (
      await one<{ id: string }>(
        "insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values ($1, 'DE', 'EUR', 'de-DE', now() + interval '1 day') returning id",
        [shop],
      )
    ).id;
    await rejects("update commerce.carts set vat_number = 'DE123456789', vat_check_id = $2 where id = $1", [cart, otherCheck], /carts_vat_check_fk/);
    const mine = await check(shop, { cart });
    await db.query("update commerce.carts set vat_number = 'DE123456789', vat_check_id = $2 where id = $1", [cart, mine]);
    await rejects("delete from commerce.vat_checks where id = $1", [mine], /carts_vat_check_fk/);
    const unused = await check(shop);
    await db.query("delete from commerce.vat_checks where id = $1", [unused]);
    expect(await scalar("select count(*)::int from commerce.vat_checks where id = $1", [unused])).toBe(0);
    await rejects("update commerce.carts set vat_number = 'de123' where id = $1", [cart], /carts_vat_number/);
  });
});

describe("what an order may hold", () => {
  const order = async (over: {
    status?: string; kind?: string; relief?: number; tax?: number; discount?: number; total?: number; subtotal?: number; shipping?: number;
    treatment?: object | null; checkId?: string | null; shippingRate?: number | null; host?: string | null;
  } = {}) => {
    counter += 1;
    const subtotal = over.subtotal ?? 12_500;
    const shipping = over.shipping ?? 490;
    const discount = over.discount ?? 0;
    return (
      await one<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
           tax_minor, total_minor, billing_address, shipping_address, vat_kind, vat_relief_minor, vat_treatment, vat_check_id, shipping_tax_rate)
         values ($1, $2, 'DE', 'EUR', 'de-DE', 'b@example.com', $3, $4, $5, $6, $7, $8, '{}', '{}', $9, $10, $11::jsonb, $12, $13) returning id`,
        [
          shop, `V-${3000 + counter}`, over.status ?? "pending_payment", subtotal, shipping, discount, over.tax ?? 2598,
          over.total ?? subtotal + shipping - discount, over.kind ?? "standard", over.relief ?? 0,
          over.treatment === undefined ? null : over.treatment === null ? null : JSON.stringify(over.treatment), over.checkId ?? null, over.shippingRate ?? null,
        ],
      )
    ).id;
  };

  it("is a standard order by default, with no relief", async () => {
    const id = await order();
    expect(await one("select vat_kind, vat_relief_minor::int, shipping_tax_rate, vat_treatment, vat_check_id from commerce.orders where id = $1", [id])).toEqual({
      vat_kind: "standard", vat_relief_minor: 0, shipping_tax_rate: null, vat_treatment: null, vat_check_id: null,
    });
  });

  it("is a reverse-charge order only with no VAT and a relief that is part of the discount", async () => {
    // 12 500 + 490 shipping - 2 598 relief = 10 392, nothing charged as VAT
    await order({ kind: "reverse_charge", tax: 0, relief: 2_598, discount: 2_598 });
    await rejects("insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, vat_kind, vat_relief_minor) values ($1, 'V-bad1', 'DE', 'EUR', 'de-DE', 'b@example.com', 12500, 490, 2598, 100, 10392, '{}', '{}', 'reverse_charge', 2598)", [shop], /orders_vat_kind_relief/);
    await rejects("insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, vat_kind, vat_relief_minor) values ($1, 'V-bad2', 'DE', 'EUR', 'de-DE', 'b@example.com', 12500, 490, 0, 0, 12990, '{}', '{}', 'reverse_charge', 0)", [shop], /orders_vat_kind_relief/);
  });

  it("has no relief in a standard or IOSS order", async () => {
    await rejects("insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, vat_kind, vat_relief_minor) values ($1, 'V-bad3', 'DE', 'EUR', 'de-DE', 'b@example.com', 12500, 490, 2598, 0, 10392, '{}', '{}', 'standard', 2598)", [shop], /orders_vat_kind_relief/);
    await rejects("insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, vat_kind, vat_relief_minor) values ($1, 'V-bad4', 'DE', 'EUR', 'de-DE', 'b@example.com', 12500, 490, 2598, 0, 10392, '{}', '{}', 'ioss', 2598)", [shop], /orders_vat_kind_relief/);
    await order({ kind: "ioss", tax: 2598 });
  });

  it("has a relief within its discount, and a kind from the list", async () => {
    await rejects("insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, vat_kind, vat_relief_minor) values ($1, 'V-bad5', 'DE', 'EUR', 'de-DE', 'b@example.com', 12500, 490, 100, 0, 12890, '{}', '{}', 'reverse_charge', 2598)", [shop], /orders_vat_relief/);
    await rejects("insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, vat_kind) values ($1, 'V-bad6', 'DE', 'EUR', 'de-DE', 'b@example.com', 12500, 490, 0, 0, 12990, '{}', '{}', 'exempt')", [shop], /orders_vat_kind/);
    await rejects("insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, shipping_tax_rate) values ($1, 'V-bad7', 'DE', 'EUR', 'de-DE', 'b@example.com', 12500, 490, 0, 0, 12990, '{}', '{}', 1)", [shop], /orders_shipping_tax_rate/);
  });

  it("has a line relief within the line's discount", async () => {
    const id = await order({ kind: "reverse_charge", tax: 0, relief: 2_598, discount: 2_598 });
    await db.query(
      `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, vat_relief_minor)
       values ($1, $2, 'S', 'T', 1, 12500, 2500, 10000, 0, 0.25, 'txcd_99999999', 2500)`,
      [shop, id],
    );
    await rejects(
      `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, vat_relief_minor)
       values ($1, $2, 'S', 'T', 1, 12500, 100, 12400, 0, 0.25, 'txcd_99999999', 2500)`,
      [shop, id],
      /order_lines_vat_relief/,
    );
  });

  it("keeps its treatment while it waits for payment, and then for good", async () => {
    const check = (
      await one<{ id: string }>(
        "insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', 'DE123456789', 'DE', 'valid', 'vies') returning id",
        [shop],
      )
    ).id;
    const id = await order({ kind: "reverse_charge", tax: 0, relief: 2_598, discount: 2_598, treatment: { kind: "reverse_charge" }, checkId: check, shippingRate: 0.25 });
    // while pending it may still be settled
    await db.query("update commerce.orders set vat_treatment = $2::jsonb, shipping_tax_rate = 0.2 where id = $1", [id, JSON.stringify({ kind: "reverse_charge", reason: "reverse_charge" })]);
    await db.query("update commerce.orders set shipping_tax_rate = 0.25 where id = $1", [id]);
    await db.query("update commerce.orders set status = 'paid' where id = $1", [id]);
    for (const set of [
      "vat_treatment = '{}'::jsonb", "vat_treatment = null", "shipping_tax_rate = 0.19", "shipping_tax_rate = null", "vat_check_id = null",
    ]) {
      await rejects(`update commerce.orders set ${set} where id = $1`, [id], /order_vat_frozen/);
    }
    await rejects("update commerce.orders set vat_kind = 'standard', vat_relief_minor = 0, tax_minor = 2598, discount_minor = 0, total_minor = 12990 where id = $1", [id], /order_vat_frozen/);
    // the rest of the order still moves on
    await db.query("update commerce.orders set status = 'fulfilled' where id = $1", [id]);
    // a check an order uses cannot go
    await rejects("delete from commerce.vat_checks where id = $1", [check], /orders_vat_check_fk/);
  });

  it("is refused a check from another store", async () => {
    const other = (await one<{ id: string }>("select id from commerce.stores where slug = 'vat-other'")).id;
    const foreign = (
      await one<{ id: string }>(
        "insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', 'DE123456780', 'DE', 'valid', 'vies') returning id",
        [other],
      )
    ).id;
    await expect(order({ checkId: foreign })).rejects.toThrow(/orders_vat_check_fk/);
  });
});

describe("copied orders (D129)", () => {
  it("carry the kind, relief and shipping rate, never the treatment, a check or a number; the checks hold", async () => {
    const src = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('vat-copy-src', 'Src', 'SE') returning id")).id;
    await db.query(
      `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
       select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'DE'`,
      [src],
    );
    const check = (
      await one<{ id: string }>(
        "insert into commerce.vat_checks (store_id, purpose, number, country_prefix, status, source) values ($1, 'buyer', 'DE123456789', 'DE', 'valid', 'vies') returning id",
        [src],
      )
    ).id;
    const o = (
      await one<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
           tax_minor, total_minor, billing_address, shipping_address, vat_kind, vat_relief_minor, vat_treatment, vat_check_id, shipping_tax_rate, placed_at)
         values ($1, '1001', 'DE', 'EUR', 'de-DE', 'b@example.com', 'paid', 12500, 490, 2598, 0, 10392, '{}', '{}', 'reverse_charge', 2598,
                 '{"kind":"reverse_charge","buyerVatNumber":"DE123456789"}'::jsonb, $2, 0.25, '2026-03-04T10:00:00Z') returning id`,
        [src, check],
      )
    ).id;
    await db.query(
      `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, vat_relief_minor)
       values ($1, $2, 'S', 'T', 1, 12500, 2500, 10000, 0, 0.25, 'txcd_99999999', 2500)`,
      [src, o],
    );
    const copy = (await one<{ id: string }>("select commerce.duplicate_store($1, 'vat-copy-dst', 'Dst', $2) as id", [src, owner])).id;
    await db.query("insert into commerce.store_copies (source_store_id, new_store_id, requested_by, options) values ($1, $2, $3, '{}')", [src, copy, owner]);
    expect(await one("select handled::int, copied::int from commerce.copy_orders($1, $2, null, 10)", [src, copy])).toEqual({ handled: 1, copied: 1 });
    const copied = await one<Record<string, unknown>>("select * from commerce.orders where store_id = $1", [copy]);
    expect(copied).toMatchObject({
      number: "C-1001", vat_kind: "reverse_charge", discount_minor: 2598, vat_relief_minor: 2598, tax_minor: 0, total_minor: 10392,
      vat_treatment: null, vat_check_id: null,
    });
    expect(String(copied.shipping_tax_rate)).toBe("0.2500");
    expect(await scalar("select vat_relief_minor::int from commerce.order_lines where store_id = $1", [copy])).toBe(2500);
    expect(JSON.stringify(copied)).not.toContain("DE123456789");
    expect(await scalar("select count(*)::int from commerce.vat_checks where store_id = $1", [copy])).toBe(0);
  });
});

describe("the migration's own rules", () => {
  it("enables row-level security on every new table, with no policy", async () => {
    for (const table of ["vat_categories", "vat_rates", "shipping_vat_rules", "store_tax_profile", "vat_checks"]) {
      expect([table, await scalar<boolean>("select relrowsecurity from pg_class where oid = ('commerce.' || $1)::regclass", [table])]).toEqual([table, true]);
      expect([table, await scalar<number>("select count(*)::int from pg_policy where polrelid = ('commerce.' || $1)::regclass", [table])]).toEqual([table, 0]);
    }
  });

  it("sets a fixed search_path on every new function, and none of them deletes, truncates or drops", async () => {
    const names = [
      "vat_categories_rules", "vat_rates_rules", "vat_rate", "set_vat_rate", "verify_vat_rate", "sync_standard_vat_rates", "shipping_vat_rule",
      "set_shipping_vat_rule", "store_tax_profile_rules", "vat_checks_immutable", "orders_vat_frozen",
    ];
    const functions = await rows<{ proname: string; def: string; config: string[] | null }>(
      `select p.proname, pg_get_functiondef(p.oid) as def, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'commerce' and p.proname = any($1)`,
      [names],
    );
    expect(new Set(functions.map((f) => f.proname))).toEqual(new Set(names));
    for (const f of functions) {
      expect([f.proname, (f.config ?? []).some((c) => c.startsWith("search_path="))]).toEqual([f.proname, true]);
      expect([f.proname, /\b(delete|truncate|drop)\b/i.test(f.def.replace(/--.*$/gm, "").replace(/'DELETE'/g, "''"))]).toEqual([f.proname, false]);
    }
  });

  it("has an index for every new foreign key", async () => {
    const missing = await rows<{ conrelid: string; conname: string }>(
      `select c.conrelid::regclass::text as conrelid, c.conname
         from pg_constraint c
        where c.contype = 'f' and c.conname in (
          'vat_rates_category_vat_categories_code_fk', 'vat_rates_verified_by_accounts_id_fk', 'vat_rates_created_by_accounts_id_fk',
          'vat_categories_updated_by_accounts_id_fk', 'shipping_vat_rules_verified_by_accounts_id_fk', 'store_tax_profile_updated_by_accounts_id_fk',
          'store_tax_profile_oss_member_state_countries_code_fk', 'store_tax_profile_vat_check_fk', 'carts_vat_check_fk', 'orders_vat_check_fk',
          'products_vat_category_fk', 'vat_checks_store_id_stores_id_fk')
          and not exists (
            select 1 from pg_index i
             where i.indrelid = c.conrelid and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
          )`,
    );
    // a foreign key on the primary key's own column (a one-row-per-store table) is covered by the key
    expect(missing).toEqual([]);
  });
});

/** Every migration but the two tax ones, then data of the old shape, then the tax migrations: nothing is lost. */
describe("the tax migrations on a database that has data", () => {
  let old: PGlite;

  beforeAll(async () => {
    old = new PGlite({ extensions: { pg_trgm, vector } });
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const tax = files.filter((f) => /_tax_engine(_rules)?\.sql$/.test(f));
    expect(tax).toHaveLength(2);
    for (const file of files.filter((f) => !tax.includes(f))) await old.exec(await readFile(path.join(dir, file), "utf8"));

    const q = async <T>(sql: string, params: unknown[] = []) => (await old.query<T>(sql, params)).rows[0];
    const store = (await q<{ id: string }>("insert into commerce.stores (slug, name, country) values ('old-shop', 'Old', 'SE') returning id")).id;
    await old.query(
      `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
       select $1, code, currency, default_locale, locales, true from commerce.countries where code in ('DE', 'NO', 'SE')`,
      [store],
    );
    for (const [handle, category] of [["old-standard", "standard"], ["old-stay", "accommodation"], ["old-health", "exempt"]]) {
      await old.query("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, $2, 'txcd_99999999', $3)", [store, handle, category]);
    }
    const order = (number: string, market: string, over: { host?: boolean; copied?: boolean; tax?: number } = {}) =>
      old.query(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
           tax_minor, total_minor, billing_address, shipping_address, copied_from)
         values ($1, $2, $3, 'EUR', 'de-DE', 'b@example.com', 'paid', 1000, 100, 0, $4, 1100, '{}', '{}', $5)`,
        [store, number, market, over.tax ?? 220, over.copied ? "11111111-1111-4111-8111-111111111111" : null],
      );
    await order("1001", "DE");
    await order("1002", "NO");
    await order("C-1003", "SE", { copied: true });
    await old.exec(await readFile(path.join(dir, tax[0]), "utf8"));
    await old.exec(await readFile(path.join(dir, tax[1]), "utf8"));
  });

  afterAll(async () => {
    await old.close();
  });

  it("keeps every product with its category", async () => {
    const r = await old.query<{ handle: string; vat_category: string }>("select handle, vat_category from commerce.products order by handle");
    expect(r.rows).toEqual([
      { handle: "old-health", vat_category: "exempt" },
      { handle: "old-standard", vat_category: "standard" },
      { handle: "old-stay", vat_category: "accommodation" },
    ]);
  });

  it("gives the old accommodation rows a start, a source and a date, unverified", async () => {
    const r = await old.query<{ country_code: string; rate: string; valid_from: string; valid_to: string | null; verified_at: string | null; source: string }>(
      "select country_code, rate::text, valid_from::text, valid_to::text, verified_at, source from commerce.vat_rates where category = 'accommodation' order by country_code",
    );
    expect(r.rows.map((x) => [x.country_code, x.rate, x.valid_from, x.valid_to, x.verified_at])).toEqual([
      ["DE", "0.0700", "2026-01-01", null, null],
      ["NO", "0.1200", "2026-01-01", null, null],
      ["SE", "0.1200", "2026-01-01", null, null],
    ]);
    expect(r.rows.every((x) => x.source.length >= 8)).toBe(true);
  });

  it("records the rate shipping was charged at on orders already placed, leaving copied orders alone", async () => {
    const r = await old.query<{ number: string; shipping_tax_rate: string | null }>("select number, shipping_tax_rate::text from commerce.orders order by number");
    expect(r.rows).toEqual([
      { number: "1001", shipping_tax_rate: "0.1900" },
      { number: "1002", shipping_tax_rate: "0.2500" },
      { number: "C-1003", shipping_tax_rate: null },
    ]);
  });

  it("leaves old orders standard, with no relief", async () => {
    const r = await old.query<{ vat_kind: string; vat_relief_minor: string }>("select vat_kind, vat_relief_minor::text from commerce.orders");
    expect(r.rows.every((x) => x.vat_kind === "standard" && x.vat_relief_minor === "0")).toBe(true);
  });

  it("gives the same rate as before for every category a product could have had", async () => {
    const r = await old.query<{ c: string; d: string; rate: string }>(
      `select c.code as c, k as d, commerce.vat_rate(c.code, k)::text as rate
         from commerce.countries c, unnest(array['standard', 'accommodation', 'exempt']) k where c.code in ('NO', 'SE', 'DE', 'DK')`,
    );
    const rate = (country: string, category: string) => r.rows.find((x) => x.c === country && x.d === category)?.rate;
    expect(rate("NO", "accommodation")).toBe("0.1200");
    expect(rate("SE", "accommodation")).toBe("0.1200");
    expect(rate("DE", "accommodation")).toBe("0.0700");
    expect(rate("DK", "accommodation")).toBe("0.2500");
    expect(rate("DE", "standard")).toBe("0.1900");
    expect(rate("NO", "exempt")).toBe("0");
  });
});
