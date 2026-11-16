"use server";

import { adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { finderResults, type FinderItem } from "@/lib/page-finder";
import { requirePlatform } from "@/server/auth";

/** The page finder's search on the platform (admin redesign round 1): Kaizena Flow's own pages, for anyone on its team (it reads the admin map and changes nothing). */
export async function findPlatformPagesAction(query: string): Promise<FinderItem[]> {
  const account = await requirePlatform("home", "read");
  const lang = adminLangOf(account.adminLocale);
  return finderResults("platform", String(query ?? ""), { lang }).map((item) => ({ ...item, group: navWord(lang, item.group) }));
}
