"use server";

import { adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { finderResults, type FinderItem } from "@/lib/page-finder";
import { can, canOpenPath } from "@/lib/permissions";
import { effectiveFeatures } from "@/lib/store-features";
import { holderOf } from "@/server/auth";
import { requireMemberAny } from "@/server/permissions";

/**
 * The page finder's search in a store (admin redesign round 1): the pages this member can open in this store, its features' pages only while
 * they are on. It reads only the admin map, so it needs no permission key beyond being a member.
 */
export async function findStorePagesAction(store: string, query: string): Promise<FinderItem[]> {
  const member = await requireMemberAny(store);
  const holder = holderOf(member);
  const lang = adminLangOf(member.account.adminLocale);
  const items = finderResults("store", String(query ?? ""), {
    storeSlug: member.store.slug,
    lang,
    flags: {
      features: effectiveFeatures(member.store),
      work: member.store.workOn,
      owner: can(holder, "owner"),
      canOpen: (page) => page.area !== "store" || canOpenPath(holder, page.path),
    },
  });
  return items.map((item) => ({ ...item, group: navWord(lang, item.group) }));
}
