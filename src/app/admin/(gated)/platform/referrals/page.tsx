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
const control = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";

const amounts = (rows: { currency: string; minor: number }[]) =>
  rows.length === 0 ? "—" : rows.map((r) => <span key={r.currency} className="block">{money(r.minor, r.currency)}</span>);

function ReferrerActions({ referrer }: { referrer: AdminReferrer }) {
  const key = randomUUID();
  return (
    <div className="flex flex-col gap-2">
      {referrer.blockedAt ? (
        <form action={unblockReferrerAction.bind(null, referrer.accountId)}>
          <button type="submit" className="min-h-9 rounded-md border border-border px-3 text-sm">
            Unblock<span className="sr-only"> {referrer.email}</span>
          </button>
        </form>
      ) : (
        <details>
          <summary className="cursor-pointer text-sm underline">Block</summary>
          <ActionForm action={blockReferrerAction.bind(null, referrer.accountId)} className="mt-2 flex flex-col gap-2" successMessage="Blocked.">
            <label className={label}>
              Why?
              <input name="reason" required minLength={3} maxLength={300} className={control} />
            </label>
            <div>
              <SubmitButton variant="secondary">Block {referrer.email}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-sm underline">Adjust credit</summary>
        <ActionForm action={adjustReferralCreditAction.bind(null, referrer.accountId)} className="mt-2 flex flex-col gap-2" successMessage="Done.">
          <input type="hidden" name="key" value={key} />
          <label className={label}>
            Currency
            <input name="currency" required maxLength={3} defaultValue={referrer.balances[0]?.currency ?? "EUR"} className={`${control} w-24 uppercase`} />
          </label>
          <label className={label}>
            Amount (a minus removes)
            <input name="amount" required inputMode="decimal" className={control} />
          </label>
          <label className={label}>
            Reason (the referrer sees it)
            <input name="reason" required minLength={3} maxLength={300} className={control} />
          </label>
          <div>
            <SubmitButton variant="secondary">Adjust credit</SubmitButton>
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
  await requirePlatformAdmin();
  const [settings, totals, referrers, referrals] = await Promise.all([getReferralSettings(), referralTotals(), listReferrers(), listReferrals()]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Referrals</h1>
        <p className="max-w-3xl text-sm text-muted">
          Store owners refer other store owners and earn credit on their own Kaizen invoices: a share of the plan and the sales fee the referred
          store pays Kaizen, for a number of months. The terms a referral is made with are the ones below on the day the request is approved;
          changing them later does not change stores already referred.
        </p>
      </div>

      <Section id="settings-heading" title="The program">
        <ActionForm action={saveReferralSettingsAction} className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-background p-5" successMessage="Saved.">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4" />
            The program is on
          </label>
          <p className="-mt-2 text-sm text-muted">
            Off: no new referrals and no new commission. Credit already earned stays and can still be used. Turning it on also lists the referral
            cookie on Kaizen&apos;s cookie page and asks visitors about marketing cookies.
          </p>
          <label className={label}>
            Commission, % of the fees the referred store pays
            <input name="commissionPercent" required inputMode="decimal" defaultValue={bpsToPercentText(settings.commissionBps)} className={`${control} w-32`} />
          </label>
          <label className={label}>
            Months a store earns it, from when it is opened
            <input name="months" type="number" min={1} max={60} required defaultValue={settings.months} className={`${control} w-32`} />
          </label>
          <label className={label}>
            Days before earned credit can be used
            <input name="pendingDays" type="number" min={0} max={90} required defaultValue={settings.pendingDays} className={`${control} w-32`} />
            <span className="font-normal text-muted">A fee can be refunded; credit waits this long.</span>
          </label>
          <label className={label}>
            Days the referral cookie lasts (after the visitor allows it)
            <input name="cookieDays" type="number" min={1} max={90} required defaultValue={settings.cookieDays} className={`${control} w-32`} />
          </label>
          <div>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <StatGrid>
        <Stat label="Referrers" value={totals.referrers} sub="Store owners with a code" />
        <Stat label="Referred stores" value={totals.referredStores} />
        <Stat label="Commission earned" value={amounts(totals.earned)} sub="After refunds, per currency" />
        <Stat label="Credit used on invoices" value={amounts(totals.applied)} />
        <Stat label="Credit owed" value={amounts(totals.outstanding)} sub="Usable and waiting, per currency" />
      </StatGrid>

      <Section id="referrers-heading" title="Referrers">
        {referrers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
            No one has opened Referrals yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Referrer</th>
                  <th scope="col" className="px-4 py-2 font-medium">Brought in</th>
                  <th scope="col" className="px-4 py-2 font-medium">Earned</th>
                  <th scope="col" className="px-4 py-2 font-medium">Credit now</th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrers.map((r) => (
                  <tr key={r.accountId} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/admin/platform/customers/${r.accountId}`} className="underline">
                        {r.email}
                      </Link>
                      <span className="block font-mono text-muted">{r.code}</span>
                      {r.blockedAt && (
                        <span className="block text-red-700 dark:text-red-400">
                          Blocked {date(r.blockedAt)}: {r.blockedReason}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">
                      {r.visits} visits
                      <span className="block">{r.requests} requests</span>
                      <span className="block">{r.stores} stores</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{amounts(r.earned)}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {r.balances.length === 0
                        ? "—"
                        : r.balances.map((b) => (
                            <span key={b.currency} className="block">
                              {money(b.availableMinor, b.currency)}
                              {b.pendingMinor > 0 && <span className="text-muted"> + {money(b.pendingMinor, b.currency)} waiting</span>}
                            </span>
                          ))}
                    </td>
                    <td className="px-4 py-2">
                      <ReferrerActions referrer={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="referred-heading" title="Referred stores">
        {referrals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
            No store has opened through a referral yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Store</th>
                  <th scope="col" className="px-4 py-2 font-medium">Referred by</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Terms</th>
                  <th scope="col" className="px-4 py-2 font-medium">Commission</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Fees behind it</th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/admin/platform/stores/${r.storeSlug}`} className="underline">
                        {r.storeName}
                      </Link>
                      <span className="block text-muted">Opened {date(r.since)}</span>
                      {r.status === "void" && (
                        <span className="block text-red-700 dark:text-red-400">Void: {r.voidReason}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted">{r.referrerEmail}</td>
                    <td className="hidden whitespace-nowrap px-4 py-2 text-muted md:table-cell">
                      {bpsText(r.commissionBps)} until {date(r.until)}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{amounts(r.earned)}</td>
                    <td className="hidden px-4 py-2 tabular-nums text-muted lg:table-cell">
                      {r.earned.length === 0 || r.commissionBps === 0
                        ? "—"
                        : r.earned.map((e) => (
                            <span key={e.currency} className="block">
                              about {money(Math.round((e.minor * 10000) / r.commissionBps), e.currency)}
                            </span>
                          ))}
                    </td>
                    <td className="px-4 py-2">
                      {r.status === "void" ? (
                        <form action={restoreReferralAction.bind(null, r.id)}>
                          <button type="submit" className="min-h-9 rounded-md border border-border px-3 text-sm">
                            Count again<span className="sr-only"> {r.storeName}</span>
                          </button>
                        </form>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-sm underline">Void</summary>
                          <ActionForm action={voidReferralAction.bind(null, r.id)} className="mt-2 flex flex-col gap-2" successMessage="Voided.">
                            <label className={label}>
                              Why? (it earns nothing more; what it earned stays)
                              <input name="reason" required minLength={3} maxLength={300} className={control} />
                            </label>
                            <div>
                              <SubmitButton variant="secondary">Void the referral</SubmitButton>
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
