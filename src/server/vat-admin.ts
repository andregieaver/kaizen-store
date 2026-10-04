import "server-only";

import { revalidateTag, updateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { SHIPPING_VAT_RULES } from "@/lib/shipping-vat";
import {
  VAT_CATEGORY_CODE,
  VAT_CATEGORY_DESCRIPTION_MAX,
  VAT_CATEGORY_NAME_MAX,
  describeRate,
  type VatCategoryRow,
} from "@/lib/vat";

import { audit, type Account } from "./auth";
import { CATALOG_TAG } from "./catalog";
import { listVatCategories, ratesNow } from "./vat-categories";

type Row = Record<string, unknown>;

/**
 * The platform's VAT administration (D157, docs/wave-1a-tax.md section 2.3): categories, rates with history, who verified
 * them, the coverage of the reduced rates and the shipping VAT rule per country. Platform admins only (each function checks
 * for itself, as every platform action does); a store cannot change any of it. Rates are written only by
 * `commerce.set_vat_rate()` (the old period ends and a new one begins, never an edit in place), which writes its own audit
 * entry; a change applies to new carts and orders only, and refreshes the catalogue's cached prices.
 */

export type VatAdminResult<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

const refuse = (...problems: string[]): { ok: false; problems: string[] } => ({ ok: false, problems });
const NOT_ADMIN = "Only a platform admin can change VAT.";

/** A rate's change reaches shoppers' cached prices: refreshed in an action at once, by revalidation elsewhere. */
function refreshCatalogue(): void {
  try {
    updateTag(CATALOG_TAG);
  } catch {
    revalidateTag(CATALOG_TAG, "max");
  }
}

/** The database's own words for a refused rate or rule (`vat_rate_*`, `shipping_vat_*`), kept as the message. */
function databaseMessage(error: unknown): string | null {
  const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : String(error);
  const match = /(vat_rate_[a-z]+|vat_category_[a-z_]+|shipping_vat_[a-z]+): ([^\n]*)/.exec(text);
  return match ? match[2].replace(/\s+/g, " ").trim() : null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categoryInput = z.object({
  code: z.string().trim().regex(VAT_CATEGORY_CODE, "The code is lower-case letters, digits and underscores, starting with a letter (2 to 31 characters)."),
  nameEn: z.string().trim().min(1, "Give the category a name.").max(VAT_CATEGORY_NAME_MAX, `The name is at most ${VAT_CATEGORY_NAME_MAX} characters.`),
  description: z.string().trim().max(VAT_CATEGORY_DESCRIPTION_MAX, `The description is at most ${VAT_CATEGORY_DESCRIPTION_MAX} characters.`).default(""),
  sort: z.coerce.number().int().min(0).max(10_000).default(100),
});

/** Adds a reduced-rate category. A category is never deleted afterwards, only switched off. Audit: `vat.category_added`. */
export async function addVatCategory(account: Account, raw: unknown): Promise<VatAdminResult<{ category: VatCategoryRow }>> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  const parsed = categoryInput.safeParse(raw);
  if (!parsed.success) return refuse(...new Set(parsed.error.issues.map((issue) => issue.message)));
  const { code, nameEn, description, sort } = parsed.data;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.vat_categories (code, name_en, description, sort, active, built_in, updated_by)
    values (${code}, ${nameEn}, ${description}, ${sort}, true, false, ${account.id}::uuid)
    on conflict (code) do nothing
    returning code, name_en, description, sort, active, built_in
  `);
  if (!row) return refuse(`There is already a category with the code "${code}".`);
  await audit(account.id, null, "vat.category_added", { code, name: nameEn, sort });
  refreshCatalogue();
  return { ok: true, category: { code, nameEn, description, sort, active: true, builtIn: false } };
}

/** Switches a category on or off (the built-in ones cannot be switched off). Products keep a category that was switched off. Audit: `vat.category_active`. */
export async function setVatCategoryActive(account: Account, code: string, active: boolean): Promise<VatAdminResult> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.vat_categories set active = ${active}, updated_by = ${account.id}::uuid
      where code = ${code} returning code
    `);
    if (!row) return refuse("There is no such category.");
  } catch (error) {
    const message = databaseMessage(error);
    if (!message) throw error;
    return refuse(message);
  }
  await audit(account.id, null, "vat.category_active", { code, active });
  refreshCatalogue();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = z.string().trim().regex(DATE, "Use a date as year-month-day.");

