/**
 * The old shop's addresses (D445 step 1, `docs/moving-from-shopify.md` 8.2 and 12), pure: reading the sitemap a shop gives search engines, the
 * addresses it lists put in the normal form of a redirect's source, what kind of page each was, the address the same thing has here (Shopify's
 * `/products/{handle}` is our `/p/{handle}`), and where each old address leads on this store now: a live page, a redirect that ends at one, a
 * redirect that ends nowhere, or nothing.
 *
 * Nothing here fetches or reads the database: `src/server/old-shop.ts` does, and calls these. A suggested address is found in code (the same
 * handle under our shape, else the 404 report's word match), never by a model.
 */
import { followChain, targetExists, type RedirectIndex } from "./redirects";
import { looksLikeMarket, normalisePath, pathOfTarget } from "./redirect-path";

/** The most addresses kept from an old shop, the most sitemap files read, and the largest file read. */
export const OLD_SHOP_ADDRESSES_MAX = 20_000;
export const OLD_SHOP_FILES_MAX = 60;
export const OLD_SHOP_FILE_BYTES = 12 * 1024 * 1024;
/** The missing addresses that get suggestions on the page (reading candidates is the costly part); the rest are counted. */
export const OLD_SHOP_SUGGESTED_ROWS = 200;
/** The most redirects made by one press of *Fix them*, in batches of `OLD_SHOP_FIX_BATCH`. */
export const OLD_SHOP_FIX_BATCH = 500;

// ---------------------------------------------------------------------------
// The sitemap
// ---------------------------------------------------------------------------

export type Sitemap = { index: boolean; locs: string[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/**
 * The addresses in a sitemap file (sitemaps.org): a `<sitemapindex>` lists more sitemap files, a `<urlset>` lists pages. Only `<loc>` is read (a
 * picture's or a language's address is in other elements), in the file's order, without duplicates. Null when the text is neither: a shop that
 * answers its sitemap address with a page is not a sitemap.
 */
export function readSitemap(xml: string, max: number = OLD_SHOP_ADDRESSES_MAX): Sitemap | null {
  const head = xml.slice(0, 4_000).toLowerCase();
  const index = head.includes("<sitemapindex");
  if (!index && !head.includes("<urlset")) return null;
  const locs: string[] = [];
  const seen = new Set<string>();
  // `<loc>` directly inside `<url>` or `<sitemap>`; an image sitemap's `<image:loc>` has a prefix and is not matched.
  for (const match of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*?))\s*<\/loc>/gi)) {
    const loc = (match[1] ?? unescapeXml(match[2] ?? "")).trim();
    if (loc === "" || seen.has(loc)) continue;
    seen.add(loc);
    locs.push(loc);
    if (locs.length >= max) break;
  }
  return { index, locs };
}

/** The host an old shop's address names, lower case without `www.`, so `www.myshop.com` and `myshop.com` are one shop. */
export const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "");

/** The sections of the shops we know (Shopify's and WooCommerce's): a first part of a sitemap address that looks like a language is a prefix before one of these. */
const SECTIONS = new Set(["products", "collections", "pages", "blogs", "product", "product-category", "product-tag", "shop"]);

/**
 * An address from an old shop's sitemap as a redirect's source here, or null: only an address on the old shop's own host (any `www.`), not its
 * front page, put in the normal form (lower case, no query). A language prefix (`/en/products/x`, `/de-de/pages/about`, Shopify's markets in
 * folders) is taken off when a known section follows it, so a product listed in five languages is one address.
 */
export function oldPathOf(loc: string, host: string): string | null {
  let url: URL;
  try {
    url = new URL(loc);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (bareHost(url.hostname) !== bareHost(host)) return null;
  const path = normalisePath(url.pathname);
  if (path === null || path === "/") return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 1 && looksLikeMarket(parts[0]) && SECTIONS.has(parts[1])) return `/${parts.slice(1).join("/")}`;
  return path;
}

// ---------------------------------------------------------------------------
// What an old address was, and what it is called here
// ---------------------------------------------------------------------------

export const OLD_KINDS = ["product", "category", "page", "article", "blog", "other"] as const;
export type OldKind = (typeof OLD_KINDS)[number];

