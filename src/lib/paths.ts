/**
 * Where a store's storefront lives. For now every store is served under
 * `/s/{slug}` on the platform's own host; once the platform domain exists,
 * stores move to `{slug}.{domain}` (docs/platform.md, P2) and only this
 * function changes.
 */
export function storeBase(storeSlug: string): string {
  return `/s/${storeSlug}`;
}

/** A path inside one market of a store, e.g. `marketPath("demo", "no", "/cart")`. */
export function marketPath(storeSlug: string, marketSlug: string, path = ""): string {
  return `${storeBase(storeSlug)}/${marketSlug}${path}`;
}

/** The format `commerce.stores.slug` enforces: 3–40 characters. */
const STORE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function isStoreSlug(value: string): boolean {
  return STORE_SLUG.test(value) && !RESERVED_STORE_SLUGS.includes(value);
}

/** Kept in step with the `stores_slug_not_reserved` check. */
export const RESERVED_STORE_SLUGS: readonly string[] = [
  "admin",
  "api",
  "app",
  "auth",
  "help",
  "mail",
  "platform",
  "setup",
  "sign-in",
  "sign-up",
  "status",
  "support",
  "www",
];
