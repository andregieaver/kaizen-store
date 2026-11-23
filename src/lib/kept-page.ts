import { matchPath, pageOffered, pageParams, type SiteFlags } from "./admin-map";
import { HOME_PATHS } from "./store-nav";
import { KEEP_MAX } from "./store-switch";

/**
 * The page a store's Home opens for a person who switched here from another store (D873, `switchHref()`), or null for Home itself. The
 * address after the store's is kept when it is:
 *   - a page of the admin map (`matchPath()`) with no record in its address: `/orders/drafts` and `/settings/tax` are kept, `/orders/<id>`
 *     and `/products/<id>` are the other store's own records and are not;
 *   - not Home's own (the setup steps, the AI manager);
 *   - offered to this person in this store (`pageOffered()`: its feature and extension on, their role opens it, as the page finder asks).
 * The address opened is the map's own path, never the text asked, so nothing but a page of this store can be reached through it.
 */
export function keptPage(slug: string, asked: unknown, flags: SiteFlags): string | null {
  if (typeof asked !== "string" || !asked.startsWith("/") || asked.length > KEEP_MAX) return null;
  const path = asked.split(/[?#]/)[0].replace(/\/+$/, "");
  if (!path || HOME_PATHS.some((home) => path === home || path.startsWith(`${home}/`))) return null;
  const found = matchPath(`/admin/${slug}${path}`);
  if (!found || found.page.area !== "store" || found.page.path === "" || pageParams(found.page).length > 0) return null;
  return pageOffered(found.page, flags) ? `/admin/${slug}${found.page.path}` : null;
}
