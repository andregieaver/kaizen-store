"use server";

import { storeExtensionsOn } from "@/lib/extensions";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { recordGroups, recordQuery } from "@/lib/finder-records";
import { formatMoney } from "@/lib/money";
import { finderAnswer, finderResults, type FinderGroup } from "@/lib/page-finder";
import { can, canOpenPath } from "@/lib/permissions";
import { effectiveFeatures } from "@/lib/store-features";
import { holderOf } from "@/server/auth";
import { findRecords, memberScope } from "@/server/finder-records";
import { log } from "@/server/log";
import { requireMemberAny } from "@/server/permissions";
import { visitorLabel } from "@/server/support";

/**
 * The page finder's search in a store (admin redesign round 1): the pages this member can open in this store, its features' pages only while
 * they are on; then the store's records that match (ecosystem plan E2.2, D713): orders, customers, conversations, deals and products, each kind
 * only for a member who may read it (`memberScope()`), in one read. Membership is all the pages need; each kind of record asks its own key.
 * A failed read of records is logged and the pages are still answered.
 */
export async function findStorePagesAction(store: string, query: string): Promise<FinderGroup[]> {
  const member = await requireMemberAny(store);
  const holder = holderOf(member);
  const lang = adminLangOf(member.account.adminLocale);
  const asked = String(query ?? "");
  const pages = finderResults("store", asked, {
    storeSlug: member.store.slug,
    lang,
    flags: {
      features: effectiveFeatures(member.store),
      extensions: storeExtensionsOn(member.store),
      work: member.store.workOn,
      owner: can(holder, "owner"),
      canOpen: (page) => page.area !== "store" || canOpenPath(holder, page.path, member.store.workspace),
    },
  }).map((item) => ({ ...item, group: navWord(lang, item.group) }));
  const q = recordQuery(asked);
  if (!q) return finderAnswer(pages);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  try {
    const found = await findRecords([memberScope(member)], q);
    const records = recordGroups(found, {
      storeOf: (id) => (id === member.store.id ? member.store : undefined),
      money: (minor, currency) => formatMoney(minor, currency, locale),
      visitor: visitorLabel,
    });
    return finderAnswer(pages, records);
  } catch (error) {
    log("error", "finder.records_failed", { storeId: member.store.id }, error);
    return finderAnswer(pages);
  }
}
