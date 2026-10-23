import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { formatMoney } from "@/lib/money";
import { accountStage } from "@/lib/stripe-account";
import { memberCan, requirePermission } from "@/server/permissions";
import { getHostTaxDetails, hostTaxStatus } from "@/server/dac7";
import { getHostStripeAccounts, hostEarnings, storePaymentMode } from "@/server/host-payments";
import { getHost, hostListings } from "@/server/hosts";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { setHostDisabledAction, updateHostAction } from "../actions";
import { HostForm } from "../host-form";

export const metadata: Metadata = { title: "Host" };

export default async function HostPage({ params }: PageProps<"/admin/[store]/hosts/[hostId]">) {
  const { store: slug, hostId } = await params;
  const current = await requirePermission(slug, "bookings:read");
  const off = requireFeature(current, "bookings");
  if (off) return off;
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const t = adminText(lang, "bookings");
  const w = t.host;
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
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "en-GB") : ADMIN_LANG_FACTS[lang].locale;
  const date = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale, { day: "numeric", month: "short", year: "numeric" });
  // What the host got from the payments listed, per currency.
  const netByCurrency = new Map<string, number>();
  for (const e of earnings) netByCurrency.set(e.currency, (netByCurrency.get(e.currency) ?? 0) + e.netMinor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/hosts`, label: t.hosts.title }}
        title={<>{host.name}</>}
        description={<>{host.email} · {host.signedInBefore ? t.hosts.signedIn : t.hosts.notSignedIn}</>}
      />
      {owner ? (
        <HostForm host={host} words={t.hostForm} action={updateHostAction.bind(null, store.slug, host.id)} />
      ) : (
        <p className="text-sm text-muted">
          {fillWords(t.hosts.commission, { n: host.commissionBps / 100 })} · {host.vatRegistered ? t.hosts.vat : t.hosts.noVat}
        </p>
      )}
      <section aria-labelledby="listings-heading" className="flex flex-col gap-2">
        <h2 id="listings-heading" className="text-title text-ink">
          {w.listings}
        </h2>
        {listings.length === 0 ? (
          <p className="text-sm text-muted">{w.noListings}</p>
        ) : (
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {listings.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 p-3">
                <Link href={`/admin/${store.slug}/products/${l.id}`} className="underline-offset-2 hover:underline">
                  {l.title}
                </Link>
                <span className="text-muted">{l.status === "active" ? w.forSale : w.draft}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="payments-heading" className="flex flex-col gap-2">
        <h2 id="payments-heading" className="text-title text-ink">
          {w.payments}
        </h2>
        <p className="text-sm text-muted">
          {stage === "ready"
            ? w.ready
            : stage === null
              ? w.paymentsOff
              : mode === "test"
                ? w.testAccount
                : w.notSetUp}
        </p>
        {earnings.length > 0 && (
          <p>
            {w.gotBefore}{" "}
            <span className="font-medium tabular-nums">
              {[...netByCurrency].map(([currency, net]) => formatMoney(net, currency, locale)).join(" + ")}
            </span>{" "}
            {countWords(earnings.length, w.gotAfter)}
          </p>
        )}
        {earnings.length > 0 && (
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {earnings.map((e) => (
              <li key={e.paymentId} className="flex flex-wrap justify-between gap-3 p-3">
                <Link href={`/admin/${store.slug}/orders/${e.orderId}`} className="underline-offset-2 hover:underline">
                  {e.number} · {date.format(new Date(e.paidAt))}
                  {e.kind === "no_show" && <span className="block text-xs text-muted">{w.noShowFee}</span>}
                  <span className="block text-xs text-muted tabular-nums">
                    {fillWords(e.refundedMinor > 0 ? w.guestPaidRefunded : w.guestPaid, { amount: formatMoney(e.paidMinor - e.refundedMinor, e.currency, locale) })} ·{" "}
                    {fillWords(w.kaizenFee, { amount: formatMoney(e.kaizenFeeMinor, e.currency, locale) })} ·{" "}
                    {fillWords(w.hostGot, { amount: formatMoney(e.netMinor, e.currency, locale) })}
                  </span>
                </Link>
                <span className="text-right tabular-nums">
                  {fillWords(w.commissionAmount, { amount: formatMoney(e.commissionMinor, e.currency, locale) })}
                  <span className="block text-xs text-muted">
                    {e.sent ? w.sent : e.problem ? fillWords(w.notSentProblem, { problem: e.problem }) : w.notSent}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="tax-heading" className="flex flex-col gap-1 text-sm">
        <h2 id="tax-heading" className="text-title text-ink">
          {w.tax}
        </h2>
        {tax ? (
          <p>
            {tax.legalName} · {tax.kind === "entity" ? fillWords(w.business, { number: tax.businessNumber ?? "" }) : w.privatePerson} ·{" "}
            {fillWords(w.tin, { last: tax.tin.slice(-4), country: tax.tinCountry })}
          </p>
        ) : (
          <p className="text-danger-text">{w.taxMissing}</p>
        )}
        {missing.length > 0 && <p className="text-danger-text">{fillWords(w.noAddress, { list: missing.join(", ") })}</p>}
        <Link href={`/admin/${store.slug}/hosts/dac7`} className="underline">
          {w.yearly}
        </Link>
      </section>
      {owner && (
        <form action={setHostDisabledAction.bind(null, store.slug, host.id, !host.disabled)}>
          <button type="submit" className="min-h-10 rounded-pill border border-edge px-3 text-sm">
            {host.disabled ? w.giveBack : w.takeAway}
          </button>
          <span className="ml-2 text-sm text-muted">
            {host.disabled ? w.giveBackHint : w.takeAwayHint}
          </span>
        </form>
      )}
    </div>
  );
}
