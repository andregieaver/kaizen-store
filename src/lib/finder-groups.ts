import type { RecordKind } from "./finder-records";

/**
 * The page finder's answer as the browser draws it (admin redesign round 1, ecosystem plan E2.2): its rows and their groups. Pure and small, apart
 * from `page-finder.ts`, which reads the admin map: the finder's button is on every admin screen, so whatever it imports is in every screen's
 * first scripts, and the admin map is not to be (`e2e/signed-in/admin-scripts.spec.ts`).
 */

/** One row of the finder: what it is called, a word on the right (a page's section, a record's store), a line under it, and where it opens. */
export type FinderItem = { title: string; group: string; what: string; href: string };

/** The rows under one heading: the pages, or one kind of record. */
export type FinderGroup = { kind: "pages" | RecordKind; items: FinderItem[] };

/** The finder's answer: the pages (when any matched) and then each kind of record, as given. */
export function finderAnswer(pages: FinderItem[], records: readonly FinderGroup[] = []): FinderGroup[] {
  return [...(pages.length > 0 ? [{ kind: "pages" as const, items: pages }] : []), ...records.filter((group) => group.items.length > 0)];
}

/** The rows of an answer in the order they are drawn, for the arrow keys and the active option. */
export const finderOptions = (groups: readonly FinderGroup[]): FinderItem[] => groups.flatMap((group) => group.items);
