import { Suspense } from "react";

import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { LEVEL_LAYOUTS } from "@/lib/admin-layouts";
import { ownerAreas, ownerTabs } from "@/lib/owner-nav";
import { requireAccount } from "@/server/auth";
import { waitingCount } from "@/server/support";
import { ownerDesks } from "@/server/support-desk";

/**
 * The store owner's level (D107, D147): the control center over all their
 * stores, their stores, Work (D123) and their account, as tabs with icons in
 * the platform's pattern (D144). Billing, AI usage and Referrals (D131) are
 * pages of Account, in its sidebar, and the whole width is theirs. Someone who
 * only works in stores (staff) sees Stores and their account, and Work when
 * one of their stores has it on. Drawn in the `rail` layout (D219), Account at
 * the rail's foot.
 */
export default async function OwnerLayout({ children }: LayoutProps<"/admin">) {
  const account = await requireAccount();
  const stores = await storesOf(account);
  const owner = stores.some((store) => store.role === "owner");
  // Work (D123): the owner's, across their stores, so owners always have it (to switch it on); staff only where it is on.
  // Support (D216): the combined inbox of the stores whose support the account may read, with the number waiting.
  const desks = await ownerDesks(account);
  const who = { owner, work: owner || stores.some((store) => store.workOn), support: desks.length > 0 };
  const waiting = desks.length > 0 ? await waitingCount(desks.map((d) => d.desk)) : 0;
  const tabs: NavItem[] = ownerTabs(who, { support: waiting });
  const areas: NavArea[] = ownerAreas(who);
  return (
    <AdminFrame
      layout={LEVEL_LAYOUTS.control}
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
