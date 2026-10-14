/**
 * A postal code as the country writes it (D135, D237): the one reading of a typed code, shared by carriers' quotes, zones, local delivery areas and the
 * delivery postal code a cart keeps. Pure and free of zod, so the checkout (a pay route) can load it; `src/lib/delivery-options.ts` re-exports it.
 */
export function cleanPostalCode(country: string, typed: string): string | null {
  const text = typed.replace(/\s+/g, "").toUpperCase();
  switch (country.toUpperCase()) {
    case "NO":
    case "DK":
      return /^\d{4}$/.test(text) ? text : null;
    case "SE":
    case "FI":
    case "DE":
      return /^\d{5}$/.test(text) ? text : null;
    default:
      return /^[A-Z0-9-]{3,10}$/.test(text) ? text : null;
  }
}
