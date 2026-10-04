/**
 * Which VAT rate a product takes (D65, D157): its category, a row of `commerce.vat_categories` (platform admins add and
 * switch off categories; owners choose). `standard`, `exempt` and `accommodation` are built in. A country's rate for a
 * category is `commerce.vat_rate(country, category, at)`, which has history and answers the standard rate where a country
 * has no row for a category. This file holds only what needs no database: the built-in categories, the shape of a
 * category's code, and how a rate is described to people.
 */
export const VAT_CATEGORIES = ["standard", "accommodation", "exempt"] as const;
/** The three categories that are always there (never renamed, never switched off). */
export const BUILT_IN_VAT_CATEGORIES = VAT_CATEGORIES;
export type BuiltInVatCategory = (typeof BUILT_IN_VAT_CATEGORIES)[number];
/** A category's code: a row of `vat_categories` (`food`, `books`, ...), checked against the database where it is saved. */
export type VatCategory = string;

export const VAT_CATEGORY_CODE = /^[a-z][a-z0-9_]{1,30}$/;
export const VAT_CATEGORY_NAME_MAX = 60;
export const VAT_CATEGORY_DESCRIPTION_MAX = 200;

export const isBuiltInVatCategory = (code: string): code is BuiltInVatCategory => (BUILT_IN_VAT_CATEGORIES as readonly string[]).includes(code);

/** What a row of `vat_categories` holds, as the server reads it. */
export type VatCategoryRow = {
  code: string;
  nameEn: string;
  description: string;
  sort: number;
  active: boolean;
  builtIn: boolean;
};

export const VAT_CATEGORY_LABELS: Record<BuiltInVatCategory, { label: string; hint: string }> = {
  standard: { label: "Standard rate", hint: "Most goods and services." },
  accommodation: { label: "Accommodation", hint: "Hotel rooms, holiday homes and camping: a reduced rate where the country has one." },
  exempt: { label: "Exempt from VAT", hint: "No VAT, such as health care. Check with your accountant that it applies to you." },
};

/**
 * A value read from the database or a form as a category code: itself when it has the shape of one, else `standard`.
 * Whether the category exists is the foreign key's; pass `known` to check it here too.
 */
export const parseVatCategory = (value: unknown, known?: readonly string[]): VatCategory => {
  if (typeof value !== "string" || !VAT_CATEGORY_CODE.test(value)) return "standard";
  return known && !known.includes(value) ? "standard" : value;
};

/** A rate as a percentage for people, e.g. 0.255 → "25.5 %". */
export const ratePercent = (rate: number) => `${Math.round(rate * 1000) / 10} %`;

/**
 * How a category's rate in a country is described (the product editor's hint, the platform's coverage page): the rate,
 * and whether it is the standard rate because no reduced rate is known there, never silently a different number.
 */
export function describeRate(args: { category: string; rate: number; standardRate: number; hasRow: boolean }): { text: string; fallback: boolean } {
  if (args.category === "exempt") return { text: "no VAT", fallback: false };
  if (args.category === "standard") return { text: ratePercent(args.rate), fallback: false };
  if (!args.hasRow) return { text: `no reduced rate known here: the standard rate (${ratePercent(args.standardRate)}) applies`, fallback: true };
  return { text: ratePercent(args.rate), fallback: false };
}

/** The categories an owner can choose for a product of a kind: `accommodation` only for stays and rentals; inactive ones only when the product already has one. */
export function categoriesFor(
  categories: readonly VatCategoryRow[],
  options: { kind: string; current: string },
): (VatCategoryRow & { inactive: boolean })[] {
  return categories
    .filter((c) => (c.active || c.code === options.current) && (c.code !== "accommodation" || ["stay", "rental"].includes(options.kind) || c.code === options.current))
    .map((c) => ({ ...c, inactive: !c.active }))
    .sort((a, b) => a.sort - b.sort || a.nameEn.localeCompare(b.nameEn));
}
