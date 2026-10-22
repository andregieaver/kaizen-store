import { Suspense } from "react";

import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher } from "@/components/admin/admin-shell-parts";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requireAccount } from "@/server/auth";

/** An outside host's small area (D71) in the same shell as the rest of the admin (D107). */
export default async function HostingLayout({ children }: LayoutProps<"/admin/hosting">) {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "shell").levels;
  return (
    <AdminFrame
      lang={lang}
      switcher={
        <Suspense fallback={<span className="px-2 font-medium">{w.hosting}</span>}>
          <LevelSwitcher account={account} level="hosting" label={w.hosting} />
        </Suspense>
      }
      account={<AdminAccountMenu account={account} role={w.host} />}
      tabs={[]}
      groups={[]}
      tabsLabel={w.hosting}
      menuTitle={<span className="font-medium">{w.hosting}</span>}
    >
      {children}
    </AdminFrame>
  );
}
