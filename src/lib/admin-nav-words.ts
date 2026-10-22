import type { AdminLang } from "./admin-lang";
import { NAV_NB } from "./admin-messages/nav.nb";

/**
 * The admin's navigation in the account's language (D312 A2): its texts are written in English in `store-nav.ts`, `owner-nav.ts` and
 * `platform-nav.ts` (the tests and the admin map key them so) and shown through `navWord()`, which reads the Norwegian from `NAV_NB`.
 * A text with no Norwegian stays English (the test refuses one in the navigation).
 */
export function navWord(lang: AdminLang, text: string): string {
  return lang === "nb" ? (NAV_NB[text] ?? text) : text;
}

/** Tabs or a sidebar's links with their labels in `lang`. */
export const navItemsIn = <T extends { label: string }>(lang: AdminLang, items: readonly T[]): T[] => items.map((i) => ({ ...i, label: navWord(lang, i.label) }));

/** Sidebar areas with their headings and links in `lang`. */
export const navAreasIn = <T extends { groups: { heading: string; items: { label: string }[] }[] }>(lang: AdminLang, areas: readonly T[]): T[] =>
  areas.map((a) => ({ ...a, groups: a.groups.map((g) => ({ ...g, heading: navWord(lang, g.heading), items: navItemsIn(lang, g.items) })) }));
