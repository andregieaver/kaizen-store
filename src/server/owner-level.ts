import "server-only";

import { showsClients } from "@/lib/books-clients";
import type { OwnerWho } from "@/lib/owner-nav";

import { listWorkspaces, type Account, type StoreSummary } from "./auth";
import { booksClientStores } from "./books-clients";
import { holdsDomains } from "./domain-account";
import { ownerDesks, type StaffDesk } from "./support-desk";

/**
 * Who a person is at the owner's level (D107, D147): an owner of a store, someone with Work in one (D123), someone who may read a store's
 * support (D216), a domain's holder (D317), an accountant with clients (D512). The layout draws its tabs from it and the page finder
 * offers its pages by it (ecosystem plan E2.2, D713), so both ask the one rule. `stores` is the account's list (`listStores()`), which the
 * caller already holds; a workspace's owner (D748 E7) owns their account as a store's owner does.
 */
export async function ownerWho(account: Account, stores: readonly StoreSummary[]): Promise<{ who: OwnerWho; desks: StaffDesk[] }> {
  const workspaces = await listWorkspaces(account);
  const places = [...stores, ...workspaces];
  const owner = places.some((store) => store.role === "owner");
  const [desks, domains, books] = await Promise.all([ownerDesks(account), owner ? Promise.resolve(true) : holdsDomains(account.id), booksClientStores(account)]);
  return {
    // Work's tab (D123) is an owner's whose account has the Work extension (D748), or anyone's in a store that uses it.
    who: { owner, work: places.some((store) => (store.role === "owner" && store.workExtension) || store.workOn), support: desks.length > 0, domains, books: showsClients(books) },
    desks,
  };
}
