import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { formatMoney } from "@/lib/money";
import { accountStage } from "@/lib/stripe-account";
import { memberCan, requirePermission } from "@/server/permissions";
import { getHostTaxDetails, hostTaxStatus } from "@/server/dac7";
import { getHostStripeAccounts, hostEarnings, storePaymentMode } from "@/server/host-payments";
import { getHost, hostListings } from "@/server/hosts";

import { setHostDisabledAction, updateHostAction } from "../actions";
import { HostForm } from "../host-form";

export const metadata: Metadata = { title: "Host" };

export default async function HostPage({ params }: PageProps<"/admin/[store]/hosts/[hostId]">) {
  const { store: slug, hostId } = await params;
  const current = await requirePermission(slug, "bookings:read");
  const { store } = current;
  if (!z.uuid().safeParse(hostId).success) notFound();
  const host = await getHost(store.id, hostId);
  if (!host) notFound();
  const [listings, mode, accounts, earnings, tax, taxes] = await Promise.all([
    hostListings(store.id, host.id),
    storePaymentMode(store.id),
    getHostStripeAccounts(store.id, host.id),
    hostEarnings(store.id, host.id),
    getHostTaxDetails(store.id, host.id),
    hostTaxStatus(store.id),
  ]);
  const missing = taxes.get(host.id)?.missingAddresses ?? [];
  const owner = memberCan(current, "owner");
  const stage = mode ? accountStage(accounts[mode] ?? null) : null;
  const locale = store.markets[0]?.locale ?? "en-GB";
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  // What the host got from the payments listed, per currency.
  const netByCurrency = new Map<string, number>();
  for (const e of earnings) netByCurrency.set(e.currency, (netByCurrency.get(e.currency) ?? 0) + e.netMinor);

  return (
    <div className="flex flex-col gap-6">
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
      <section aria-labelledby="payments-heading" className="flex flex-col gap-2">
        <h2 id="payments-heading" className="font-medium">
          Payments
        </h2>
        <p className="text-sm text-muted">
          {stage === "ready"
            ? "Guests pay the host's own Stripe account; your commission is sent on to your Stripe account."
            : stage === null
              ? "Payments are off in the store."
              : mode === "test"
                ? "Kaizen sets up the host's test account; it is ready within a few minutes."
                : "The host has not finished setting up Stripe in their area, so their listings cannot be paid for yet."}
        </p>
        {earnings.length > 0 && (
          <p>
            The host got{" "}
            <span className="font-medium tabular-nums">
              {[...netByCurrency].map(([currency, net]) => formatMoney(net, currency, locale)).join(" + ")}
            </span>{" "}
            from {earnings.length === 1 ? "this payment" : `these ${earnings.length} payments`}, after refunds, your commission and
            Kaizen&apos;s fee (before Stripe&apos;s own fees).
          </p>
        )}
        {earnings.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {earnings.map((e) => (
              <li key={e.paymentId} className="flex flex-wrap justify-between gap-3 p-3">
                <Link href={`/admin/${store.slug}/orders/${e.orderId}`} className="underline-offset-2 hover:underline">
                  {e.number} · {date.format(new Date(e.paidAt))}
                  {e.kind === "no_show" && <span className="block text-xs text-muted">No-show fee</span>}
                  <span className="block text-xs text-muted tabular-nums">
                    Guest paid {formatMoney(e.paidMinor - e.refundedMinor, e.currency, locale)}
                    {e.refundedMinor > 0 && " after refunds"} · Kaizen&apos;s fee {formatMoney(e.kaizenFeeMinor, e.currency, locale)} ·
                    Host got {formatMoney(e.netMinor, e.currency, locale)}
                  </span>
                </Link>
                <span className="text-right tabular-nums">
                  Commission {formatMoney(e.commissionMinor, e.currency, locale)}
                  <span className="block text-xs text-muted">
                    {e.sent ? "Sent to your Stripe account" : e.problem ? `Not sent yet: ${e.problem}` : "Not sent yet"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="tax-heading" className="flex flex-col gap-1 text-sm">
        <h2 id="tax-heading" className="font-medium">
          Tax details (DAC7)
        </h2>
        {tax ? (
          <p>
            {tax.legalName} · {tax.kind === "entity" ? `Business ${tax.businessNumber}` : "Private person"} · TIN ending{" "}
            {tax.tin.slice(-4)} ({tax.tinCountry})
          </p>
        ) : (
          <p className="text-red-700 dark:text-red-400">Not given yet. The host gives them in their area.</p>
        )}
        {missing.length > 0 && <p className="text-red-700 dark:text-red-400">No address yet for: {missing.join(", ")}.</p>}
        <Link href={`/admin/${store.slug}/hosts/dac7`} className="underline">
          Yearly tax report
        </Link>
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
