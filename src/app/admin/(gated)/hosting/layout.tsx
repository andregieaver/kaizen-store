import { Suspense } from "react";

import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher } from "@/components/admin/admin-shell-parts";
import { requireAccount } from "@/server/auth";

/** An outside host's small area (D71) in the same shell as the rest of the admin (D107). */
export default async function HostingLayout({ children }: LayoutProps<"/admin/hosting">) {
  const account = await requireAccount();
  return (
    <AdminFrame
      switcher={
        <Suspense fallback={<span className="px-2 font-medium">Hosting</span>}>
          <LevelSwitcher account={account} level="hosting" label="Hosting" />
        </Suspense>
      }
      account={<AdminAccountMenu account={account} role="Host" />}
      tabs={[]}
      groups={[]}
      tabsLabel="Hosting"
      menuTitle={<span className="font-medium">Hosting</span>}
    >
      {children}
    </AdminFrame>
  );
}
