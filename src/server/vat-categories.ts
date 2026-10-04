import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { VatCategoryRow } from "@/lib/vat";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Reads of the VAT categories and of the rates in force (D157, docs/wave-1a-tax.md sections 3.1 and 3.2). The product editor's
 * select, the platform's coverage page and the order flow's rate hints read through here. A product's rate itself is only ever
 * `commerce.vat_rate(country, category, at)` in SQL; this module is one of the few that also reads `commerce.vat_rates`,
 * to tell a rate that exists from one that is the standard rate by fallback (`src/lib/vat-readers.test.ts` lists them).
 *
 * Not cached: nothing on a shopper's side reads these (the catalogue's cached `PriceView.vat` is refreshed through the
 * catalogue tags when a rate changes), and the admin reads are a few small queries.
 */

export const toCategory = (row: Row): VatCategoryRow => ({
  code: String(row.code),
  nameEn: String(row.name_en),
  description: String(row.description ?? ""),
  sort: Number(row.sort ?? 0),
  active: row.active === true,
  builtIn: row.built_in === true,
});

/** Every category, in the order they are offered. */
export async function listVatCategories(runner: Runner = db()): Promise<VatCategoryRow[]> {
  const rows = await runner.execute<Row>(sql`
    select code, name_en, description, sort, active, built_in from commerce.vat_categories order by sort, name_en
  `);
  return rows.map(toCategory);
}

export type CountryRates = Record<string, { rate: number; hasRow: boolean }>;

/**
 * Every country's rate for every category now, and whether a row of its own makes it (else it is the standard rate, or 0 for
 * `exempt`): `{ NO: { standard: { rate: 0.25, hasRow: true }, food: { rate: 0.15, hasRow: true }, ... } }`.
 */
export async function ratesNow(runner: Runner = db()): Promise<Record<string, CountryRates>> {
  const rows = await runner.execute<Row>(sql`
    select c.code as country, k.code as category, commerce.vat_rate(c.code, k.code) as rate,
      exists (
        select 1 from commerce.vat_rates r
        where r.country_code = c.code and r.category = k.code
          and r.valid_from <= (now() at time zone coalesce(c.time_zone, 'UTC'))::date
          and (r.valid_to is null or r.valid_to > (now() at time zone coalesce(c.time_zone, 'UTC'))::date)
      ) as has_row
    from commerce.countries c cross join commerce.vat_categories k
  `);
  const out: Record<string, CountryRates> = {};
  for (const row of rows) {
    const country = String(row.country).trim();
    (out[country] ??= {})[String(row.category)] = { rate: Number(row.rate ?? 0), hasRow: row.has_row === true };
  }
  return out;
}
