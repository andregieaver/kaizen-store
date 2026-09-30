import Link from "next/link";

import { friendLabel, type ShopperReferrals } from "@/lib/affiliates";
import { earnPercentText } from "@/lib/bonus-shopper";
import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

import { CopyLinkButton } from "./copy-link-button";

/**
 * My account's Refer a friend (D131): the customer's link to share with a copy button, how the program works in a few
 * sentences from the store's settings, what their link has done (visits, friends, credits) and each friend by a neutral
 * label: a first name at most, the date, where the order stands and what it earned: never an email or what was bought.
 * Amounts are in the market's currency as converted by the server.
 */
export function ReferralsAccountView({
  referrals,
  link,
  m,
  locale,
  base,
}: {
  referrals: ShopperReferrals;
  /** The customer's full link, or null while they have none. */
  link: string | null;
  m: Messages;
  locale: string;
  /** The market's own path, for the link to the credits page. */
  base: string;
}) {
  const a = m.affiliate;
  const money = (minor: number) => formatMoney(minor, referrals.currency, locale);
  const s = referrals.settings;
  const counted = referrals.friends.filter((friend) => friend.status !== "rejected");
  const wait = referrals.pendingDays > 0 ? a.waitAfter(m.bonus.dayCount(referrals.pendingDays)) : a.waitNow;
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-heading">{a.title}</h1>
        <p>{a.intro}</p>
      </header>

      {referrals.blocked ? (
        <p role="note" className="rounded-lg border border-border bg-surface p-4">
          {a.blocked}
        </p>
      ) : (
        link && (
          <section aria-labelledby="referral-link-heading" className="flex flex-col gap-2">
            <h2 id="referral-link-heading" className="text-xl font-heading">
              {a.linkLabel}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="referral-link"
                readOnly
                value={link}
                aria-labelledby="referral-link-heading"
                className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
              />
              <CopyLinkButton link={link} labels={{ copy: a.copy, copied: a.copied }} inputId="referral-link" />
            </div>
          </section>
        )
      )}

      <section aria-labelledby="referral-how-heading" className="flex flex-col gap-2">
        <h2 id="referral-how-heading" className="text-xl font-heading">
          {a.howHeading}
        </h2>
        {s.friendPercent > 0 && (
          <p>
            {s.friendMaxMinor !== null
              ? a.friendGetsUpTo(earnPercentText(s.friendPercent, locale), money(s.friendMaxMinor))
              : a.friendGets(earnPercentText(s.friendPercent, locale))}
          </p>
        )}
        {s.rewardBps > 0 && (
          <p>
            {a.youEarn(earnPercentText(s.rewardBps / 100, locale), wait)}{" "}
            {s.rewardOrders === null ? a.countsEveryOrder : s.rewardOrders === 1 ? a.countsFirstOrder : a.countsFirstOrders(String(s.rewardOrders))}
          </p>
        )}
        {s.monthlyCapMinor !== null && <p>{a.monthlyLimit(money(s.monthlyCapMinor))}</p>}
        <p className="text-muted">{a.rules}</p>
      </section>

      <section aria-labelledby="referral-stats-heading" className="flex flex-col gap-3">
        <h2 id="referral-stats-heading" className="text-xl font-heading">
          {a.statsHeading}
        </h2>
        <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 md:grid-cols-4">
          <div>
            <dt className="text-sm text-muted">{a.visits}</dt>
            <dd className="text-xl font-semibold">{referrals.visits}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{a.friendsCount}</dt>
            <dd className="text-xl font-semibold">{counted.length}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{a.earnedLabel}</dt>
            <dd className="text-xl font-semibold">{money(referrals.earnedMinor)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{a.pendingLabel}</dt>
            <dd className="text-xl font-semibold">{money(referrals.pendingMinor)}</dd>
          </div>
        </dl>
        <Link href={`${base}/account/bonus`} className="w-fit underline">
          {a.creditsLink}
        </Link>
      </section>

      <section aria-labelledby="referral-friends-heading" className="flex flex-col gap-3">
        <h2 id="referral-friends-heading" className="text-xl font-heading">
          {a.friendsHeading}
        </h2>
        {referrals.friends.length === 0 ? (
          <p className="text-muted">{a.noFriends}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {referrals.friends.map((friend, index) => (
              <li key={`${friend.at}-${index}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4">
                <span className="min-w-0">
                  <span className="font-medium">{friendLabel(friend.label) ?? a.aFriend}</span>
                  <span className="block text-sm text-muted">
                    {day(friend.at)} · {a.status[friend.status]}
                  </span>
                </span>
                <span className="font-medium whitespace-nowrap">{friend.rewardMinor > 0 ? `+${money(friend.rewardMinor)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * The link to Refer a friend on My account (D131): nothing while the store's program is off, so a store without it
 * never shows a trace.
 */
export function ReferralCard({ enabled, m, base }: { enabled: boolean; m: Messages; base: string }) {
  if (!enabled) return null;
  return (
    <Link
      href={`${base}/account/referrals`}
      className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 hover:bg-surface"
    >
      <span>
        <span className="font-medium">{m.affiliate.title}</span>
        <span className="block text-sm text-muted">{m.affiliate.cardLine}</span>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
