/**
 * Selling to businesses (B2B). A store sells to consumers, to businesses or
 * to both (`stores.audience`). Prices are always kept with VAT and VAT is
 * always charged; businesses see them without it. In a store selling to
 * both, each shopper is a private or a business buyer, as chosen with the
 * header's switch or the first-visit question, and kept in a necessary
 * cookie; products can be for everyone, only private shoppers or only
 * businesses (`products.audience`). Buying a business-only product, or
 * anything in a store that sells only to businesses, takes the company's
 * name and organisation number.
 */
import { vatIncluded } from "./checkout";

export const STORE_AUDIENCES = ["consumers", "businesses", "both"] as const;
export type StoreAudience = (typeof STORE_AUDIENCES)[number];

export const PRODUCT_AUDIENCES = ["all", "consumers", "businesses"] as const;
export type ProductAudience = (typeof PRODUCT_AUDIENCES)[number];

export type Buyer = "private" | "business";

export const parseStoreAudience = (value: unknown): StoreAudience =>
  STORE_AUDIENCES.includes(value as StoreAudience) ? (value as StoreAudience) : "consumers";

export const parseProductAudience = (value: unknown): ProductAudience =>
  PRODUCT_AUDIENCES.includes(value as ProductAudience) ? (value as ProductAudience) : "all";

/** The shopper's choice in a store selling to both: necessary, read by the page's first script. */
export const buyerCookie = (storeId: string) => `buyer_${storeId}`;
export const BUYER_DAYS = 365;

export const parseBuyer = (value: unknown): Buyer | null =>
  value === "business" || value === "private" ? value : null;

/** Who the store's pages are for: its only audience, else the shopper's choice (private until chosen). */
export function storeBuyer(audience: StoreAudience, chosen: Buyer | null): Buyer {
  if (audience === "consumers") return "private";
  if (audience === "businesses") return "business";
  return chosen ?? "private";
}

/** How prices are shown: with VAT, without, or as the shopper chooses (both in the page, one shown). */
export type VatShown = "incl" | "excl" | "choice";

export function vatShown(audience: StoreAudience): VatShown {
  return audience === "businesses" ? "excl" : audience === "both" ? "choice" : "incl";
}

/** A rate as ten-thousandths, as `countries.standard_vat_rate` keeps it, so sums stay exact. */
const basisPoints = (rate: number) => Math.round(rate * 10_000);

/** A VAT-inclusive amount without its VAT. */
export function withoutVat(amountMinor: number, rate: number): number {
  return amountMinor - vatIncluded(amountMinor, rate);
}

/**
 * A price without VAT as the VAT-inclusive price that is kept. Rounded to
 * the minor unit, and always back to the same amount by `withoutVat()`.
 */
export function withVat(netMinor: number, rate: number): number {
  if (rate <= 0) return netMinor;
  return Math.round((netMinor * (10_000 + basisPoints(rate))) / 10_000);
}

/** Whether a buyer is shown a product: always, unless the store sells to both and the product is for the others. */
export function productShownTo(product: ProductAudience, buyer: Buyer, store: StoreAudience): boolean {
  if (store !== "both" || product === "all") return true;
  return (product === "businesses") === (buyer === "business");
}

/** Whether a buyer may buy a product: business-only ones need a business buyer. */
export function productSoldTo(product: ProductAudience, buyer: Buyer, store: StoreAudience): boolean {
  return store !== "both" || product !== "businesses" || buyer === "business";
}

/** Whether an order needs the company's name and organisation number. */
export function companyRequired(store: StoreAudience, products: readonly ProductAudience[]): boolean {
  return store === "businesses" || (store === "both" && products.includes("businesses"));
}

// ---------------------------------------------------------------------------
// Organisation numbers
// ---------------------------------------------------------------------------

const weighted = (digits: string, weights: number[]) =>
  weights.reduce((sum, weight, i) => sum + weight * Number(digits[i]), 0);

/** Norway: 9 digits, the last a modulus 11 check (Brønnøysundregistrene). */
function norwegian(digits: string): string | null {
  if (!/^\d{9}$/.test(digits)) return null;
  const rest = weighted(digits, [3, 2, 7, 6, 5, 4, 3, 2]) % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  return check !== 10 && check === Number(digits[8]) ? digits : null;
}

/** Sweden: 10 digits (12 with the century `16`), the last a Luhn check; shown as `NNNNNN-NNNN`. */
function swedish(input: string): string | null {
  const digits = input.length === 12 && input.startsWith("16") ? input.slice(2) : input;
  if (!/^\d{10}$/.test(digits)) return null;
  const sum = [...digits].reduce((total, char, i) => {
    const doubled = Number(char) * (i % 2 === 0 ? 2 : 1);
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return sum % 10 === 0 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : null;
}

/** Denmark: the CVR number, 8 digits whose weighted sum is divisible by 11. */
function danish(digits: string): string | null {
  return /^\d{8}$/.test(digits) && weighted(digits, [2, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0 ? digits : null;
}

/** Finland: the business ID (Y-tunnus), 7 digits and a check digit; shown as `NNNNNNN-N`. */
function finnish(digits: string): string | null {
  if (!/^\d{8}$/.test(digits)) return null;
  const rest = weighted(digits, [7, 9, 10, 5, 8, 4, 2]) % 11;
  if (rest === 1) return null;
  const check = rest === 0 ? 0 : 11 - rest;
  return check === Number(digits[7]) ? `${digits.slice(0, 7)}-${digits[7]}` : null;
}

const CHECKED: Record<string, (digits: string) => string | null> = {
  NO: norwegian,
  SE: swedish,
  DK: danish,
  FI: finnish,
};

/**
 * An organisation number as written for the market's country, checked
 * where the country's check is known, or null when it is not one. The
 * country prefix and Norway's `MVA` are allowed and left out.
 */
export function organisationNumber(country: string | null, value: string): string | null {
  const code = country?.toUpperCase() ?? "";
  const trimmed = value.trim().toUpperCase();
  const check = CHECKED[code];
  if (check) {
    const bare = trimmed.replace(new RegExp(`^${code}`), "").replace(/MVA$/, "");
    if (/[^\d\s.-]/.test(bare)) return null;
    return check(bare.replace(/[\s.-]/g, ""));
  }
  return /^[A-Z0-9][A-Z0-9 ./-]{2,28}[A-Z0-9]$/.test(trimmed) ? trimmed.replace(/\s+/g, " ") : null;
}

/** The longest company name kept. */
export const COMPANY_NAME_MAX = 120;
