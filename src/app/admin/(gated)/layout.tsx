import { Suspense } from "react";

import { AdminColorSync } from "@/components/admin/admin-colors";
import { SessionKeeper, SessionRecovery } from "@/components/admin/session";
import { getAccount } from "@/server/auth";

/**
 * Every signed-in admin page (D107). Each level draws its own header
 * with the shared shell (`AdminFrame`): the platform, a store, the owner's
 * control center and hosting; what is common is here, who may be here.
 */
export default function GatedLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted">Loading …</p>}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

/** Admits signed-in accounts only; everyone else is sent to sign in. */
async function Gate({ children }: { children: React.ReactNode }) {
  const account = await getAccount();
  if (!account) return <SessionRecovery />;
  return (
    <div className="flex min-h-screen flex-col">
      <SessionKeeper />
      <AdminColorSync saved={account.colorMode ?? "system"} />
      {children}
    </div>
  );
}
