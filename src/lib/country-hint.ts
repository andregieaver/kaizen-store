/**
 * The country suggestion (D338, `docs/wave-7-storefront.md` D3), pure: which of the store's countries to suggest to a visitor, and the same
 * page's address there. A suggestion, never a redirect (the Geo-blocking Regulation).
 */

/**
 * The country to suggest (a market code), or null: the visitor's country (`x-vercel-ip-country`) when the store sells there and it is not
 * the one shown. Nothing for a country the store does not sell to, for an unknown one, or for a store in one country.
 */
export function hintCountry(visitor: string | null | undefined, shown: string, offered: readonly string[]): string | null {
  const country = visitor?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(country) || offered.length < 2) return null;
  return country !== shown.toUpperCase() && offered.includes(country) ? country : null;
}

/**
 * The page the visitor is on, in the suggested market: the path after this market's base (`fromBase`, `/s/demo/no` or `/no`, or empty on a
 * domain of its own) laid onto the other market's (`toBase`, a path or a full address on another origin). Its query is left behind: a filter
 * or a search may not be the same there.
 */
export function hintHref(pathname: string, fromBase: string, toBase: string): string {
  const rest = fromBase && pathname.startsWith(fromBase) ? pathname.slice(fromBase.length) : fromBase ? "" : pathname;
  const tail = rest === "/" ? "" : rest;
  return `${toBase}${tail}` || "/";
}
