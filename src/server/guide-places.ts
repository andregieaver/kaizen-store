import "server-only";

import type { AdminLang } from "@/lib/admin-lang";
import { navAreasIn, navItemsIn, navWord } from "@/lib/admin-nav-words";
import { GUIDE_WORDS } from "@/lib/admin-words/guide";
import { OWNER_CORE_PLACES, PLATFORM_CORE_PLACES, STORE_CORE_PLACES, guidePlaces, guidePlacesFromNav, type GuidePlace } from "@/lib/guide";
import { OWNER_BASE, ownerAreas, ownerTabs } from "@/lib/owner-nav";
import { canOpenPath, permissionOfPath } from "@/lib/permissions";
import { PLATFORM_BASE, PLATFORM_SECTIONS, platformNav } from "@/lib/platform-nav";
import { keyAllowedWhenNotOpen } from "@/lib/store-closure";
import { STORE_SECTIONS, storeNav } from "@/lib/store-nav";

import { holderOf, listStores, type Account, type Membership } from "./auth";
import { ownerWho } from "./owner-level";
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

/**
 * The places of the owner's level, the control center (D909): its tabs as the person is shown them (`ownerWho()`, the layout's rule), each
 * keyed by its address, with Account's sidebar for its everyday pages. Only an owner has its Home and so its welcome, the rail.
 */
const OWNER_KEYS: Record<string, string> = {
  [`${OWNER_BASE}/stores`]: "my-stores",
  [`${OWNER_BASE}/account/support`]: "inbox",
  [`${OWNER_BASE}/account/books`]: "books",
  [`${OWNER_BASE}/account`]: "account",
};

export async function ownerGuidePlaces(account: Account, lang: AdminLang): Promise<GuidePlace[]> {
  const { who } = await ownerWho(account, await listStores(account));
  const tabs = navItemsIn(lang, ownerTabs(who));
  const areas = navAreasIn(lang, ownerAreas(who));
  const sections = ownerTabs(who).flatMap((tab, i) => {
    if (tab.home) return [];
    const key = OWNER_KEYS[tab.href] ?? (tab.href.endsWith("/work") ? "work" : null);
    if (!key) return [];
    // A tab's sidebar is the area holding its address, or (Account's) the pages its tab marks.
    const area = areas.find((a) => a.prefixes.includes(tab.href) || (tab.also ?? []).some((path) => a.prefixes.includes(path)));
    const items = area?.groups.flatMap((g) => g.items) ?? [];
    return [
      {
        key,
        href: tab.href,
        label: tabs[i].label,
        exact: tab.exact,
        within: [...(area?.prefixes ?? []), ...(tab.also ?? [])],
        also: items.filter((item) => !item.advanced).map((item) => item.label),
      },
    ];
  });
  return guidePlaces({ home: OWNER_BASE, sections, words: GUIDE_WORDS[lang], core: OWNER_CORE_PLACES, welcome: who.owner ? ["rail"] : [] });
}
