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
import { Card, CARD_CLASS, List, ListRow, PageHeader, RowAmount, RowDate, RowLead } from "@/components/admin/ui";

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
      <PageHeader
        title="Referrals"
        description={<>Tell another store owner about Kaizena Flow. When they open a store through your link, you earn {bpsText(settings.commissionBps)} of what their store pays Kaizena Flow for {settings.months} months: its plan and Kaizena Flow&apos;s fee on its sales. You earn it as credit, which comes off your own Kaizena Flow invoices.</>}
      />

      {!overview.enabled && !overview.code ? (
        <p className={`p-4 text-sm ${CARD_CLASS}`}>The referral program is not running right now. Check back later.</p>
      ) : !overview.code ? (
        <p className={`p-4 text-sm ${CARD_CLASS}`}>Referrals are for store owners. You get a link once you own a store.</p>
      ) : (
        <>
          {overview.blocked && (
            <p role="alert" className="rounded-lg border border-danger-text p-4 text-sm">
              Your referrals are paused. Nothing more is earned and your credit is not used on invoices. Contact Kaizena Flow if you think this is a mistake.
            </p>
          )}
          {!overview.enabled && (
            <p className={`p-4 text-sm ${CARD_CLASS}`}>
              The referral program is paused: stores that open now do not earn you anything. Credit you have can still be used.
            </p>
          )}
          <section aria-labelledby="link-heading" className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
            <h2 id="link-heading" className="sr-only">
              Your link
            </h2>
            <ReferralLink link={referralUrl(siteUrl(), overview.code)} code={overview.code} />
            <p className="text-sm text-muted">
              Anyone who opens the link is taken to Kaizena Flow&apos;s sign-up form. A store earns you credit only if it opens through your link, and
              never your own stores. Kaizena Flow keeps a count of visits, and nothing about the visitors.
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
                      : "Comes off your next Kaizena Flow invoice"
                  }
                />
              ))
            )}
          </StatGrid>
          <p className="max-w-3xl text-sm text-muted">
            Credit is kept per currency and never changed from one to another. It becomes usable {settings.pendingDays} days after the fee is paid,
            in case the fee is refunded, and then comes off your Kaizena Flow plan invoices in the same currency until it is used up. A refund of a fee
            takes back its share of the credit, never more than you still have.
          </p>

          <Section id="stores-heading" title="Stores you referred">
            {overview.stores.length === 0 ? (
              <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
                No store has opened through your link yet.
              </p>
            ) : (
              <Card compact>
                <List label="Stores you referred">
                  {overview.stores.map((store) => (
                    <ListRow key={`${store.storeName}-${store.since}`}>
                      <RowLead
                        title={store.storeName}
                        sub={
                          <>
                            Opened {date(store.since)} · earns you credit until {date(store.until)}
                            {store.status === "void" && " · not counted"}
                          </>
                        }
                      />
                      <RowAmount>
                        {store.earned.length === 0 ? "—" : store.earned.map((e) => <span key={e.currency} className="block">{money(e.minor, e.currency)}</span>)}
                      </RowAmount>
                    </ListRow>
                  ))}
                </List>
              </Card>
            )}
          </Section>

          <Section id="history-heading" title="History">
            {overview.entries.length === 0 ? (
              <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
                Nothing yet. Credit shows here when a store you referred pays Kaizena Flow.
              </p>
            ) : (
              <Card compact>
                <List label="Credit">
                  {overview.entries.map((entry) => (
                    <ListRow key={entry.id}>
                      <RowDate>{date(entry.createdAt)}</RowDate>
                      <RowLead title={REFERRAL_KIND_LABELS[entry.kind]} sub={entry.note || undefined} />
                      <RowAmount>
                        {entry.amountMinor > 0 ? "+" : ""}
                        {money(entry.amountMinor, entry.currency)}
                      </RowAmount>
                    </ListRow>
                  ))}
                </List>
              </Card>
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
