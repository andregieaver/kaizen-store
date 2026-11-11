/**
 * Drop shipping (D550, `docs/drop-shipping.md`): what a supplier that sends the store's goods is, as typed by staff, and the fixed numbers
 * around it. Pure; `src/server/suppliers.ts` is the only writer and applies these rules again.
 */

import { z } from "zod";

import { DOCUMENT_LANGUAGES, type DocumentLanguage } from "./invoice-text";

/** Suppliers that drop-ship for one store. */
export const DROP_SHIP_SUPPLIERS_MAX = 50;

/**
 * A supplier location's rank (`inventory_locations.priority`): above every own location (those are renumbered 1..n, at most 20), so every reader
 * that takes stock by rank takes it from the store's own places first and from a supplier after them.
 */
export const SUPPLIER_PRIORITY_BASE = 100_000;

export const ORDER_METHODS = ["email", "connected", "file"] as const;
export type OrderMethod = (typeof ORDER_METHODS)[number];

/** The languages a supplier's orders are written in: those the store's documents have. */
export const ORDER_LANGUAGES: readonly DocumentLanguage[] = DOCUMENT_LANGUAGES;

/** EU member states: a supplier shipping from anywhere else sends goods that cross a customs border into the EU (D343, IOSS D157). */
export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const REGIONS = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

/** Codes the runtime names that are not countries a parcel is sent from (unions, zones, CLDR's own and test regions). */
const NOT_COUNTRIES = new Set(["AC", "CP", "DG", "EA", "EU", "EZ", "IC", "QO", "TA", "UN", "XA", "XB", "ZZ"]);

/** Whether a code is a country (ISO 3166-1 alpha-2) anywhere in the world: a supplier may ship from outside the countries the store sells to. */
export const isCountryCode = (code: string): boolean => /^[A-Z]{2}$/.test(code) && !NOT_COUNTRIES.has(code) && (REGIONS.of(code) ?? code) !== code;

/** Every country a supplier can ship from, by English name, for the admin's list. */
export function supplierCountries(): { code: string; name: string }[] {
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (isCountryCode(code)) out.push({ code, name: countryName(code) });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, "en"));
}

/** The English name of a country, for the admin's lists; the code when unknown. */
export const countryName = (code: string): string => REGIONS.of(code) ?? code;

/** Whether a supplier's parcels come from outside the EU (flagged to the owner: customs, import VAT and a longer wait). */
export const shipsFromOutsideEu = (country: string): boolean => !EU_COUNTRIES.has(country.toUpperCase());

const trimmed = (max: number, words: string) => z.string().trim().max(max, words);

export const supplierInput = z.object({
  name: z.string().trim().min(1, "Give the supplier a name.").max(120, "A name is at most 120 characters."),
  orderEmail: z.string().trim().toLowerCase().max(254, "Check the email address.").regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Check the email address."),
  shipsFrom: z.string().trim().toUpperCase().refine(isCountryCode, "Choose the country it ships from."),
  orderLanguage: z.enum(ORDER_LANGUAGES as [DocumentLanguage, ...DocumentLanguage[]]).default("en"),
  dispatchDays: z.coerce.number().int("Whole days.").min(1, "Between 1 and 30 days.").max(30, "Between 1 and 30 days.").default(2),
  orderMethod: z.enum(ORDER_METHODS).default("email"),
  /** Where returns of its goods go (D562): all five parts, so a carrier can make the label, or none for the store's own address. */
  returnName: trimmed(120, "A name is at most 120 characters.").default(""),
  returnStreet: trimmed(200, "A street is at most 200 characters.").default(""),
  returnPostalCode: trimmed(20, "A postal code is at most 20 characters.").default(""),
  returnCity: trimmed(100, "A city is at most 100 characters.").default(""),
  returnCountry: z.string().trim().toUpperCase().default(""),
  orderNote: trimmed(500, "A note is at most 500 characters.").default(""),
  /** Its stock is kept topped up (D553): for a supplier that always has the goods. */
  alwaysAvailable: z.union([z.boolean(), z.literal("on"), z.literal("")]).transform((v) => v === true || v === "on").default(false),
})
  .superRefine((v, ctx) => {
    const parts = [v.returnName, v.returnStreet, v.returnPostalCode, v.returnCity, v.returnCountry];
    if (parts.every((p) => p === "")) return;
    if (parts.some((p) => p === "")) ctx.addIssue({ code: "custom", path: ["returnStreet"], message: "Fill in the whole return address, or leave all of it empty." });
    else if (!isCountryCode(v.returnCountry)) ctx.addIssue({ code: "custom", path: ["returnCountry"], message: "Choose the return address's country." });
  })
  .transform(({ returnName, returnStreet, returnPostalCode, returnCity, returnCountry, ...rest }) => ({
    ...rest,
    returnTo: returnStreet ? { name: returnName, street: returnStreet, postalCode: returnPostalCode, city: returnCity, country: returnCountry } : null,
  }));
export type SupplierInput = z.infer<typeof supplierInput>;

/** A supplier's return address as kept (D562), or null unless every part is there. */
export function readReturnTo(value: unknown): { name: string; street: string; postalCode: string; city: string; country: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === "string" ? (v[key] as string).trim() : "");
  const out = { name: text("name"), street: text("street"), postalCode: text("postalCode"), city: text("city"), country: text("country").toUpperCase() };
  return Object.values(out).every((p) => p !== "") ? out : null;
}

/** The supplier location's name: the supplier's, cut to the 60 characters a location name may have. */
export const supplierLocationName = (name: string): string => name.trim().replace(/\s+/g, " ").slice(0, 60);

/** The working days a drop-shipped parcel takes on top of the shipping method's own time: the slowest supplier in the cart. */
export const extraDispatchDays = (suppliers: readonly { dispatchDays: number }[]): number =>
  suppliers.reduce((most, s) => Math.max(most, s.dispatchDays), 0);
