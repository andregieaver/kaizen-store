import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AdminColorSync } from "@/components/admin/admin-colors";
import { SessionKeeper, SessionRecovery } from "@/components/admin/session";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";

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

/**
 * Admits signed-in accounts only; everyone else is sent to sign in. `getAccount()` fails closed (wave 1, 1f): a person whose
 * second step is due (a factor not yet used in this session, or a requirement and no factor) is not let in and is sent to the
 * page for it, never to the recovery that would take them for an expired session.
 */
async function Gate({ children }: { children: React.ReactNode }) {
  const account = await getAccount();
  if (!account) {
    const held = await getAssurance();
    const destination = held ? heldDestination(held.assurance) : null;
    if (destination) redirect(destination);
    return <SessionRecovery />;
  }
  return (
    <div className="flex min-h-screen flex-col">
      <SessionKeeper />
      <AdminColorSync saved={account.colorMode ?? "system"} />
      {children}
    </div>
  );
}
