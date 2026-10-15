import "server-only";

import type { SectionStyles } from "@/lib/section-styles";
import type { ThemeElements } from "@/lib/theme-elements";

import { storeSlugOf } from "./menus";
import { getPlatformTheme } from "./platform-navigation";
import { getStore } from "./stores";

/** What a store's (or Kaizena Flow's) theme lays under its pages' rows: the site's elements and its section styles (D242). Cached reads. */
export async function themeLayersFor(owner: string | null): Promise<{ elements: ThemeElements | undefined; sections: SectionStyles | undefined }> {
  if (!owner) {
    const settings = (await getPlatformTheme()).settings;
    return { elements: settings.elements, sections: settings.sectionStyles };
  }
  const slug = await storeSlugOf(owner);
  const store = slug ? await getStore(slug) : null;
  return { elements: store?.theme.settings.elements, sections: store?.theme.settings.sectionStyles };
}