const rateInput = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country."),
  category: z.string().trim().regex(VAT_CATEGORY_CODE, "Choose a category."),
  /** The rate as a percentage, such as 25.5: three decimals at most. */
  ratePercent: z.coerce.number().min(0, "A rate is at least 0 %.").lt(100, "A rate is below 100 %."),
  validFrom: day,
  source: z.string().trim().min(8, "Say where the rate comes from: a web address or the name of the act (at least 8 characters).").max(400, "The source is at most 400 characters."),
  checkedOn: day,
  note: z.string().trim().max(400, "The note is at most 400 characters.").default(""),
});

/** A percentage as the fraction the database keeps (four decimals), without floating point noise. */
export const percentToRate = (percent: number): number => Math.round(percent * 100) / 10_000;

/**
 * Sets a country's rate for a category from a date: the old period ends on that day and a new one begins (`commerce.set_vat_rate()`,
 * the only writer). A date in the future is a scheduled change; a date that is not after the latest period's start is refused.
 * The new rate starts unverified. Audit: `vat.rate_set`, written by the function.
 */
export async function setVatRate(account: Account, raw: unknown): Promise<VatAdminResult> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  const parsed = rateInput.safeParse(raw);
  if (!parsed.success) return refuse(...new Set(parsed.error.issues.map((issue) => issue.message)));
  const v = parsed.data;
  if (Math.round(v.ratePercent * 1000) / 1000 !== v.ratePercent) return refuse("Use at most three decimals.");
  try {
    await db().execute(sql`
      select commerce.set_vat_rate(${v.country}, ${v.category}, ${percentToRate(v.ratePercent)}::numeric, ${v.validFrom}::date,
        ${v.source}, ${v.checkedOn}::date, ${v.note}, ${account.id}::uuid)
    `);
  } catch (error) {
    const message = databaseMessage(error);
    if (!message) throw error;
    return refuse(message);
  }
  refreshCatalogue();
  return { ok: true };
}

/** Records that a person has checked a rate (with an accountant): who and when, once. Audit: `vat.rate_verified`, written by the function. */
export async function verifyVatRate(account: Account, input: { country: string; category: string; validFrom: string }): Promise<VatAdminResult> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  if (!DATE.test(input.validFrom)) return refuse("Use a date as year-month-day.");
  try {
    await db().execute(sql`
      select commerce.verify_vat_rate(${input.country.toUpperCase()}, ${input.category}, ${input.validFrom}::date, ${account.id}::uuid)
    `);
  } catch (error) {
    const message = databaseMessage(error);
    if (!message) throw error;
    return refuse(message);
  }
  return { ok: true };
}

export type VatRateRow = {
  country: string;
  category: string;
  rate: number;
  validFrom: string;
  /** The first day it no longer applies; null while it is the current one. */
  validTo: string | null;
  source: string;
  checkedOn: string;
  note: string;
  verified: { at: string; by: string | null } | null;
  /** In force today in the country (its own date), not yet started, or ended. */
  state: "current" | "scheduled" | "ended";
};

/** Every rate row, the unverified ones first when asked, with its state today. `country` and `category` narrow it. */
export async function listVatRates(filter: { country?: string; category?: string; unverifiedOnly?: boolean } = {}): Promise<VatRateRow[]> {
  const rows = await db().execute<Row>(sql`
    select r.country_code::text as country, r.category, r.rate, r.valid_from::text as valid_from, r.valid_to::text as valid_to,
      r.source, r.checked_on::text as checked_on, r.note, r.verified_at, a.name as verified_by_name, a.email as verified_by_email,
      case when r.valid_from > (now() at time zone coalesce(c.time_zone, 'UTC'))::date then 'scheduled'
           when r.valid_to is not null and r.valid_to <= (now() at time zone coalesce(c.time_zone, 'UTC'))::date then 'ended'
           else 'current' end as state
    from commerce.vat_rates r
    join commerce.countries c on c.code = r.country_code
    left join commerce.accounts a on a.id = r.verified_by
    where (${filter.country ?? null}::text is null or r.country_code = ${filter.country?.toUpperCase() ?? null})
      and (${filter.category ?? null}::text is null or r.category = ${filter.category ?? null})
      and (not ${filter.unverifiedOnly === true} or r.verified_at is null)
    order by r.country_code, r.category, r.valid_from desc
  `);
  return rows.map((row) => ({
    country: String(row.country).trim(),
    category: String(row.category),
    rate: Number(row.rate),
    validFrom: String(row.valid_from),
    validTo: row.valid_to ? String(row.valid_to) : null,
    source: String(row.source),
    checkedOn: String(row.checked_on),
    note: String(row.note ?? ""),
    verified: row.verified_at ? { at: new Date(String(row.verified_at)).toISOString(), by: row.verified_by_name ? String(row.verified_by_name) : row.verified_by_email ? String(row.verified_by_email) : null } : null,
    state: row.state === "scheduled" ? "scheduled" : row.state === "ended" ? "ended" : "current",
  }));
}

