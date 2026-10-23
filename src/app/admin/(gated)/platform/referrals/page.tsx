import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { randomUUID } from "node:crypto";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { bpsToPercentText } from "@/lib/bonus-admin";
import { money } from "@/lib/control-center";
import { bpsText, type AdminReferrer } from "@/lib/referrals";
import { requirePlatformAdmin } from "@/server/auth";
import { getReferralSettings, listReferrals, listReferrers, referralTotals } from "@/server/referrals";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";

import {
  adjustReferralCreditAction,
  blockReferrerAction,
  restoreReferralAction,
  saveReferralSettingsAction,
  unblockReferrerAction,
  voidReferralAction,
} from "./actions";

export const metadata: Metadata = { title: "Referrals" };

const date = (iso: string) => iso.slice(0, 10);
const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";

type W = PlatformMessages["referrals"];

const amounts = (rows: { currency: string; minor: number }[], locale: string) =>
  rows.length === 0 ? "—" : rows.map((r) => <span key={r.currency} className="block">{money(r.minor, r.currency, locale)}</span>);

function ReferrerActions({ referrer, w }: { referrer: AdminReferrer; w: W }) {
  const key = randomUUID();
  return (
    <div className="flex flex-col gap-2">
      {referrer.blockedAt ? (
        <form action={unblockReferrerAction.bind(null, referrer.accountId)}>
          <button type="submit" className="min-h-9 rounded-pill border border-edge px-3 text-sm">
            {w.unblock}<span className="sr-only"> {referrer.email}</span>
          </button>
        </form>
      ) : (
        <details>
          <summary className="cursor-pointer text-sm underline">{w.block}</summary>
          <ActionForm action={blockReferrerAction.bind(null, referrer.accountId)} className="mt-2 flex flex-col gap-2" successMessage={w.blocked}>
            <label className={label}>
              {w.why}
              <input name="reason" required minLength={3} maxLength={300} className={control} />
            </label>
            <div>
              <SubmitButton variant="secondary">{fillWords(w.blockWho, { email: referrer.email })}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-sm underline">{w.adjustCredit}</summary>
        <ActionForm action={adjustReferralCreditAction.bind(null, referrer.accountId)} className="mt-2 flex flex-col gap-2" successMessage={w.done}>
          <input type="hidden" name="key" value={key} />
          <label className={label}>
            {w.currency}
            <input name="currency" required maxLength={3} defaultValue={referrer.balances[0]?.currency ?? "EUR"} className={`${control} w-24 uppercase`} />
          </label>
          <label className={label}>
            {w.amount}
            <input name="amount" required inputMode="decimal" className={control} />
          </label>
          <label className={label}>
            {w.reason}
            <input name="reason" required minLength={3} maxLength={300} className={control} />
          </label>
          <div>
            <SubmitButton variant="secondary">{w.adjustCredit}</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}

/**
 * Kaizen's referral program (D131, `docs/referrals.md`), for the platform: its terms, the referrers (block, adjust their
 * credit), the stores they referred (void) and what it adds up to, per currency.
 */
export default async function PlatformReferralsPage() {
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").referrals;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const [settings, totals, referrers, referrals] = await Promise.all([getReferralSettings(), referralTotals(), listReferrers(), listReferrals()]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={w.title}
        description={w.description}
      />

      <Section id="settings-heading" title={w.program}>
        <ActionForm action={saveReferralSettingsAction} className={`flex max-w-xl flex-col gap-4 p-5 ${CARD_CLASS}`} successMessage={w.saved}>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4" />
            {w.on}
          </label>
          <p className="-mt-2 text-sm text-muted">
            {w.onNote}
          </p>
          <label className={label}>
            {w.commission}
            <input name="commissionPercent" required inputMode="decimal" defaultValue={bpsToPercentText(settings.commissionBps)} className={`${control} w-32`} />
          </label>
          <label className={label}>
            {w.months}
            <input name="months" type="number" min={1} max={60} required defaultValue={settings.months} className={`${control} w-32`} />
          </label>
          <label className={label}>
            {w.pendingDays}
            <input name="pendingDays" type="number" min={0} max={90} required defaultValue={settings.pendingDays} className={`${control} w-32`} />
            <span className="font-normal text-muted">{w.pendingNote}</span>
          </label>
          <label className={label}>
            {w.cookieDays}
            <input name="cookieDays" type="number" min={1} max={90} required defaultValue={settings.cookieDays} className={`${control} w-32`} />
          </label>
          <div>
            <SubmitButton>{w.save}</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <StatGrid>
        <Stat label={w.referrers} value={totals.referrers} sub={w.referrersSub} />
        <Stat label={w.referredStores} value={totals.referredStores} />
        <Stat label={w.earned} value={amounts(totals.earned, locale)} sub={w.earnedSub} />
        <Stat label={w.applied} value={amounts(totals.applied, locale)} />
        <Stat label={w.owed} value={amounts(totals.outstanding, locale)} sub={w.owedSub} />
      </StatGrid>

      <Section id="referrers-heading" title={w.referrers}>
        {referrers.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            {w.noReferrers}
          </p>
        ) : (
          <div className={`overflow-x-auto ${CARD_CLASS}`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">{w.referrer}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.broughtIn}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.earnedCol}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.creditNow}</th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">{w.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrers.map((r) => (
                  <tr key={r.accountId} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/admin/platform/customers/${r.accountId}`} className="underline">
                        {r.email}
                      </Link>
                      <span className="block font-mono text-muted">{r.code}</span>
                      {r.blockedAt && (
                        <span className="block text-danger-text">
                          {fillWords(w.blockedOn, { date: date(r.blockedAt), reason: r.blockedReason ?? "" })}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">
                      {fillWords(w.visits, { n: r.visits })}
                      <span className="block">{fillWords(w.requests, { n: r.requests })}</span>
                      <span className="block">{fillWords(w.stores, { n: r.stores })}</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{amounts(r.earned, locale)}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {r.balances.length === 0
                        ? "—"
                        : r.balances.map((b) => (
                            <span key={b.currency} className="block">
                              {money(b.availableMinor, b.currency, locale)}
                              {b.pendingMinor > 0 && <span className="text-muted"> + {money(b.pendingMinor, b.currency, locale)} {w.waiting}</span>}
                            </span>
                          ))}
                    </td>
                    <td className="px-4 py-2">
                      <ReferrerActions referrer={r} w={w} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="referred-heading" title={w.referredStores}>
        {referrals.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            {w.noReferred}
          </p>
        ) : (
          <div className={`overflow-x-auto ${CARD_CLASS}`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">{w.store}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.referredBy}</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">{w.terms}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.commissionCol}</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">{w.feesBehind}</th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">{w.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/admin/platform/stores/${r.storeSlug}`} className="underline">
                        {r.storeName}
                      </Link>
                      <span className="block text-muted">{fillWords(w.opened, { date: date(r.since) })}</span>
                      {r.status === "void" && (
                        <span className="block text-danger-text">{fillWords(w.voided, { reason: r.voidReason ?? "" })}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted">{r.referrerEmail}</td>
                    <td className="hidden whitespace-nowrap px-4 py-2 text-muted md:table-cell">
                      {fillWords(w.until, { bps: bpsText(r.commissionBps), date: date(r.until) })}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{amounts(r.earned, locale)}</td>
                    <td className="hidden px-4 py-2 tabular-nums text-muted lg:table-cell">
                      {r.earned.length === 0 || r.commissionBps === 0
                        ? "—"
                        : r.earned.map((e) => (
                            <span key={e.currency} className="block">
                              {fillWords(w.about, { amount: money(Math.round((e.minor * 10000) / r.commissionBps), e.currency, locale) })}
                            </span>
                          ))}
                    </td>
                    <td className="px-4 py-2">
                      {r.status === "void" ? (
                        <form action={restoreReferralAction.bind(null, r.id)}>
                          <button type="submit" className="min-h-9 rounded-pill border border-edge px-3 text-sm">
                            {w.countAgain}<span className="sr-only"> {r.storeName}</span>
                          </button>
                        </form>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-sm underline">{w.void}</summary>
                          <ActionForm action={voidReferralAction.bind(null, r.id)} className="mt-2 flex flex-col gap-2" successMessage={w.voidedDone}>
                            <label className={label}>
                              {w.voidWhy}
                              <input name="reason" required minLength={3} maxLength={300} className={control} />
                            </label>
                            <div>
                              <SubmitButton variant="secondary">{w.voidSubmit}</SubmitButton>
                            </div>
                          </ActionForm>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
