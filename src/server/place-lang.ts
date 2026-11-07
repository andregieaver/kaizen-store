import "server-only";

import { langOfLocale, type PlatformLang } from "@/lib/platform-lang";
import type { GridPlace } from "@/server/content-grid";
import { storeSlugOf } from "@/server/menus";
import { marketIn } from "@/server/shop";
import { getOpenStore } from "@/server/stores";

/**
 * The language a page is shown in at its place: its market's when it is a
 * store's, else the language of Kaizena Flow's own page (D312: English, or
 * Norwegian under `/no`). For the few words the page itself has to say, such
 * as a modal's close button (D121) or a table's icons (D201).
 */
export async function placeLang(place: GridPlace): Promise<string> {
  if (!place.owner) return place.lang ?? "en";
  const slug = await storeSlugOf(place.owner);
  const store = slug ? await getOpenStore(slug) : null;
  const market = store ? marketIn(store, place.market) : undefined;
  return market?.lang ?? "en";
}

/**
 * The language of Kaizena Flow's own site a page is shown in (D312), for Kaizena Flow's own parts (its plans, domain search and list of
 * themes): its own page's, or its own store's market's while the store serves the site (D484), whose pages carry no `lang`; else English.
 */
export async function sitePlaceLang(place: GridPlace): Promise<PlatformLang> {
  return langOfLocale(await placeLang(place)) ?? "en";
}