/** The rates nobody has verified yet, current and scheduled ones (an ended period is history): the list to work through with an accountant. */
export async function unverifiedRates(): Promise<VatRateRow[]> {
  return (await listVatRates({ unverifiedOnly: true })).filter((row) => row.state !== "ended");
}

export type CoverageCell = { rate: number; hasRow: boolean; text: string; fallback: boolean; verified: boolean };
export type CoverageCountry = { code: string; name: string; inUse: boolean; cells: Record<string, CoverageCell> };

/**
 * Category by country, each cell the rate or *no reduced rate known here: the standard rate (X %) applies*; the countries any
 * store with an active market sells to come first. `verified` is whether the row in force has been verified.
 */
export async function vatCoverage(): Promise<{ categories: VatCategoryRow[]; countries: CoverageCountry[] }> {
  const [categories, rates, countries, verified] = await Promise.all([
    listVatCategories(),
    ratesNow(),
    db().execute<Row>(sql`
      select c.code::text as code, c.name,
        exists (select 1 from commerce.markets m join commerce.stores s on s.id = m.store_id
                where m.code = c.code and m.active and s.status <> 'closed' and not s.is_template) as in_use
      from commerce.countries c
    `),
    db().execute<Row>(sql`
      select r.country_code::text as country, r.category
      from commerce.vat_rates r join commerce.countries c on c.code = r.country_code
      where r.verified_at is not null
        and r.valid_from <= (now() at time zone coalesce(c.time_zone, 'UTC'))::date
        and (r.valid_to is null or r.valid_to > (now() at time zone coalesce(c.time_zone, 'UTC'))::date)
    `),
  ]);
  const verifiedKeys = new Set(verified.map((row) => `${String(row.country).trim()}:${row.category}`));
  const out: CoverageCountry[] = countries.map((country) => {
    const code = String(country.code).trim();
    const standard = rates[code]?.standard?.rate ?? 0;
    const cells: Record<string, CoverageCell> = {};
    for (const category of categories) {
      const cell = rates[code]?.[category.code] ?? { rate: category.code === "exempt" ? 0 : standard, hasRow: false };
      const described = describeRate({ category: category.code, rate: cell.rate, standardRate: standard, hasRow: cell.hasRow });
      cells[category.code] = { ...cell, text: described.text, fallback: described.fallback, verified: category.code === "exempt" || verifiedKeys.has(`${code}:${category.code}`) };
    }
    return { code, name: String(country.name), inUse: country.in_use === true, cells };
  });
  return { categories, countries: out.sort((a, b) => Number(b.inUse) - Number(a.inUse) || a.name.localeCompare(b.name)) };
}

// ---------------------------------------------------------------------------
// Shipping VAT rules
// ---------------------------------------------------------------------------

const shippingRuleInput = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country."),
  rule: z.enum(SHIPPING_VAT_RULES, "Choose a rule."),
  source: z.string().trim().max(400, "The source is at most 400 characters.").default(""),
  checkedOn: day.nullable().default(null),
  note: z.string().trim().max(400, "The note is at most 400 characters.").default(""),
  verified: z.coerce.boolean().default(false),
});

