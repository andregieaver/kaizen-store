import { Suspense } from "react";

import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import type { NavItem } from "@/components/admin/store-admin-nav";
import { requireAccount } from "@/server/auth";

/**
 * The store owner's level (D107): the control center over all their stores,
 * their stores, billing, AI usage and account. Five sections need no
 * sidebar, so they are the tabs. Someone who only works in stores (staff)
 * sees the two that are theirs.
 */
export default async function OwnerLayout({ children }: LayoutProps<"/admin">) {
  const account = await requireAccount();
  const owner = (await storesOf(account)).some((store) => store.role === "owner");
  const tabs: NavItem[] = owner
    ? [
        { href: "/admin", label: "Overview", exact: true },
        { href: "/admin/stores", label: "Stores" },
        { href: "/admin/account/billing", label: "Billing" },
        { href: "/admin/account/usage", label: "AI usage" },
        { href: "/admin/account", label: "Account", exact: true },
      ]
    : [
        { href: "/admin/stores", label: "Stores" },
        { href: "/admin/account", label: "Account", exact: true },
      ];
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
      tabsLabel="Control center sections"
      menuTitle={<span className="font-medium">{owner ? "Control center" : "Your stores"}</span>}
    >
      {children}
    </AdminFrame>
  );
}
