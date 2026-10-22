import { siteUrl } from "./site";
import { parseMarketSlug } from "./market-slug";
import { addressSegment, storeAddress, type StoreAddress } from "./store-address";

/**
 * Where stores live (P2, P7). Once `NEXT_PUBLIC_STORE_DOMAIN` is set (e.g.
 * `kaizenstores.com`, or `localhost:3000` to try it locally), each store has
 * its own host, `{slug}.{domain}`, a different site from Kaizen's so that
 * nothing a store adds can reach the admin. Until then stores are served
 * under `/s/{slug}` on Kaizen's own host.
 *
 * Read at build time: the host routing in `next.config.ts` is built from it.
 */
export function storeDomain(): string | null {
  const value = process.env.NEXT_PUBLIC_STORE_DOMAIN?.trim().toLowerCase();
  if (!value) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::\d{2,5})?$/.test(value)) {
    throw new Error(`NEXT_PUBLIC_STORE_DOMAIN must be a host name such as kaizenstores.com, not "${value}".`);
  }
  return value;
}

/**
 * Each store's own domains this deployment routes (P8): its primary, if any, and every active one; `languages` names the domains that are a
 * language's own (D313, `docs/language-domains.md`: a language, two letters, to its domain), each also in `hosts`.
 */
export type StoreHosts = Record<string, { primary: string | null; hosts: string[]; languages?: Record<string, string> }>;

/**
 * The stores' custom domains as they were when this deployment was built
 * (`next.config.ts` reads them into `NEXT_PUBLIC_STORE_HOSTS`), so links
 * and routing always agree. A change takes a new deployment.
 */
export function storeHosts(): StoreHosts {
  try {
    const parsed: unknown = JSON.parse(process.env.NEXT_PUBLIC_STORE_HOSTS || "{}");
    return parsed && typeof parsed === "object" ? (parsed as StoreHosts) : {};
  } catch {
    return {};
  }
}

/** A host's origin: plain http with the local port when trying hosts on localhost. */
export function hostOrigin(host: string): string {
  const local = storeDomain()?.match(/^localhost(:\d+)?$/);
  return local ? `http://${host}${local[1] ?? ""}` : `https://${host}`;
}

/**
 * The store's own address: its primary custom domain (P8), else
 * `{slug}.{store domain}`, e.g. `https://demo.kaizenstore.site`; null while
 * stores are under Kaizen's.
 */
export function storeOrigin(storeSlug: string): string | null {
  const domain = storeDomain();
  if (!domain) return null;
  const primary = storeHosts()[storeSlug]?.primary;
  return hostOrigin(primary ?? `${storeSlug}.${domain.split(":")[0]}`);
}

/**
 * The path in front of a store's markets on its own pages: nothing on its own
 * host, `/s/{slug}` until then. Links inside a store use it as it is; links
 * from anywhere else go through `storeHref()`.
 */
export function storeBase(storeSlug: string): string {
  return storeDomain() ? "" : `/s/${storeSlug}`;
}

/** The store's front door (its country chooser) as a path on its own pages: never empty. */
export function storeHome(storeSlug: string): string {
  return storeBase(storeSlug) || "/";
}

/** The domains of a store that are a language's own (D313), language (two letters) to host name; empty for most stores. */
export function languageHosts(storeSlug: string): Record<string, string> {
  return storeDomain() ? (storeHosts()[storeSlug]?.languages ?? {}) : {};
}

/** The language a market is shown in, two letters: the slug's (`no-en`), else its country's own where the store's shape says it, else null. */
export function marketLanguage(marketSlug: string, address: StoreAddress | null | undefined): string | null {
  const parsed = parseMarketSlug(marketSlug);
  if (!parsed) return null;
  return parsed.lang ?? address?.owns?.[parsed.country.toLowerCase()] ?? null;
}

/** A market slug without a language (`no-en-eur` → `no-eur`): how it is written on the language's own domain, where the language goes without saying. */
export function withoutLanguage(marketSlug: string, lang: string): string {
  const parsed = parseMarketSlug(marketSlug);
  if (!parsed || parsed.lang !== lang) return marketSlug;
  return [parsed.country.toLowerCase(), ...(parsed.currency ? [parsed.currency.toLowerCase()] : [])].join("-");
}

/** The domain a market lives on when its language has one of its own (D313), else null (the store's address). */
export function marketHost(storeSlug: string, marketSlug: string, address: StoreAddress | null | undefined = storeAddress(storeSlug)): string | null {
  const lang = marketLanguage(marketSlug, address);
  return lang ? (languageHosts(storeSlug)[lang] ?? null) : null;
}

/**
 * A path inside one market of a store, e.g. `marketPath("demo", "no", "/cart")`. A store that sells in one country has no country in its
 * addresses (D181, `src/lib/store-address.ts`): `marketPath("kaiza", "no", "/cart")` is `/s/kaiza/cart`, and `no-en` is `/s/kaiza/en/cart`.
 * The market's front page on a store's own host is then empty: `marketHome()` where an address cannot be. `address` is the store's shape
 * as this process last read it (`getStore()`), or as the caller knows it (the proxy's facts).
 */
