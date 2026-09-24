import Link from "next/link";
import { Suspense } from "react";

import { SignOutForm } from "@/components/admin/admin-trail";
import { SessionKeeper, SessionRecovery } from "@/components/admin/session";
import { getAccount } from "@/server/auth";
import { countPendingRequests } from "@/server/platform";

import { signOut } from "./actions";

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
  const pending = account.platformAdmin ? await countPendingRequests() : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <SessionKeeper />
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold">
            Kaizen
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {account.platformAdmin && (
              <Link href="/admin/platform" className="underline">
                Platform{pending > 0 ? ` (${pending} waiting)` : ""}
              </Link>
            )}
            <Link href="/admin/account" className="text-muted underline" title="Your account">
              {account.email}
            </Link>
            <SignOutForm action={signOut} />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
