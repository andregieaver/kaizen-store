/**
 * The admin pages' Norwegian titles and keywords (D312 A2), the `pages` area's module (bloat review step 2.50): the English is each page's
 * own in `admin-map.ts`, so the area has one language. Code reads it here, never `admin-messages/pages.nb.ts` itself. Never import this from
 * a "use client" file. The admin map's search takes it as an argument (`findPages()`), so the map, which shoppers' routes reach, brings
 * none of it.
 */
import type { AdminLang } from "../admin-lang";
import type { AdminPage } from "../admin-map";
import { PAGES_NB } from "../admin-messages/pages.nb";

export const PAGES_WORDS: Record<Exclude<AdminLang, "en">, typeof PAGES_NB> = { nb: PAGES_NB };

/**
 * A page's name in the admin's language, as the menu says it (D881): in English its menu word, or its title where it is not in the menu
 * (`pageName()`); in Norwegian its title here, which for a page in the menu is the menu's Norwegian word (`admin-pages-nb.test.ts`). What
 * the page finder, the AI manager's first suggestion and the docs show.
 */
export function pageNameIn(lang: AdminLang, page: Pick<AdminPage, "area" | "id" | "title" | "navLabel">): string {
  const english = page.navLabel ?? page.title;
  return lang === "en" ? english : (PAGES_WORDS[lang][`${page.area}:${page.id}`]?.title ?? english);
}
