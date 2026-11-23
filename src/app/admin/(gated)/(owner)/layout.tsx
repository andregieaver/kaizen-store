import { Suspense } from "react";

import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import { AdminViewProvider, AdminViewToggle } from "@/components/admin/admin-view";
import { PageFinder } from "@/components/admin/page-finder";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { adminLangOf } from "@/lib/admin-lang";
import { LEVEL_LAYOUTS } from "@/lib/admin-layouts";
import { ownerAreas, ownerTabs } from "@/lib/owner-nav";
import { SHELL_WORDS } from "@/lib/admin-words/shell";
import { requireAccount } from "@/server/auth";
import { ownerWho } from "@/server/owner-level";
import { waitingCount } from "@/server/support";

import { adminViewAction } from "./account/shell-actions";
import { findOwnerAction } from "./finder-actions";

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
  // Work (D123): the owner's, across their stores, so owners always have it (to switch it on); staff only where it is on.
  // Support (D216): the combined inbox of the stores whose support the account may read, with the number waiting.
  // Books (D512): an accountant's clients, for someone who keeps or reads the books of a store they do not own, or of two or more.
  const { who, desks } = await ownerWho(account, stores);
  const waiting = desks.length > 0 ? await waitingCount(desks.map((d) => d.desk)) : 0;
  const tabs: NavItem[] = ownerTabs(who, { support: waiting });
  const areas: NavArea[] = ownerAreas(who);
  const lang = adminLangOf(account.adminLocale);
  const shell = SHELL_WORDS[lang];
  const w = shell.levels;
  const title = who.owner ? w.controlCenter : w.yourStores;
  // Basic or Advanced (D454, D884): the person's own choice, the one a store's admin and the platform show them, around the whole frame,
  // so Account's sidebar and the switch on Your account follow it at once.
  return (
    <AdminViewProvider saved={account.adminView ?? "basic"} save={adminViewAction}>
      <AdminFrame
        layout={LEVEL_LAYOUTS.control}
        lang={lang}
        switcher={
          <Suspense fallback={<span className="px-2 font-medium">{title}</span>}>
            <LevelSwitcher account={account} level="control" label={title} />
          </Suspense>
        }
        actions={
          <>
            {/* The page finder (ecosystem plan E2.2, D713): this level's pages and the records of every store the person may read, ⌘K. */}
            <PageFinder find={findOwnerAction} words={{ ...shell.finder, placeholder: shell.finder.placeholderRecords, hint: shell.finder.hintRecords }} />
            {/* Basic or Advanced (D884), as in a store; on phones it is in the menu. */}
            <div className="hidden md:block">
              <AdminViewToggle compact />
            </div>
          </>
        }
        account={<AdminAccountMenu account={account} />}
        tabs={tabs}
        groups={[]}
        areas={areas}
        wide
        tabsLabel={w.controlCenterSections}
        fullWidth={INBOX}
        menuTitle={<span className="font-medium">{title}</span>}
        menuFooter={<AdminViewToggle />}
      >
        {children}
      </AdminFrame>
    </AdminViewProvider>
  );
}
