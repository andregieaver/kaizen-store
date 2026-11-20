/**
 * The admin pages' Norwegian titles and keywords (D312 A2), the `pages` area's module (bloat review step 2.50): the English is each page's
 * own in `admin-map.ts`, so the area has one language. Code reads it here, never `admin-messages/pages.nb.ts` itself. Never import this from
 * a "use client" file. The admin map's search takes it as an argument (`findPages()`), so the map, which shoppers' routes reach, brings
 * none of it.
 */
import type { AdminLang } from "../admin-lang";
import { PAGES_NB } from "../admin-messages/pages.nb";

export const PAGES_WORDS: Record<Exclude<AdminLang, "en">, typeof PAGES_NB> = { nb: PAGES_NB };
