import { Suspense } from "react";

import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { adminLangOf } from "@/lib/admin-lang";
import { LEVEL_LAYOUTS } from "@/lib/admin-layouts";
import { adminText } from "@/lib/admin-text";
import { ownerAreas, ownerTabs } from "@/lib/owner-nav";
import { requireAccount } from "@/server/auth";
import { waitingCount } from "@/server/support";
import { ownerDesks } from "@/server/support-desk";

/** The combined support inbox is drawn in the `workspace` layout (D230): its own columns across the width, beside a narrowed rail. */
const INBOX = String.raw`^/admin/account/support$`;

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
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "shell").levels;
  const title = owner ? w.controlCenter : w.yourStores;
  return (
    <AdminFrame
      layout={LEVEL_LAYOUTS.control}
      lang={lang}
      switcher={
        <Suspense fallback={<span className="px-2 font-medium">{title}</span>}>
          <LevelSwitcher account={account} level="control" label={title} />
        </Suspense>
      }
      account={<AdminAccountMenu account={account} />}
      tabs={tabs}
      groups={[]}
      areas={areas}
      wide
      tabsLabel={w.controlCenterSections}
      fullWidth={INBOX}
      menuTitle={<span className="font-medium">{title}</span>}
    >
      {children}
    </AdminFrame>
  );
}
