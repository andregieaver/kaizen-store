import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { memberCan, requirePermission } from "@/server/permissions";
import { hostTaxStatus } from "@/server/dac7";
import { listHosts } from "@/server/hosts";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { inviteHostAction } from "./actions";
import { HostForm } from "./host-form";

export const metadata: Metadata = { title: "Hosts" };

/**
 * The outside hosts the store lists stays and rentals for (D71): each signs
 * in to their own area, and the store keeps a commission of their bookings.
 */
export default async function HostsPage({ params }: PageProps<"/admin/[store]/hosts">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "bookings");
  if (off) return off;
  const { store } = current;
  const t = adminText(adminLangOf(current.account.adminLocale), "bookings");
  const w = t.hosts;
  const [hosts, taxes] = await Promise.all([listHosts(store.id), hostTaxStatus(store.id)]);
  const base = `/admin/${store.slug}/hosts`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />
      {hosts.length > 0 && (
        <p className="text-sm">
          <Link href={`${base}/dac7`} className="underline">
            {w.dac7Link}
          </Link>
        </p>
      )}
      {hosts.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">{w.none}</p>
      ) : (
        <ul className={`divide-y divide-line ${CARD_CLASS}`}>
          {hosts.map((h) => (
            <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <Link href={`${base}/${h.id}`} className="font-medium underline-offset-2 hover:underline">
                  {h.name}
                </Link>
                {h.disabled && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs">{w.noAccess}</span>}
                <span className="block text-muted">{h.email}</span>
                <span className="block text-xs text-muted">
                  {fillWords(w.commission, { n: h.commissionBps / 100 })} · {countWords(h.listings, w.listings)} ·{" "}
                  {h.vatRegistered ? w.vat : w.noVat} · {h.signedInBefore ? w.signedIn : w.notSignedIn}
                </span>
                {(!taxes.get(h.id)?.details || (taxes.get(h.id)?.missingAddresses.length ?? 0) > 0) && (
                  <span className="block text-xs text-danger-text">
                    {taxes.get(h.id)?.details ? w.addressesMissing : w.taxMissing}
                  </span>
                )}
              </div>
              <Link href={`${base}/${h.id}`} className="min-h-10 rounded-pill px-3 py-2 hover:bg-sunken">
                {w.edit} <span className="sr-only">{h.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {memberCan(current, "owner") ? (
        <section aria-labelledby="add-host" className="flex flex-col gap-3">
          <h2 id="add-host" className="text-title text-ink">
            {w.add}
          </h2>
          <HostForm host={null} words={t.hostForm} action={inviteHostAction.bind(null, store.slug)} />
        </section>
      ) : (
        <p className="text-sm text-muted">{w.ownersOnly}</p>
      )}
    </div>
  );
}
