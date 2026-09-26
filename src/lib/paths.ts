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

/** Each store's own domains this deployment routes (P8): its primary, if any, and every active one. */
export type StoreHosts = Record<string, { primary: string | null; hosts: string[] }>;

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
