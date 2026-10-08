/**
 * Addresses without a country (D181, `docs/marketless-addresses.md`). A store that sells in one country (Several countries off, or only one
 * country kept) has no country in its addresses: `kaizenalabs.com/home`, `/s/{store}/home` on Kaizen's address, instead of `/no/home`. A
 * language or currency a shopper chose that is not the country's own is a short prefix (`/en/home`, `/eur/home`, `/en-eur/home`). Pure: the
 * proxy, `paths.ts`, the tests and the pages share it.
 *
 * Inside the app nothing moves: the routes are still `/s/[store]/[market]/…` and a market's slug is still `no`, `no-en`, … The short address
 * is the proxy's rewrite to the long one (`addressDecision()`), and the long one is the proxy's 308 to the short one, so links in emails and
 * search results keep working whichever way a store switches. Links are made short by `marketPath()`, which reads the store's address from
 * `storeAddress()`: `getStore()` (and the email loader) remember each store's as they read it.
 */
import { conversionFor, type Localization } from "./localization";
import { parseMarketSlug } from "./market-slug";
import type { Market } from "./markets";

export type StoreAddress = {
  /** The store's own country's address (its own view), lower case: `no`. */
  home: string;
  /** Sells in one country: its addresses have no country. */
  marketless: boolean;
  /** Languages (lower case, two letters) a shopper may choose for the store's own country besides its own: `en`. */
  languages: string[];
  /** Currencies (lower case, three letters) a shopper may choose for it besides its own: `eur`. */
  currencies: string[];
  /** Languages and currencies the store keeps but does not offer now (D178): an old address with one is moved by the route, not read as a page. */
  keptLanguages: string[];
  keptCurrencies: string[];
  /** Every country the store has had, lower case, its own first: an old address in one is moved by the route (`marketMoved()`). */
  countries: string[];
};

const langOf = (locale: string) => locale.split("-")[0].toLowerCase();
const unique = (list: readonly string[]) => [...new Set(list)];

/**
 * A store's address shape, from what `getStore()` reads: its offered countries (own first), every one it had, and what it offers in languages
 * and currencies. Null for a store with no country.
 */
export function storeAddressOf(store: { markets: readonly Market[]; keptMarkets?: readonly Market[]; allMarkets: readonly Pick<Market, "code">[]; localization: Localization }): StoreAddress | null {
  const own = store.markets[0];
  if (!own) return null;
  const ownLang = langOf(own.ownLocale);
  const ownCurrency = own.nativeCurrency;
  const languages = store.localization.languageChoice ? unique(store.localization.locales.map(langOf)).filter((l) => l !== ownLang) : [];
  const currencies = unique(store.localization.currencies.map((c) => c.currency))
    .filter((c) => c !== ownCurrency && conversionFor(store.localization, ownCurrency, c) !== null)
    .map((c) => c.toLowerCase());
  const keptLanguages = unique(store.localization.keptLocales.map(langOf)).filter((l) => l !== ownLang && !languages.includes(l));
  const keptCurrencies = [...store.localization.rates.keys()]
    .map((c) => c.toLowerCase())
    .filter((c) => c !== ownCurrency.toLowerCase() && !currencies.includes(c));
  const home = own.code.toLowerCase();
  return {
    home,
    // One country offered: Several countries off, or one country kept.
    marketless: store.markets.length === 1,
    languages,
    currencies,
    keptLanguages,
    keptCurrencies: unique(keptCurrencies),
    countries: unique([home, ...(store.keptMarkets ?? []).map((m) => m.code.toLowerCase()), ...store.allMarkets.map((m) => m.code.toLowerCase())]),
  };
}

const SHORT = /^(?:([a-z]{2})|([a-z]{3})|([a-z]{2})-([a-z]{3}))$/;

/**
 * What a first part of an address is to a store, as a choice of language and currency for its own country without the country (`en`, `eur`,
 * `en-eur`): `offered` when the store offers it now, `kept` when it keeps it but does not offer it (an old address, moved by the route), else
 * null (a page's address, `om-oss`).
 */
export function shortChoiceOf(address: StoreAddress, segment: string): "offered" | "kept" | null {
  const match = SHORT.exec(segment);
  if (!match) return null;
  const lang = match[1] ?? match[3] ?? null;
  const currency = match[2] ?? match[4] ?? null;
  const langIs = lang === null ? "offered" : address.languages.includes(lang) ? "offered" : address.keptLanguages.includes(lang) ? "kept" : null;
  const currencyIs = currency === null ? "offered" : address.currencies.includes(currency) ? "offered" : address.keptCurrencies.includes(currency) ? "kept" : null;
  if (langIs === null || currencyIs === null) return null;
  return langIs === "offered" && currencyIs === "offered" ? "offered" : "kept";
}

/**
 * The first part of the address for a market slug (`no`, `no-en`, …): without the country for a store that sells in one (`""`, `en`, `eur`,
 * `en-eur`), as it is for every other store, for another country and for a view the store neither offers nor keeps (the route moves it).
 */
