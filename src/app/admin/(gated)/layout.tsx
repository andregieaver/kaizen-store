import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";

import { AdminColorSync } from "@/components/admin/admin-colors";
import { AdminWaiting } from "@/components/admin/admin-waiting";
import { AdminSchemeSync } from "@/components/admin/admin-scheme";
import { AdminLangSync, AdminTextProvider } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { SessionKeeper, SessionRecovery } from "@/components/admin/session";
import { AdminServiceWorker } from "@/components/admin/admin-service-worker";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";
import { log } from "@/server/log";
import { renderCount, renderFields } from "@/server/render-count";
import { areaTexts } from "@/lib/admin-area";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { SHELL_WORDS } from "@/lib/admin-words/shell";

/**
 * Every signed-in admin page (D107). Each level draws its own header
 * with the shared shell (`AdminFrame`): the platform, a store, the owner's
 * control center and hosting; what is common is here, who may be here.
 */
export default function GatedLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminWaiting words={{ en: SHELL_WORDS.en.frame.loading, nb: SHELL_WORDS.nb.frame.loading }} />}>
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
    return <SessionRecovery waiting={{ en: SHELL_WORDS.en.frame.checkingSession, nb: SHELL_WORDS.nb.frame.checkingSession }} />;
  }
  // One line per render with two numbers and nothing else (step 1.9, D400): the statements it sent and how long it took.
  const counted = renderCount();
  after(() => log("info", "admin.render", renderFields(counted)));
  // The account's language for the admin (D312 A0): its client parts read their areas' words from the provider.
  const lang = adminLangOf(account.adminLocale);
  return (
    <AdminTextProvider lang={lang} texts={areaTexts(lang, { common: COMMON_WORDS, shell: SHELL_WORDS })}>
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
