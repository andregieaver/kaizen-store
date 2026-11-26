import "server-only";

import type { AdminLang } from "@/lib/admin-lang";
import { navAreasIn, navItemsIn, navWord } from "@/lib/admin-nav-words";
import { GUIDE_WORDS } from "@/lib/admin-words/guide";
import { PLATFORM_CORE_PLACES, STORE_CORE_PLACES, guidePlacesFromNav, type GuidePlace } from "@/lib/guide";
import { canOpenPath, permissionOfPath } from "@/lib/permissions";
import { PLATFORM_BASE, PLATFORM_SECTIONS, platformNav } from "@/lib/platform-nav";
import { keyAllowedWhenNotOpen } from "@/lib/store-closure";
import { STORE_SECTIONS, storeNav } from "@/lib/store-nav";

import { holderOf, type Account, type Membership } from "./auth";
import { memberCan } from "./permissions";

/**
 * A level's places for Guide (D909), from its menu as the person's frame draws it: the store's sections the member may open (the rule of the
 * store's layout: their role's areas, and only what a store that is not open still offers), or the platform's. Read by Guide's route when it
 * starts in the browser, so no admin document carries them.
 */
export function storeGuidePlaces(member: Membership, lang: AdminLang): GuidePlace[] {
  const { store } = member;
  const base = `/admin/${store.slug}`;
  const holder = holderOf(member);
  const open = store.status === "active";
  const canOpen = (path: string) => canOpenPath(holder, path, store.workspace) && (open || keyAllowedWhenNotOpen(permissionOfPath(path, "read")));
  const { tabs, areas } = storeNav(base, store, canOpen, {});
  return guidePlacesFromNav({
    home: base,
    tabs: navItemsIn(lang, tabs),
    areas: navAreasIn(lang, areas),
    words: GUIDE_WORDS[lang],
    intros: Object.fromEntries(STORE_SECTIONS.map((s) => [s.key, navWord(lang, s.intro)])),
    core: STORE_CORE_PLACES,
    // The AI manager is an owner's, in an open store (as the layout's launcher).
    welcome: memberCan(member, "owner") && open ? ["rail", "todo", "ai"] : ["rail", "todo"],
  });
}

export function platformGuidePlaces(account: Account, lang: AdminLang): GuidePlace[] {
  const { tabs, areas } = platformNav();
  return guidePlacesFromNav({
    home: PLATFORM_BASE,
    tabs: navItemsIn(lang, tabs),
    areas: navAreasIn(lang, areas),
    words: GUIDE_WORDS[lang],
    intros: Object.fromEntries(PLATFORM_SECTIONS.flatMap((s) => (s.intro ? [[s.key, navWord(lang, s.intro)]] : []))),
    core: PLATFORM_CORE_PLACES,
    // The platform's Home has no next step's card; its AI manager is the owners' (D510).
    welcome: account.platformAdmin ? ["rail", "ai"] : ["rail"],
  });
}
