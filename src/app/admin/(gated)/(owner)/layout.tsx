import { Suspense } from "react";

import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { ownerAreas, ownerTabs } from "@/lib/owner-nav";
import { requireAccount } from "@/server/auth";

/**
 * The store owner's level (D107, D147): the control center over all their
 * stores, their stores, Work (D123) and their account, as tabs with icons in
 * the platform's pattern (D144). Billing, AI usage and Referrals (D131) are
 * pages of Account, in its sidebar, and the whole width is theirs. Someone who
 * only works in stores (staff) sees Stores and their account, and Work when
 * one of their stores has it on.
 */
export default async function OwnerLayout({ children }: LayoutProps<"/admin">) {
  const account = await requireAccount();
  const stores = await storesOf(account);
  const owner = stores.some((store) => store.role === "owner");
  // Work (D123): the owner's, across their stores, so owners always have it (to switch it on); staff only where it is on.
  const who = { owner, work: owner || stores.some((store) => store.workOn) };
  const tabs: NavItem[] = ownerTabs(who);
  const areas: NavArea[] = ownerAreas(who);
  return (
    <AdminFrame
      switcher={
        <Suspense fallback={<span className="px-2 font-medium">{owner ? "Control center" : "Your stores"}</span>}>
          <LevelSwitcher account={account} level="control" label={owner ? "Control center" : "Your stores"} />
        </Suspense>
      }
      account={<AdminAccountMenu account={account} />}
      tabs={tabs}
      groups={[]}
      areas={areas}
      wide
      tabsLabel="Control center sections"
      menuTitle={<span className="font-medium">{owner ? "Control center" : "Your stores"}</span>}
    >
      {children}
    </AdminFrame>
  );
}
