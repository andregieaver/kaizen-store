import "server-only";

import { themeLayersOf, type ThemeLayers } from "@/lib/section-styles";

import { storeSlugOf } from "./menus";
import { getPlatformTheme } from "./platform-navigation";
import { getStore } from "./stores";

/** What a store's (or Kaizena Flow's) theme lays under its pages' rows: the site's elements and its section styles (D242). Cached reads. */
export async function themeLayersFor(owner: string | null): Promise<ThemeLayers> {
  if (!owner) return themeLayersOf((await getPlatformTheme()).settings);
  const slug = await storeSlugOf(owner);
  const store = slug ? await getStore(slug) : null;
  return store ? themeLayersOf(store.theme.settings) : { elements: undefined, sections: undefined };
}