export function addressSegment(address: StoreAddress | null | undefined, marketSlug: string): string {
  if (!address?.marketless) return marketSlug;
  const parsed = parseMarketSlug(marketSlug);
  if (!parsed || parsed.country.toLowerCase() !== address.home) return marketSlug;
  const tail = marketSlug.slice(address.home.length + 1);
  return tail === "" || shortChoiceOf(address, tail) !== null ? tail : marketSlug;
}

/** The long market slug a short first part stands for (`en` → `no-en`), for a store that sells in one country. */
export const longMarketSlug = (address: StoreAddress, segment: string): string => (segment === "" ? address.home : `${address.home}-${segment}`);

/**
 * The page addresses a store's pages may not take while it has these languages and currencies: a first part that is a choice it keeps is read
 * as the choice, never as a page (`addressDecision()`), so a page there could not be reached without its country.
 */
export function reservedChoiceSlugs(address: StoreAddress | null | undefined): string[] {
  if (!address) return [];
  const languages = [...address.languages, ...address.keptLanguages];
  const currencies = [...address.currencies, ...address.keptCurrencies];
  return [...languages, ...currencies, ...languages.flatMap((l) => currencies.map((c) => `${l}-${c}`))];
}

// ---------------------------------------------------------------------------
// The stores' address shapes as this process last read them
// ---------------------------------------------------------------------------

const known = new Map<string, StoreAddress | null>();

/** Notes a store's address shape (`getStore()` and the email loader call it with what they read), for `marketPath()`. */
export function rememberStoreAddress(storeSlug: string, address: StoreAddress | null): void {
  known.set(storeSlug, address);
}

/** A store's address shape as last read in this process, or undefined when it has not been read: its addresses then have their country. */
export function storeAddress(storeSlug: string): StoreAddress | null | undefined {
  return known.get(storeSlug);
}

/** Forgets every store's shape (tests). */
export function forgetStoreAddresses(): void {
  known.clear();
}

// ---------------------------------------------------------------------------
// Routing a request (the proxy)
// ---------------------------------------------------------------------------

/** A request for a store's page: the store, whether it came to the store's own host, and the parts after `/s/{store}` (or the host). */
export type StorePathRequest = { store: string; hostBased: boolean; parts: string[] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** First parts that are never a store's page on its own host: the platform's files and routes (the matcher keeps most of them away). */
const NOT_STORE_PAGES: readonly string[] = ["_next", "api", "admin", "demo", "kaizen", "favicon.ico"];

/** The store and the parts of a request for a store's page: `/s/{store}/…` anywhere, `/…` on a store's own host (`hostStore`). Else null. */
export function storePathOf(pathname: string, hostStore: string | null): StorePathRequest | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "s") {
    if (parts.length < 2 || !SLUG.test(parts[1])) return null;
    return { store: parts[1], hostBased: false, parts: parts.slice(2) };
  }
  if (!hostStore) return null;
  if (parts.length > 0 && NOT_STORE_PAGES.includes(parts[0].toLowerCase())) return null;
  return { store: hostStore, hostBased: true, parts };
}

/** The path of a request's parts under the store's base: `/s/{store}` on Kaizen's address, nothing on its own host. Never empty. */
export function joinStorePath(request: Pick<StorePathRequest, "store" | "hostBased">, segment: string, rest: readonly string[]): string {
  const base = request.hostBased ? "" : `/s/${request.store}`;
  return `${base}${segment ? `/${segment}` : ""}${rest.map((part) => `/${part}`).join("")}` || "/";
}

export type AddressDecision =
  /** Served from this path (the long form), the address in the browser unchanged. */
  | { rewrite: string }
  /** The address moved, for good (308): the query string is the caller's to add. Only for a request that asks for a page (GET, HEAD). */
  | { redirect: string }
  /** No country and no choice, for a store that sells in several: what the caller looks up as a manual redirect, else moves to the store's own country when the address is live there. */
  | { marketless: { path: string; first: string } }
  /** Nothing to do: the routes serve it as it is. */
  | null;

/**
 * Whether a first part that has the shape of a market (`no`, `no-en`, `se-eur`) is one of the store's: `own` for its own country in its own
 * view or one it offers or keeps, `other` for another country it has had, null for a page's address of that shape (`no-way`, `om-oss`). The
 * views of another country are read with the store's own country's choices, near enough for an old address.
 */
function viewOf(address: StoreAddress, segment: string, country: string): "own" | "other" | null {
  if (!address.countries.includes(country)) return null;
  const tail = segment.slice(country.length + 1);
  if (tail !== "" && shortChoiceOf(address, tail) === null) return null;
  return country === address.home ? "own" : "other";
}

