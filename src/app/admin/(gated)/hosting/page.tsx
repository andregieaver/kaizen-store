import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAccount } from "@/server/auth";
import { listHostings } from "@/server/hosts";

export const metadata: Metadata = { title: "Hosting" };

/** The stores the account hosts for (D71); with just one, straight to it. */
export default async function HostingPage() {
  const account = await requireAccount();
  const hostings = await listHostings(account);
  if (hostings.length === 1) redirect(`/admin/hosting/${hostings[0].slug}`);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Hosting</h1>
      {hostings.length === 0 ? (
        <p className="text-sm text-muted">You do not host for any store.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {hostings.map((h) => (
            <li key={h.slug} className="p-4 text-sm">
              <Link href={`/admin/hosting/${h.slug}`} className="font-medium underline-offset-2 hover:underline">
                {h.name}
              </Link>
              <span className="block text-muted">As {h.hostName}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
