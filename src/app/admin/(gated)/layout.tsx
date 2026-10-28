import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AdminColorSync } from "@/components/admin/admin-colors";
import { AdminSchemeSync } from "@/components/admin/admin-scheme";
import { AdminLangSync, AdminTextProvider } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminTexts } from "@/lib/admin-text";
import { SessionKeeper, SessionRecovery } from "@/components/admin/session";
import { AdminServiceWorker } from "@/components/admin/push-settings";
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
  // The account's language for the admin (D312 A0): its client parts read their areas' words from the provider.
  const lang = adminLangOf(account.adminLocale);
  return (
    <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "setup", "shell"])}>
      <div className="flex min-h-screen flex-col">
        <SessionKeeper />
        <AdminColorSync saved={account.colorMode ?? "system"} />
        <AdminSchemeSync saved={account.adminScheme ?? "meadow"} />
        <AdminLangSync lang={lang} />
        <AdminServiceWorker />
        {children}
      </div>
    </AdminTextProvider>
  );
}
