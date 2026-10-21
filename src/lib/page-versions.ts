/**
 * A page's versions as the page builder shows them (D305; kept by `src/server/page-versions.ts`): what made each and who, in words.
 */

/** How many versions a page keeps. */
export const VERSIONS_KEPT = 50;

/** What made a version: a save of the draft, a publish, or words or CSS changed on the live site (D192, D306). */
export const VERSION_KINDS = ["saved", "published", "site_text", "site_css"] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

export const VERSION_KIND_WORDS: Record<VersionKind, string> = {
  saved: "Draft saved",
  published: "Published",
  site_text: "Text changed on the site",
  site_css: "CSS changed on the site",
};

export type PageVersionItem = { id: string; kind: VersionKind; at: string; by: string | null; title: string };
