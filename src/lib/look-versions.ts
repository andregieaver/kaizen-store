import type { StoreTheme } from "./theme";

/**
 * Versions of a store's live look (wave 7 unit F, D340, `docs/wave-7-storefront.md` F; kept by `src/server/look-versions.ts`): the theme as
 * each save in Design settings, the page builder's Theme tab or its saved colours left it, and who saved it. Pure.
 */

/** How many versions of its look a store keeps. */
export const LOOK_VERSIONS_KEPT = 50;

/** What made a version: Design settings, the page builder's Theme tab, or its saved colours. */
export const LOOK_VERSION_KINDS = ["design", "theme_tab", "colours"] as const;
export type LookVersionKind = (typeof LOOK_VERSION_KINDS)[number];
export const isLookVersionKind = (value: unknown): value is LookVersionKind => (LOOK_VERSION_KINDS as readonly unknown[]).includes(value);

export type LookVersionItem = { id: string; kind: LookVersionKind; at: string; by: string | null };

/** The live look's versions as the theme editor reads them (D340): the list, and one version's theme. */
export type LookVersionActions = {
  list: () => Promise<LookVersionItem[]>;
  read: (version: string) => Promise<{ ok: true; theme: StoreTheme } | { ok: false; problem: string }>;
};