/**
 * Sets how shipping is taxed in a country. Only a rule that is *verified* (with its source, the date checked and the person)
 * ever changes what is charged; saving without verifying records it as a draft that is ignored. Any change replaces the
 * verification. Audit: `vat.shipping_rule_set`, written by `commerce.set_shipping_vat_rule()`.
 */
export async function setShippingVatRule(account: Account, raw: unknown): Promise<VatAdminResult> {
  if (!account.platformAdmin) return refuse(NOT_ADMIN);
  const parsed = shippingRuleInput.safeParse(raw);
  if (!parsed.success) return refuse(...new Set(parsed.error.issues.map((issue) => issue.message)));
  const v = parsed.data;
  if (v.verified && (v.source.length < 8 || !v.checkedOn)) return refuse("A verified rule names its source (a web address or an act) and the date it was checked.");
  try {
    await db().execute(sql`
      select commerce.set_shipping_vat_rule(${v.country}, ${v.rule}, ${v.source}, ${v.checkedOn}::date, ${v.note}, ${v.verified}, ${account.id}::uuid)
    `);
  } catch (error) {
    const message = databaseMessage(error);
    if (!message) throw error;
    return refuse(message);
  }
  return { ok: true };
}

export type ShippingRuleRow = {
  country: string;
  name: string;
  rule: (typeof SHIPPING_VAT_RULES)[number];
  source: string;
  checkedOn: string | null;
  note: string;
  verified: boolean;
  /** What is actually applied: the rule when verified, else `standard`. */
  applied: (typeof SHIPPING_VAT_RULES)[number];
};

export async function listShippingVatRules(): Promise<ShippingRuleRow[]> {
  const rows = await db().execute<Row>(sql`
    select c.code::text as country, c.name, s.rule, s.source, s.checked_on::text as checked_on, s.note, s.verified_at,
      commerce.shipping_vat_rule(c.code) as applied
    from commerce.countries c left join commerce.shipping_vat_rules s on s.country_code = c.code
    order by c.name
  `);
  const rule = (v: unknown) => (SHIPPING_VAT_RULES as readonly string[]).includes(String(v)) ? (String(v) as ShippingRuleRow["rule"]) : "standard";
  return rows.map((row) => ({
    country: String(row.country).trim(),
    name: String(row.name),
    rule: rule(row.rule),
    source: String(row.source ?? ""),
    checkedOn: row.checked_on ? String(row.checked_on) : null,
    note: String(row.note ?? ""),
    verified: Boolean(row.verified_at),
    applied: rule(row.applied),
  }));
}

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

/**
 * Daily: the countries' cached standard rate follows the `standard` category's rate in force today (`commerce.sync_standard_vat_rates()`),
 * so a change dated in the future takes effect on its day, and the catalogue's cached prices are refreshed when one changed. The
 * catalogue also carries each product's rate (the "incl. VAT x %" label and the business buyer's price without VAT), cached for
 * hours, while the cart reads the rate in force per request; a rate of ANY category that began or ended in the last two days
 * (the country's own dates) therefore refreshes the catalogue too, so a scheduled change does not leave the label on the old
 * rate. The refresh happens when the job runs (the cron's schedule), not at the stroke of the country's midnight: until then the
 * cached label can still show the old rate, for up to the cache's lifetime. Never throws: how many countries' standard rate
 * changed, and how many rates began or ended lately, are returned.
 */
export async function syncStandardRates(): Promise<{ changed: number; recent: number }> {
  try {
    const [row] = await db().execute<Row>(sql`select commerce.sync_standard_vat_rates() as changed`);
    const changed = Number(row?.changed ?? 0);
    const [lately] = await db().execute<Row>(sql`
      select count(*)::int as n
      from commerce.vat_rates r join commerce.countries c on c.code = r.country_code
      where r.valid_from between ((now() at time zone coalesce(c.time_zone, 'UTC'))::date - 2) and (now() at time zone coalesce(c.time_zone, 'UTC'))::date
         or r.valid_to between ((now() at time zone coalesce(c.time_zone, 'UTC'))::date - 2) and (now() at time zone coalesce(c.time_zone, 'UTC'))::date
    `);
    const recent = Number(lately?.n ?? 0);
    if (changed > 0 || recent > 0) revalidateTag(CATALOG_TAG, "max");
    return { changed, recent };
  } catch {
    return { changed: 0, recent: 0 };
  }
}
