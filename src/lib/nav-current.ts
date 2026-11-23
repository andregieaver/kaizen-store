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
 * How deep a page is inside a link: the length of the longest of the link's addresses the page is at or below, or -1. An `exact` link's
 * own address counts for itself only; its other addresses (`also`) count for the pages below them too (D147).
 */
export function depthIn(path: string, link: Pick<NavLink, "href" | "exact">, also: readonly string[] = []): number {
  let depth = (link.exact ? path === link.href : inside(path, link.href)) ? link.href.length : -1;
  for (const prefix of also) if (prefix.length > depth && inside(path, prefix)) depth = prefix.length;
  return depth;
}

/** A link's other addresses: its own `also`, or, for a tab that names its section and sends none, that section's (bloat review step 2.28). */
export function alsoOf(link: NavLink, places: readonly NavPlace[]): readonly string[] {
  if (link.also !== undefined || link.section === undefined) return link.also ?? [];
  return places.find((place) => place.section === link.section)?.prefixes ?? [];
}

/** Of one list of links, the one the page is deepest inside (the first of equals), or -1 where it is inside none: the one link marked. */
export function currentIndex(path: string, links: readonly NavLink[], places: readonly NavPlace[] = []): number {
  let found = -1;
  let deepest = -1;
  links.forEach((link, i) => {
    const depth = depthIn(path, link, alsoOf(link, places));
    if (depth > deepest) {
      found = i;
      deepest = depth;
    }
  });
  return found;
}

/** The section whose sidebar a page shows: the one whose addresses it is deepest inside (a page of cards only on itself), or -1. */
export function placeIndex(path: string, places: readonly NavPlace[]): number {
  let found = -1;
  let deepest = -1;
  places.forEach((place, i) => {
    let depth = (place.exact ?? []).includes(path) ? path.length : -1;
    for (const prefix of place.prefixes) if (prefix.length > depth && inside(path, prefix)) depth = prefix.length;
    if (depth > deepest) {
      found = i;
      deepest = depth;
    }
  });
  return found;
}