/**
 * Where a request for a store's page goes (D181), from the store's address shape, pure. For a store that sells in one country:
 *
 * 1. its own front page without the country is served from its country's (`/` → `/no`);
 * 2. an address in its own country (`/no/x`, `/no-en/x` with English offered) moves to the one without the country (`/x`, `/en/x`); one
 *    in a view it keeps but no longer offers (`/no-de/x`) is the route's, which moves it;
 * 3. a first part that is a language or currency it offers (`/en/x`) is served from its own country in that view (`/no-en/x`);
 * 4. an address in another country it has had (`/se/x`) is the route's, which moves it to one offered;
 * 5. a choice it keeps but no longer offers (`/de/x` with German off) is served from the long form, which the route moves;
 * 6. anything else is an address in its own country (`/x` → `/no/x`): a page, a product, the cart, a manual redirect's source.
 *
 * For a store that sells in several countries an address in one of them is served as it is, and a short address moves back to the long
 * one: a choice of language or currency to its own country's (`/en/x` → `/no-en/x`), and anything else is the caller's (`marketless`).
 */
export function addressDecision(request: StorePathRequest, address: StoreAddress | null): AddressDecision {
  if (!address) return null;
  const [first = "", ...rest] = request.parts;
  const lower = first.toLowerCase();
  const market = parseMarketSlug(lower);
  if (address.marketless) {
    if (request.parts.length === 0) return { rewrite: joinStorePath(request, address.home, []) };
    const view = market ? viewOf(address, lower, market.country.toLowerCase()) : null;
    if (view === "own") {
      const tail = lower.slice(address.home.length + 1);
      return shortChoiceOf(address, tail) === "kept" ? null : { redirect: joinStorePath(request, tail, rest) };
    }
    const choice = shortChoiceOf(address, lower);
    if (choice === "offered") return { rewrite: joinStorePath(request, longMarketSlug(address, lower), rest) };
    if (view === "other") return null;
    if (choice === "kept") return { rewrite: joinStorePath(request, longMarketSlug(address, lower), rest) };
    return { rewrite: joinStorePath(request, address.home, request.parts) };
  }
  if (request.parts.length === 0) return null;
  if (market && viewOf(address, lower, market.country.toLowerCase()) !== null) return null;
  if (shortChoiceOf(address, lower) !== null) return { redirect: joinStorePath(request, longMarketSlug(address, lower), rest) };
  if (NOT_STORE_PAGES.includes(lower)) return null;
  return { marketless: { path: `/${request.parts.join("/")}`, first: lower } };
}

/**
 * The routes of a market (`src/app/s/[store]/[market]/…`, a test holds the list to the folders): a store that sells in several countries
 * moves an address without a country that begins with one to its own country's (`/cart` → `/no/cart`), as it does a live page's.
 */
export const MARKET_ROUTES: readonly string[] = [
  "account",
  "blog",
  "cart",
  "category",
  "checkout",
  "cookies",
  "deliveries",
  "download",
  "order",
  "p",
  "products",
  "returns",
  "search",
  "subscription",
  "tag",
  "unsubscribe",
  "wishlist",
  "withdraw",
];

/**
 * The parts of a store's path after its market, whichever shape the address has (D181): `/s/{store}/no/p/x`, `/no/p/x`, `/s/{store}/p/x`,
 * `/en/p/x` and `/p/x` are all `p/x`; `market` is the long market slug (with A/B versions taken off by the caller), or null when the address
 * names none and the store's shape is unknown. `parts` are the path's parts after `/s/{store}` (or on a store's host).
 */
export function afterMarket(parts: readonly string[], address: StoreAddress | null | undefined): { market: string | null; rest: string[] } {
  const [first = "", ...rest] = parts;
  const lower = first.toLowerCase().split("~")[0];
  if (address?.marketless) {
    const market = parseMarketSlug(lower);
    if (market && viewOf(address, lower, market.country.toLowerCase()) !== null) return { market: lower, rest };
    if (shortChoiceOf(address, lower) !== null) return { market: longMarketSlug(address, lower), rest };
    return { market: address.home, rest: [...parts] };
  }
  if (parseMarketSlug(lower)) return { market: lower, rest };
  return { market: null, rest: [...parts] };
}

/**
 * The proxy's second matcher (D181), written out in `src/proxy.ts` as a literal (a matcher is read at build time and cannot use a constant; a
 * test holds the two together): every path but Next.js's files, the API, the admin, the shared files in `public` (`demo/`, `kaizen/`), the icon
 * and static files, so the proxy sees every request for a store's page, with or without its country. Case-insensitive, as Next compiles it.
 * Non-capturing groups only.
 */
export const STORE_MATCHER = {
  source:
    "/((?!_next/|api/|admin/|demo/|kaizen/|favicon\\.ico|.*\\.(?:ico|png|jpg|jpeg|gif|webp|avif|svg|css|js|map|txt|xml|json|woff|woff2|ttf|pdf|csv|zip|mp4|webm)$).*)",
} as const;
