import "server-only";

import { pageTag, pagesTag } from "@/lib/cache-tags";

import type { PageOwner } from "./page-reads";

/**
 * Which tags a publish refreshes (bloat review step 2.14). Every read of one page's document carries the page's own tag, `page:{id}`
 * (findPublishedPage, publishedPageById, siteLayoutFor, productLayoutById, siteVersionContent, findEntryPage's layout, a recommending
 * grid's words); every read of lists, menus and indexes carries the owner's pages tag. A publish whose scope is `page` (savePage():
 * nothing other pages show of it changed) refreshes only the page's tag; `site`, or a scope not known, both.
 *
 * The eight places that publish a body decide here: the store's and the platform's page actions (saveStorePageAction,
 * savePlatformPageAction), page-text-edit.ts (a block's words edited on the live page), page-css-edit.ts (a page's own CSS: always its own),
 * the three in site-tools.ts (publish_page decides here; a header's or footer's publish with chooseSiteLayout and a page chosen for a place
 * stay site-wide), and the schedule runner (page-schedules.ts, through publishedTags() in the dispatcher). Every other publisher through
 * savePage() (store-drafts.ts, dream-factory.ts, admin-api-content.ts, experiment-tools.ts, site-staging.ts, content-packs.ts,
 * legal-writer.ts and the rest) keeps refreshing the owner's pages tag, which stays correct; owner-tools.ts has no savePage() call (its page
 * tool is the unpublish tool, site-wide).
 */
export function tagsAfterPublish(owner: PageOwner, id: string, scope: "page" | "site" | undefined): string[] {
  return scope === "page" ? [pageTag(id)] : [pageTag(id), pagesTag(owner)];
}

/** What a run of the schedule runner (`runSchedules()`) changed: each published page with its scope, and the stores to refresh whole. */
export type ScheduledChanges = { pages?: { store: string; id: string; scope: "page" | "site" }[]; stores?: string[] };

/** The tags a schedule run refreshes: each published page's (`tagsAfterPublish()`), and the pages tag of each store a revert or a site-wide publish changed. */
export function publishedTags(run: ScheduledChanges | null | undefined): string[] {
  const tags = new Set<string>();
  for (const p of run?.pages ?? []) for (const tag of tagsAfterPublish(p.store, p.id, p.scope)) tags.add(tag);
  for (const store of run?.stores ?? []) tags.add(pagesTag(store));
  return [...tags];
}
