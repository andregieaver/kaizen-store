import "server-only";

import { DEFAULT_BREAKPOINTS, breakpointsOf, type Breakpoints } from "@/lib/breakpoints";

import { storeSlugOf } from "./menus";
import { getStore } from "./stores";

/**
 * The screen sizes a page's part rules are written for (D179): its store's theme's (`ThemeSettings.breakpoints`), or the
 * defaults for Kaizen's own pages and a store that cannot be read. Cached reads only, as the store's other settings.
 */
export async function breakpointsFor(owner: string | null): Promise<Breakpoints> {
  if (!owner) return DEFAULT_BREAKPOINTS;
  const slug = await storeSlugOf(owner);
  const store = slug ? await getStore(slug) : null;
  return breakpointsOf(store?.theme.settings);
}
