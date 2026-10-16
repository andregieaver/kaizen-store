/**
 * Links in a store's own pages (`docs/signature-themes.md` step 1): the page builder tells an owner that `/about` is "a page on this site",
 * and on a store's own host it is; on Kaizena Flow's address (`/s/{store}/{market}/…`, D181) the same address led to Kaizena Flow's own
 * `/about`. A path written in a store's page, header, footer or product layout is therefore the store's: it is drawn under the market the
 * visitor is in (`marketPath()`'s base), so a theme's demo store and an owner's buttons reach the store's products, categories and pages in
 * every country and language. Pure.
 *
 * Left as written: another site, an anchor, mail and phone; a store's address already (`/s/…`); Kaizena Flow's own areas (`/admin`,
 * `/auth`, `/api`, `/themes`) and files (`/_next/…`, `/demo/…`, any path ending in a file name with an extension).
 */

const KEPT = /^\/(?:s|admin|auth|api|themes|_next|demo|downloads|kaizen)(?:[/?#]|$)/;
const FILE = /\/[^/?#]*\.[a-z0-9]{2,5}(?:[?#]|$)/i;

/** Whether an address is a path of the store's own site (`/products`, `/category/planets?sort=new`, `/about#team`). */
export function isStorePath(href: string): boolean {
  return /^\/(?![/\\])/.test(href) && !KEPT.test(href) && !FILE.test(href);
}

/** The address as the store draws it under `base` (a market's path, `""` where the store's own host has none). */
export function storeLink(href: string, base: string): string {
  if (!base || !isStorePath(href)) return href;
  return href === "/" ? base : `${base}${href}`;
}

const INLINE_LINK = /(<a\b[^>]*?\bhref=")([^"]*)(")/gi;

/**
 * A row, page or block with every link that is a store path drawn under `base`: each `href` (buttons, both sides of a dual button,
 * pictures, a column's link, rich text's link marks, a brand's link) and each `<a href>` in the inline markup of plain text fields. A copy;
 * the thing given is not changed. Nothing else is touched.
 */
export function withStoreLinks<T>(value: T, base: string): T {
  if (!base) return value;
  const walk = (node: unknown, key: string | null): unknown => {
    if (typeof node === "string") {
      if (key === "href") return storeLink(node, base);
      return node.includes("<a") ? node.replace(INLINE_LINK, (_all, open: string, href: string, close: string) => `${open}${storeLink(href, base)}${close}`) : node;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, null));
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  return walk(value, null) as T;
}
