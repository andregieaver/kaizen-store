import "server-only";

import type { ThemeElements } from "@/lib/theme-elements";

import { storeSlugOf } from "./menus";
import { getPlatformTheme } from "./platform-navigation";
import { getStore } from "./stores";

/**
 * What a store's Theme tab says for its rows, headings, text and buttons (D182, `ThemeSettings.elements`): laid under the
 * parts of its pages when they are drawn; Kaizen's own pages take Kaizen's theme (D235). None for a store that cannot be read.
 * Cached reads only, as the store's other settings.
 */
export async function themeElementsFor(owner: string | null): Promise<ThemeElements | undefined> {
  if (!owner) return (await getPlatformTheme()).settings.elements;
  const slug = await storeSlugOf(owner);
  const store = slug ? await getStore(slug) : null;
  return store?.theme.settings.elements;
}
