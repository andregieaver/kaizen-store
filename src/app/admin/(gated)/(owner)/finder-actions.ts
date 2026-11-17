"use server";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { recordGroups, recordQuery } from "@/lib/finder-records";
import { formatMoney } from "@/lib/money";
import { ownerOpens } from "@/lib/owner-nav";
import { finderAnswer, finderResults, type FinderGroup } from "@/lib/page-finder";
import { mayUseAdmin } from "@/lib/two-step";
import { assuranceFor, getAssurance, listStores, requireAccount } from "@/server/auth";
import { accountScopes, findRecords, type ScopedStore } from "@/server/finder-records";
import { log } from "@/server/log";
import { ownerWho } from "@/server/owner-level";
import { visitorLabel } from "@/server/support";

/**
 * The page finder's search at the owner's level (ecosystem plan E2.2, D713): the level's own pages the person is shown (`ownerOpens()`), then
 * the records that match in every store they work in, each store by its own role, keys, features and second step (`accountScopes()`), as
 * that store's admin would let them read it; each record names its store. One read for the records, whatever the number of stores.
 */
export async function findOwnerAction(query: string): Promise<FinderGroup[]> {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const asked = String(query ?? "");
  const q = recordQuery(asked);
  const [{ who }, scopes] = await Promise.all([
    listStores(account).then((stores) => ownerWho(account, stores)),
    q
      ? storeScopes(account.id).catch((error: unknown): ScopedStore[] => {
          log("error", "finder.records_failed", { accountId: account.id }, error);
          return [];
        })
      : Promise.resolve<ScopedStore[]>([]),
  ]);
  const pages = finderResults("account", asked, { lang, flags: { owner: who.owner, work: who.work, canOpen: (page) => ownerOpens(who, page.path) } }).map((item) => ({
    ...item,
    group: navWord(lang, item.group),
  }));
  if (!q || scopes.length === 0) return finderAnswer(pages);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  try {
    const stores = new Map(scopes.map((scope) => [scope.storeId, scope]));
    const records = recordGroups(await findRecords(scopes, q), {
      storeOf: (id) => stores.get(id),
      money: (minor, currency) => formatMoney(minor, currency, locale),
      visitor: visitorLabel,
      showStore: scopes.length > 1,
    });
    return finderAnswer(pages, records);
  } catch (error) {
    log("error", "finder.records_failed", { accountId: account.id }, error);
    return finderAnswer(pages);
  }
}

/** The stores whose records the person may be offered: the session's second step is held to each store's own requirement. */
async function storeScopes(accountId: string): Promise<ScopedStore[]> {
  const held = await getAssurance();
  if (!held) return [];
  return accountScopes(accountId, (requires) => mayUseAdmin(assuranceFor(held.session, requires)));
}
