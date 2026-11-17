/**
 * The page finder's rows and groups, apart from `page-finder.ts` (which reads the whole admin map and every page's Norwegian words): the
 * finder in the admin's top bar is drawn on every screen, so what it imports is in every screen's first scripts. Pure, and light.
 */

import type { RecordKind } from "./finder-records";

/** One row of the finder: what it is called, a word on the right (a page's section, a record's store), a line under it, and where it opens. */
export type FinderItem = { title: string; group: string; what: string; href: string };

/** The rows under one heading: the pages, or one kind of record. */
export type FinderGroup = { kind: "pages" | RecordKind; items: FinderItem[] };

/** The rows of an answer in the order they are drawn, for the arrow keys and the active option. */
export const finderOptions = (groups: readonly FinderGroup[]): FinderItem[] => groups.flatMap((group) => group.items);
