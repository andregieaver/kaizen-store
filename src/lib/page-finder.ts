/**
 * The page finder (admin redesign round 1, audit D454 phase 1 N6): the search button in the admin's top bar and ⌘K / Ctrl+K open it, and
 * what a person types is matched against the admin map (`ADMIN_PAGES`: titles, the words people use, what each page does), Advanced pages
 * included, so Basic's shorter navigation never hides a page. Only pages without params are offered: they are where people start. Pure.
 *
 * In a store and at the owner's level the pages are followed by the records that match (ecosystem plan E2.2, D713, `finder-records.ts`):
 * the answer is a list of groups, the pages first, then a group per kind of record.
 */

import type { AdminLang } from "./admin-lang";
import { findPages, pageHref, pageParams, type SiteFlags } from "./admin-map";
import { PAGES_NB } from "./admin-messages/pages.nb";
import type { FinderGroup, FinderItem } from "./finder-items";

export { finderOptions, type FinderGroup, type FinderItem } from "./finder-items";

/** The longest question looked at: anything longer is cut, never refused. */
export const FINDER_QUERY_MAX = 100;

/** The pages that best match what was typed, as links in the person's language. */
export function finderResults(
  area: "store" | "platform" | "account",
  query: string,
  { flags = {}, storeSlug, lang = "en", limit = 8 }: { flags?: SiteFlags; storeSlug?: string; lang?: AdminLang; limit?: number } = {},
): FinderItem[] {
  const asked = query.slice(0, FINDER_QUERY_MAX);
  const items: FinderItem[] = [];
  // More than the limit are asked for, since pages that need a param are passed over.
  for (const page of findPages(area, asked, flags, limit * 3)) {
    if (pageParams(page).length > 0) continue;
    const href = pageHref(page, {}, storeSlug);
    if (!href) continue;
    const nb = lang === "nb" ? PAGES_NB[`${page.area}:${page.id}`] : undefined;
    items.push({ title: nb?.title ?? page.title, group: page.group, what: page.what, href });
    if (items.length === limit) break;
  }
  return items;
}

/** The finder's answer: the pages (when any matched) and then each kind of record, as given. */
export function finderAnswer(pages: FinderItem[], records: readonly FinderGroup[] = []): FinderGroup[] {
  return [...(pages.length > 0 ? [{ kind: "pages" as const, items: pages }] : []), ...records.filter((group) => group.items.length > 0)];
}