export function marketPath(storeSlug: string, marketSlug: string, path = "", address: StoreAddress | null | undefined = storeAddress(storeSlug)): string {
  // On a language's own domain (D313) the language goes without saying: `no-en` is `/` there, `no-en-eur` `/eur`, `se-en` `/se`.
  const lang = marketHost(storeSlug, marketSlug, address) ? marketLanguage(marketSlug, address) : null;
  const segment = addressSegment(address, lang ? withoutLanguage(marketSlug, lang) : marketSlug);
  return `${storeBase(storeSlug)}${segment ? `/${segment}` : ""}${path}`;
}

/** A market's front page as a link: `marketPath()`, or `/` where that is empty (a store that sells in one country, on its own host). */
export function marketHome(storeSlug: string, marketSlug: string): string {
  return marketPath(storeSlug, marketSlug) || "/";
}

/** The origin a market's pages are on: its language's own domain (D313), else the store's (`storeSiteUrl()`). */
export function marketOrigin(storeSlug: string, marketSlug: string, address: StoreAddress | null | undefined = storeAddress(storeSlug)): string {
  const host = marketHost(storeSlug, marketSlug, address);
  return host ? hostOrigin(host) : storeSiteUrl(storeSlug);
}

/**
 * A full address inside one market (emails, Stripe, search engines, `hreflang`, a link to another language): `marketPath()` on the market's
 * origin. Never build one as `storeSiteUrl() + marketPath()`: a language with a domain of its own (D313) is on another origin.
 */
export function marketUrl(storeSlug: string, marketSlug: string, path = "", address: StoreAddress | null | undefined = storeAddress(storeSlug)): string {
  return `${marketOrigin(storeSlug, marketSlug, address)}${marketPath(storeSlug, marketSlug, path, address)}`;
}

/**
 * A market's address in a page's metadata (canonical, `hreflang`, share tags): a path under the page's `metadataBase`, as ever, or the full
 * address once the store has a language on a domain of its own (D313), where another language is on another origin.
 */
export function marketMetaPath(storeSlug: string, marketSlug: string, path = "", address: StoreAddress | null | undefined = storeAddress(storeSlug)): string {
  if (Object.keys(languageHosts(storeSlug)).length === 0) return marketPath(storeSlug, marketSlug, path, address) || "/";
  return marketUrl(storeSlug, marketSlug, path, address);
}

/**
 * A link from a page of one market to another's (a language or currency choice, the country chooser): a path where both are on one origin,
 * the full address where the other's language has a domain of its own (D313) or the page is on one.
 */
export function marketLink(storeSlug: string, fromMarket: string | null, toMarket: string, path = "", address: StoreAddress | null | undefined = storeAddress(storeSlug)): string {
  const here = fromMarket ? marketHost(storeSlug, fromMarket, address) : null;
  const there = marketHost(storeSlug, toMarket, address);
  return here === there ? marketPath(storeSlug, toMarket, path, address) : marketUrl(storeSlug, toMarket, path, address);
}

/**
 * A link to a store's path (from `storeBase()` or `marketPath()`) from outside
 * the store, such as the admin or Kaizen's pages: on the store's host once it
 * has one. Always at least `/`.
 */
export function storeHref(storeSlug: string, path: string): string {
  return `${storeOrigin(storeSlug) ?? ""}${path}` || "/";
}

/** Every origin the store answers on in this deployment: its host on the store domain and its own domains (P7, P8). */
export function storeOrigins(storeSlug: string): string[] {
  const domain = storeDomain();
  if (!domain) return [];
  return [`${storeSlug}.${domain.split(":")[0]}`, ...(storeHosts()[storeSlug]?.hosts ?? [])].map(hostOrigin);
}

/**
 * Where the admin is, for links to it from a store's pages: nothing while
 * stores are on Kaizen's host, Kaizen's own address once they have theirs.
 */
export function adminOrigin(storeSlug: string): string {
  return storeOrigin(storeSlug) ? siteUrl() : "";
}

/**
 * The origin a store's paths are under, for full addresses (emails, Stripe,
 * search engines): the store's host, or Kaizen's until stores have them.
 */
export function storeSiteUrl(storeSlug: string): string {
  return storeOrigin(storeSlug) ?? siteUrl();
}

/** The format `commerce.stores.slug` enforces: 3–40 characters. */
const STORE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function isStoreSlug(value: string): boolean {
  return STORE_SLUG.test(value) && !RESERVED_STORE_SLUGS.includes(value);
}

/** Kept in step with the `stores_slug_not_reserved` check. */
export const RESERVED_STORE_SLUGS: readonly string[] = [
  "account",
  "admin",
  "api",
  "app",
  "auth",
  "forgot-password",
  "help",
  "hosting",
  "mail",
  "platform",
  "setup",
  "sign-in",
  "sign-up",
  "status",
  "stores",
  "support",
  // The theme store's own host, `themes.{domain}` (docs/theme-phase-3.md step 3).
  "themes",
  "www",
];
