import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ReferralLink } from "@/components/admin/referral-link";
import { Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { money } from "@/lib/control-center";
import { bpsText, referralUrl, REFERRAL_KIND_LABELS } from "@/lib/referrals";
import { siteUrl } from "@/lib/site";
import { requireAccount } from "@/server/auth";
import { referrerOverview } from "@/server/referrals";

export const metadata: Metadata = { title: "Referrals" };

const date = (iso: string) => iso.slice(0, 10);

/**
 * A store owner's referrals (D131, `docs/referrals.md`): their link and code, how many came by it, the stores that opened,
 * and the credit earned on what those stores pay Kaizen, which comes off their own Kaizen invoices. A referred store is
 * shown by its name and the commission it earned, nothing about its customers or orders.
 */
export default async function ReferralsPage() {
  await connection();
  const account = await requireAccount();
  const overview = await referrerOverview(account);
  const { settings } = overview;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Referrals</h1>
        <p className="max-w-3xl text-sm text-muted">
          Tell another store owner about Kaizen. When they open a store through your link, you earn {bpsText(settings.commissionBps)} of what their
          store pays Kaizen for {settings.months} months: its plan and Kaizen&apos;s fee on its sales. You earn it as credit, which comes off your
          own Kaizen invoices.
        </p>
      </div>

      {!overview.enabled && !overview.code ? (
        <p className="rounded-lg border border-border bg-background p-4 text-sm">The referral program is not running right now. Check back later.</p>
      ) : !overview.code ? (
        <p className="rounded-lg border border-border bg-background p-4 text-sm">Referrals are for store owners. You get a link once you own a store.</p>
      ) : (
        <>
          {overview.blocked && (
            <p role="alert" className="rounded-lg border border-red-600 p-4 text-sm">
              Your referrals are paused. Nothing more is earned and your credit is not used on invoices. Contact Kaizen if you think this is a mistake.
            </p>
          )}
          {!overview.enabled && (
            <p className="rounded-lg border border-border bg-background p-4 text-sm">
              The referral program is paused: stores that open now do not earn you anything. Credit you have can still be used.
            </p>
          )}
          <section aria-labelledby="link-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
            <h2 id="link-heading" className="sr-only">
              Your link
            </h2>
            <ReferralLink link={referralUrl(siteUrl(), overview.code)} code={overview.code} />
            <p className="text-sm text-muted">
              Anyone who opens the link is taken to Kaizen&apos;s sign-up form. A store earns you credit only if it opens through your link, and
              never your own stores. Kaizen keeps a count of visits, and nothing about the visitors.
            </p>
          </section>

          <StatGrid>
            <Stat label="Visits to your link" value={overview.visits} />
            <Stat label="Asked for a store" value={overview.signedUp} />
            <Stat label="Stores opened" value={overview.stores.length} />
            {overview.balances.length === 0 ? (
              <Stat label="Credit you can use" value={money(0, "EUR")} sub="Earned when a store you referred pays" />
            ) : (
              overview.balances.map((b) => (
                <Stat
                  key={b.currency}
                  label={`Credit you can use (${b.currency})`}
                  value={money(b.availableMinor, b.currency)}
                  sub={
                    b.pendingMinor > 0
                      ? `${money(b.pendingMinor, b.currency)} more from ${b.pendingAt ? date(b.pendingAt) : "soon"}`
                      : "Comes off your next Kaizen invoice"
                  }
                />
              ))
            )}
          </StatGrid>
          <p className="max-w-3xl text-sm text-muted">
            Credit is kept per currency and never changed from one to another. It becomes usable {settings.pendingDays} days after the fee is paid,
            in case the fee is refunded, and then comes off your Kaizen plan invoices in the same currency until it is used up. A refund of a fee
            takes back its share of the credit, never more than you still have.
          </p>

          <Section id="stores-heading" title="Stores you referred">
            {overview.stores.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
                No store has opened through your link yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-background">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="px-4 py-2 font-medium">Store</th>
                      <th scope="col" className="px-4 py-2 font-medium">Opened</th>
                      <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Earns you credit until</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">You earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.stores.map((store) => (
                      <tr key={`${store.storeName}-${store.since}`} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">
                          {store.storeName}
                          {store.status === "void" && <span className="block text-muted">Not counted</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">{date(store.since)}</td>
                        <td className="hidden whitespace-nowrap px-4 py-2 sm:table-cell">{date(store.until)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {store.earned.length === 0 ? "—" : store.earned.map((e) => <span key={e.currency} className="block">{money(e.minor, e.currency)}</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="history-heading" title="History">
            {overview.entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
                Nothing yet. Credit shows here when a store you referred pays Kaizen.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-background">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="px-4 py-2 font-medium">Date</th>
                      <th scope="col" className="px-4 py-2 font-medium">What</th>
                      <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Detail</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-4 py-2">{date(entry.createdAt)}</td>
                        <td className="px-4 py-2">{REFERRAL_KIND_LABELS[entry.kind]}</td>
                        <td className="hidden px-4 py-2 text-muted sm:table-cell">{entry.note}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                          {entry.amountMinor > 0 ? "+" : ""}
                          {money(entry.amountMinor, entry.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <p className="text-sm text-muted">
            Your credit comes off the plan invoices of the stores you own. See them under{" "}
            <Link href="/admin/account/billing" className="underline">
              Billing
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
