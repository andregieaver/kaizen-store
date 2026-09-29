import "server-only";

import type { GridPlace } from "@/server/content-grid";
import { storeSlugOf } from "@/server/menus";
import { marketIn } from "@/server/shop";
import { getOpenStore } from "@/server/stores";

/**
 * The language a page is shown in at its place: its market's when it is a
 * store's, else English (Kaizen's own pages). For the few words the page
 * itself has to say, such as a modal's close button (D121).
 */
export async function placeLang(place: GridPlace): Promise<string> {
  if (!place.owner) return "en";
  const slug = await storeSlugOf(place.owner);
  const store = slug ? await getOpenStore(slug) : null;
  const market = store ? marketIn(store, place.market) : undefined;
  return market?.lang ?? "en";
}
