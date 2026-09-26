import { siteUrl } from "./site";

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

/** The store's own address, e.g. `https://demo.kaizenstores.com`; null while stores are under Kaizen's. */
export function storeOrigin(storeSlug: string): string | null {
  const domain = storeDomain();
  if (!domain) return null;
  const local = /^localhost(?::\d+)?$/.test(domain);
  return `${local ? "http" : "https"}://${storeSlug}.${domain}`;
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

/** A path inside one market of a store, e.g. `marketPath("demo", "no", "/cart")`. */
export function marketPath(storeSlug: string, marketSlug: string, path = ""): string {
  return `${storeBase(storeSlug)}/${marketSlug}${path}`;
}

/**
 * A link to a store's path (from `storeBase()` or `marketPath()`) from outside
 * the store, such as the admin or Kaizen's pages: on the store's host once it
 * has one. Always at least `/`.
 */
export function storeHref(storeSlug: string, path: string): string {
  return `${storeOrigin(storeSlug) ?? ""}${path}` || "/";
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
  "mail",
  "platform",
  "setup",
  "sign-in",
  "sign-up",
  "status",
  "stores",
  "support",
  "www",
];
