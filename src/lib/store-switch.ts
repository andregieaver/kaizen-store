/**
 * Switching store keeps the page (code review FN12, D873). The level switcher, in the browser, knows the address and nothing of the other
 * store: which of its features are on and what this person's role there opens. So its link asks: it leads to the other store's Home with
 * the page after the store's address (`?keep=/orders/drafts`), and that Home, on the server, opens the page there when the person can and
 * it is no record of this store, or itself (`keptPage()` in `kept-page.ts`). This file is the browser's half and imports nothing.
 */

/** The parameter of a store's Home that names the page to open instead (the address after the store's). */
export const KEEP_PARAM = "keep";

/** The longest address kept: an admin page's is far shorter, and the parameter is read before anything else. */
export const KEEP_MAX = 200;

/**
 * The switcher's link to store `to` from `pathname` in store `from`: the other store's Home, asking it to keep the page when the person is
 * on one of the current store's pages other than its Home. From another level (the control center, the platform) or from Home, Home.
 */
export function switchHref(pathname: string, from: string | undefined, to: string): string {
  const home = `/admin/${to}`;
  const here = from ? `/admin/${from}` : null;
  if (!here || to === from || !pathname.startsWith(`${here}/`)) return home;
  const rest = pathname.slice(here.length).replace(/\/+$/, "");
  return rest && rest.length <= KEEP_MAX ? `${home}?${KEEP_PARAM}=${encodeURIComponent(rest)}` : home;
}
