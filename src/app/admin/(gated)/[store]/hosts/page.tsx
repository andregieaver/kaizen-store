import type { Metadata } from "next";
import Link from "next/link";

import { requireMember } from "@/server/auth";
import { hostTaxStatus } from "@/server/dac7";
import { listHosts } from "@/server/hosts";

import { inviteHostAction } from "./actions";
import { HostForm } from "./host-form";

export const metadata: Metadata = { title: "Hosts" };

/**
 * The outside hosts the store lists stays and rentals for (D71): each signs
 * in to their own area, and the store keeps a commission of their bookings.
 */
export default async function HostsPage({ params }: PageProps<"/admin/[store]/hosts">) {
  const { store, role } = await requireMember((await params).store);
  const [hosts, taxes] = await Promise.all([listHosts(store.id), hostTaxStatus(store.id)]);
  const base = `/admin/${store.slug}/hosts`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Hosts</h1>
        <p className="text-sm text-muted">
          People whose rooms, homes or items the store lists, as a marketplace. Give a stay or rental and its rooms a host in the
          product and under Rooms and items; the host then keeps their calendar and sees their bookings in their own area.
        </p>
      </div>
      {hosts.length > 0 && (
        <p className="text-sm">
          <Link href={`${base}/dac7`} className="underline">
            Yearly tax report (DAC7)
          </Link>
        </p>
      )}
      {hosts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">No hosts yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {hosts.map((h) => (
            <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <Link href={`${base}/${h.id}`} className="font-medium underline-offset-2 hover:underline">
                  {h.name}
                </Link>
                {h.disabled && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs">No access</span>}
                <span className="block text-muted">{h.email}</span>
                <span className="block text-xs text-muted">
                  {h.commissionBps / 100} % commission · {h.listings === 1 ? "1 listing" : `${h.listings} listings`} ·{" "}
                  {h.vatRegistered ? "VAT registered" : "No VAT"} · {h.signedInBefore ? "Has signed in" : "Not signed in yet"}
                </span>
                {(!taxes.get(h.id)?.details || (taxes.get(h.id)?.missingAddresses.length ?? 0) > 0) && (
                  <span className="block text-xs text-red-700 dark:text-red-400">
                    {taxes.get(h.id)?.details ? "Addresses missing for the tax report" : "Tax details missing for the tax report"}
                  </span>
                )}
              </div>
              <Link href={`${base}/${h.id}`} className="min-h-10 rounded-md px-3 py-2 hover:bg-surface">
                Edit <span className="sr-only">{h.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {role === "owner" ? (
        <section aria-labelledby="add-host" className="flex flex-col gap-3">
          <h2 id="add-host" className="font-medium">
            Add a host
          </h2>
          <HostForm host={null} action={inviteHostAction.bind(null, store.slug)} />
        </section>
      ) : (
        <p className="text-sm text-muted">Only the store&apos;s owners add and change hosts.</p>
      )}
    </div>
  );
}
