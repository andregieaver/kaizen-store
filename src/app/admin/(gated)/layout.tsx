import Link from "next/link";
import { Suspense } from "react";

import { SessionKeeper, SessionRecovery } from "@/components/admin/session";
import { getStaff } from "@/server/auth";

import { signOut } from "./actions";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/settings/payments", label: "Payments" },
  { href: "/admin/staff", label: "Staff" },
];

export default function GatedLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted">Loading …</p>}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

/** Admits active staff only; everyone else is sent to sign in. */
async function Gate({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff) return <SessionRecovery />;

  return (
    <div className="flex min-h-screen flex-col">
      <SessionKeeper />
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <nav aria-label="Admin" className="flex items-center gap-4">
            <span className="font-semibold">Kaizen Store</span>
            <ul className="flex gap-3 text-sm">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="rounded px-2 py-1 hover:bg-surface">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">
              {staff.email} · {staff.role}
            </span>
            <form action={signOut}>
              <button type="submit" className="underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