/** What an old shop's address was, from its shape: Shopify's `/products/x`, `/collections/x`, `/pages/x`, `/blogs/x/y`, and WooCommerce's. */
export function kindOfOldPath(path: string): OldKind {
  const parts = path.split("/").filter(Boolean);
  const [first] = parts;
  if (first === "products" || first === "product") return parts.length >= 2 ? "product" : "category";
  if (first === "collections") return parts.length >= 4 && parts[2] === "products" ? "product" : "category";
  if (first === "product-category" || first === "product-tag" || first === "shop") return "category";
  if (first === "pages") return parts.length >= 2 ? "page" : "other";
  if (first === "blogs") return parts.length >= 3 && parts[2] !== "tagged" ? "article" : "blog";
  return "other";
}

/**
 * The address the same thing has on this store, by our shapes (`/p/{handle}`, `/category/{slug}`, `/tag/{slug}`, `/{page}`, `/blog/{article}`),
 * or null when the shape says nothing: a product imported from Shopify keeps its handle (D165), so `/products/{handle}` is `/p/{handle}`. It is
 * a guess the caller checks against what is live; an address that is not is never offered.
 */
export function counterpartOf(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const [first, second] = parts;
  const last = parts[parts.length - 1];
  switch (first) {
    case "products":
      return parts.length === 2 ? `/p/${second}` : parts.length === 1 ? "/products" : null;
    case "product":
      return parts.length === 2 ? `/p/${second}` : null;
    case "collections":
      if (parts.length === 1) return "/products";
      if (parts.length === 4 && parts[2] === "products") return `/p/${parts[3]}`;
      if (second === "all") return parts.length <= 3 ? "/products" : null;
      // `/collections/{c}/{tag}` is Shopify's collection filtered by a tag: the collection is the closest page.
      return parts.length <= 3 ? `/category/${second}` : null;
    case "product-category":
      return parts.length >= 2 ? `/category/${last}` : null;
    case "product-tag":
      return parts.length === 2 ? `/tag/${second}` : null;
    case "shop":
      return parts.length === 1 ? "/products" : null;
    case "pages":
      return parts.length === 2 ? `/${second}` : null;
    case "blogs":
      if (parts.length === 3 && parts[2] !== "tagged") return `/blog/${parts[2]}`;
      return "/blog";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Where an old address leads now
// ---------------------------------------------------------------------------

export type Fate =
  /** The address is a page here as it is. */
  | { fate: "live" }
  /** A redirect from it ends at a page here. */
  | { fate: "redirected"; to: string }
  /** A redirect from it ends nowhere (its target is not a page, a loop, too long, or a thing that is gone). */
  | { fate: "broken" }
  /** Nothing here answers it: a shopper gets the not-found page. */
  | { fate: "missing" };

/**
 * Where an old address leads on this store, by the rule the resolver serves by (`followChain()`): live as it is, a redirect that ends at a live
 * address, a redirect that ends nowhere, or nothing at all. `live` holds the addresses live now (`liveOf()` over the paths and every target the
 * index reaches); `index` the redirects from them (`indexFor()`).
 */
export function fateOf(path: string, env: { live: ReadonlySet<string>; index: RedirectIndex }): Fate {
  if (env.live.has(path)) return { fate: "live" };
  const chain = followChain(path, env.index, { isLive: (p) => env.live.has(p) });
  if (chain.status === "none") return { fate: "missing" };
  if (chain.status !== "ok" || chain.final === null) return { fate: "broken" };
  return targetExists(pathOfTarget(chain.final), env.live) ? { fate: "redirected", to: chain.final } : { fate: "broken" };
}

/** The target an old address can be sent to without asking: the same thing under our shape, when it is live here. Null otherwise. */
export function sureTarget(path: string, live: ReadonlySet<string>): string | null {
  const counterpart = counterpartOf(path);
  return counterpart !== null && targetExists(counterpart, live) && counterpart !== path ? counterpart : null;
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export type KindCount = { kind: OldKind; total: number; working: number };

/** The old addresses counted by kind, and how many of each lead somewhere (live or redirected): the check's table, in `OLD_KINDS` order, kinds with none left out. */
export function countByKind(rows: readonly { kind: OldKind; fate: Fate["fate"] }[]): KindCount[] {
  const counts = new Map<OldKind, KindCount>();
  for (const row of rows) {
    const count = counts.get(row.kind) ?? { kind: row.kind, total: 0, working: 0 };
    count.total += 1;
    if (row.fate === "live" || row.fate === "redirected") count.working += 1;
    counts.set(row.kind, count);
  }
  return OLD_KINDS.flatMap((kind) => (counts.has(kind) ? [counts.get(kind)!] : []));
}
