import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ReferralLink } from "@/components/admin/referral-link";
import { Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { money as moneyIn } from "@/lib/control-center";
import { bpsText, referralUrl } from "@/lib/referrals";
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
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "loyalty").referrals;
  const money = (minor: number, currency: string) => moneyIn(minor, currency, locale);

  return (
    <AdminTextScope texts={adminTexts(lang, ["loyalty"])}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title={w.title}
          description={fillWords(w.description, { percent: bpsText(settings.commissionBps, locale), months: settings.months })}
        />

        {!overview.enabled && !overview.code ? (
          <p className={`p-4 text-sm ${CARD_CLASS}`}>{w.notRunning}</p>
        ) : !overview.code ? (
          <p className={`p-4 text-sm ${CARD_CLASS}`}>{w.ownersOnly}</p>
        ) : (
          <>
            {overview.blocked && (
              <p role="alert" className="rounded-lg border border-danger-text p-4 text-sm">
                {w.blocked}
              </p>
            )}
            {!overview.enabled && (
              <p className={`p-4 text-sm ${CARD_CLASS}`}>
                {w.paused}
              </p>
            )}
            <section aria-labelledby="link-heading" className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
              <h2 id="link-heading" className="sr-only">
                {w.yourLink}
              </h2>
              <ReferralLink link={referralUrl(siteUrl(), overview.code)} code={overview.code} />
              <p className="text-sm text-muted">
                {w.linkNote}
              </p>
            </section>

            <StatGrid>
              <Stat label={w.visits} value={overview.visits} />
              <Stat label={w.signedUp} value={overview.signedUp} />
              <Stat label={w.opened} value={overview.stores.length} />
              {overview.balances.length === 0 ? (
                <Stat label={w.credit} value={money(0, "EUR")} sub={w.creditSub} />
              ) : (
                overview.balances.map((b) => (
                  <Stat
                    key={b.currency}
                    label={fillWords(w.creditIn, { currency: b.currency })}
                    value={money(b.availableMinor, b.currency)}
                    sub={
                      b.pendingMinor > 0
                        ? fillWords(w.moreFrom, { amount: money(b.pendingMinor, b.currency), date: b.pendingAt ? date(b.pendingAt) : w.soon })
                        : w.nextInvoice
                    }
                  />
                ))
              )}
            </StatGrid>
            <p className="max-w-3xl text-sm text-muted">
              {fillWords(w.creditNote, { days: settings.pendingDays })}
            </p>

            <Section id="stores-heading" title={w.stores}>
              {overview.stores.length === 0 ? (
                <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
                  {w.noStores}
                </p>
              ) : (
                <Card compact>
                  <List label={w.stores}>
                    {overview.stores.map((store) => (
                      <ListRow key={`${store.storeName}-${store.since}`}>
                        <RowLead
                          title={store.storeName}
                          sub={
                            <>
                              {fillWords(w.storeSub, { since: date(store.since), until: date(store.until) })}
                              {store.status === "void" && w.notCounted}
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

            <Section id="history-heading" title={w.history}>
              {overview.entries.length === 0 ? (
                <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
                  {w.noHistory}
                </p>
              ) : (
                <Card compact>
                  <List label={w.creditList}>
                    {overview.entries.map((entry) => (
                      <ListRow key={entry.id}>
                        <RowDate>{date(entry.createdAt)}</RowDate>
                        <RowLead title={w.kinds[entry.kind]} sub={entry.note || undefined} />
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
              {w.billingBefore}
              <Link href="/admin/account/billing" className="underline">
                {w.billing}
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </AdminTextScope>
  );
}
