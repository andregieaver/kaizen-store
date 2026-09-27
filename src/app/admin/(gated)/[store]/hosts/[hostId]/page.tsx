import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireMember } from "@/server/auth";
import { getHost, hostListings } from "@/server/hosts";

import { setHostDisabledAction, updateHostAction } from "../actions";
import { HostForm } from "../host-form";

export const metadata: Metadata = { title: "Host" };

export default async function HostPage({ params }: PageProps<"/admin/[store]/hosts/[hostId]">) {
  const { store: slug, hostId } = await params;
  const { store, role } = await requireMember(slug);
  if (!z.uuid().safeParse(hostId).success) notFound();
  const host = await getHost(store.id, hostId);
  if (!host) notFound();
  const listings = await hostListings(store.id, host.id);
  const owner = role === "owner";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/hosts`} className="text-sm underline">
          Hosts
        </Link>
        <h1 className="text-2xl font-semibold">{host.name}</h1>
        <p className="text-sm text-muted">
          {host.email} · {host.signedInBefore ? "Has signed in" : "Not signed in yet"}
        </p>
      </div>
      {owner ? (
        <HostForm host={host} action={updateHostAction.bind(null, store.slug, host.id)} />
      ) : (
        <p className="text-sm text-muted">
          {host.commissionBps / 100} % commission · {host.vatRegistered ? "VAT registered" : "No VAT"}
        </p>
      )}
      <section aria-labelledby="listings-heading" className="flex flex-col gap-2">
        <h2 id="listings-heading" className="font-medium">
          Listings
        </h2>
        {listings.length === 0 ? (
          <p className="text-sm text-muted">None yet. Choose this host in a stay or rental.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {listings.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 p-3">
                <Link href={`/admin/${store.slug}/products/${l.id}`} className="underline-offset-2 hover:underline">
                  {l.title}
                </Link>
                <span className="text-muted">{l.status === "active" ? "For sale" : "Draft"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {owner && (
        <form action={setHostDisabledAction.bind(null, store.slug, host.id, !host.disabled)}>
          <button type="submit" className="min-h-10 rounded-md border border-border px-3 text-sm">
            {host.disabled ? "Give access back" : "Take away access"}
          </button>
          <span className="ml-2 text-sm text-muted">
            {host.disabled ? "They can sign in again." : "Their listings stay; they can no longer sign in to their area."}
          </span>
        </form>
      )}
    </div>
  );
}
