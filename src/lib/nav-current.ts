/**
 * Which link of a menu is the page being viewed (code review step 2.2, D873): of one list of links (a level's sections, a section's
 * sidebar), only the one whose address the page is deepest inside, the rule `sectionOf()` uses for a store's sections. Pure and small,
 * so the browser carries it: the rail, the tabs, the sidebars, the phone's menu and the page header's eyebrow all read it.
 */

/** A link as the menu sends it to the browser: its address, whether it is marked on that address alone, and other addresses that are it. */
export type NavLink = { href: string; exact?: boolean; also?: readonly string[]; section?: string };

/** A section's addresses (its sidebar's `prefixes`, a page of cards in `exact`), keyed as its tab names it (`NavLink.section`). */
export type NavPlace = { section?: string; prefixes: readonly string[]; exact?: readonly string[] };

/** An address is inside `prefix` when it is that address or below it. */
export const inside = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The item `path` is deepest inside, the first of equals, or -1: the longest of its addresses the page is at (`at`, for that address alone)
 * or at or below (`under`).
 */
function deepest<T>(path: string, items: readonly T[], at: (item: T) => readonly string[], under: (item: T) => readonly string[]): number {
  let found = -1;
  let depth = -1;
  items.forEach((item, i) => {
    for (const a of at(item)) if (a.length > depth && path === a) [found, depth] = [i, a.length];
    for (const a of under(item)) if (a.length > depth && inside(path, a)) [found, depth] = [i, a.length];
  });
  return found;
}

/**
 * Of one list of links, the one the page is deepest inside, or -1: the one link marked. An `exact` link's own address counts for itself
 * only, its `also` for the pages below them too (D147); a tab that names its section and sends no `also` is inside that section's
 * addresses in `places` (bloat review step 2.28).
 */
export function currentIndex(path: string, links: readonly NavLink[], places: readonly NavPlace[] = []): number {
  return deepest(
    path,
    links,
    (link) => (link.exact ? [link.href] : []),
    (link) => [...(link.exact ? [] : [link.href]), ...(link.also ?? (link.section === undefined ? [] : (places.find((p) => p.section === link.section)?.prefixes ?? [])))],
  );
}

/** The section whose sidebar a page shows: the one whose addresses it is deepest inside (a page of cards only on itself), or -1. */
export function placeIndex(path: string, places: readonly NavPlace[]): number {
  return deepest(path, places, (place) => place.exact ?? [], (place) => place.prefixes);
}
