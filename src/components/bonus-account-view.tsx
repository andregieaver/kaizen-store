import Link from "next/link";

import { earnPercentText, pendingParts } from "@/lib/bonus-shopper";
import { isGrantKind, type ShopperBonus } from "@/lib/bonus";
import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

import { waitPhrase } from "./bonus-credits";

/**
 * My account's bonus credits (D130): the balance (usable now, what becomes usable and when, what expires next), how the
 * program works in two sentences from the owner's settings, and the history. Amounts are in the credits' currency as
 * the shopper sees it. `orderIds` maps an order number to its id, for the orders of this customer only, so a history
 * line can link to its order; a number that is not in it is plain text.
 */
export function BonusAccountView({
  bonus,
  m,
  locale,
  base,
  orderIds,
  now = new Date(),
}: {
  bonus: ShopperBonus;
  m: Messages;
  locale: string;
  base: string;
  orderIds: Record<string, string>;
  now?: Date;
}) {
  const b = m.bonus;
  const money = (minor: number) => formatMoney(minor, bonus.currency, locale);
  const day = (iso: string, style: "long" | "medium" = "medium") =>
    new Date(iso).toLocaleDateString(locale, { dateStyle: style });
  const { balance } = bonus;
  const parts = balance.pendingMinor > 0 ? pendingParts(bonus.entries, balance.pendingMinor, now) : [];

  return (
    <>
      <div>
        <Link href={`${base}/account`} className="text-sm underline">
          {m.account.backToAccount}
        </Link>
        <h1 className="mt-2 text-3xl font-heading tracking-tight">{b.title}</h1>
      </div>

      <section aria-label={b.title} className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-sm text-muted">{b.availableLabel}</dt>
            <dd className="text-2xl font-heading">{money(balance.availableMinor)}</dd>
          </div>
          {balance.pendingMinor > 0 && (
            <div>
              <dt className="text-sm text-muted">{b.pendingLabel}</dt>
              <dd>
                {money(balance.pendingMinor)}
                {parts.length > 0 && (
                  <ul className="mt-1 text-sm text-muted">
                    {parts.map((part) => (
                      <li key={part.availableAt}>{b.pendingFrom(money(part.amountMinor), day(part.availableAt))}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          )}
          {balance.expiringSoon && (
            <div>
              <dt className="text-sm text-muted">{b.expiringLabel}</dt>
              <dd>{b.expiresOn(money(balance.expiringSoon.amountMinor), day(balance.expiringSoon.at))}</dd>
            </div>
          )}
        </dl>
      </section>

      <section aria-labelledby="bonus-how-heading" className="flex flex-col gap-2">
        <h2 id="bonus-how-heading" className="text-xl font-heading">
          {b.howHeading}
        </h2>
        <p>{b.howEarn(earnPercentText(bonus.earnPercent, locale), waitPhrase(m, bonus.pendingDays))}</p>
        <p>{bonus.expiresMonths ? b.howUseExpires(b.monthCount(bonus.expiresMonths)) : b.howUse}</p>
      </section>

      <section aria-labelledby="bonus-history-heading" className="flex flex-col gap-3">
        <h2 id="bonus-history-heading" className="text-xl font-heading">
          {b.historyHeading}
        </h2>
        {bonus.entries.length === 0 ? (
          <p className="text-muted">{b.noHistory}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {bonus.entries.map((entry) => {
              const orderId = entry.orderNumber ? orderIds[entry.orderNumber] : undefined;
              const when =
                isGrantKind(entry.kind)
                  ? [
                      entry.availableAt &&
                        new Date(entry.availableAt).getTime() > now.getTime() &&
                        b.entryUsableFrom(day(entry.availableAt)),
                      entry.expiresAt && b.entryExpires(day(entry.expiresAt)),
                    ].filter(Boolean)
                  : [];
              return (
                <li key={entry.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4">
                  <span className="min-w-0">
                    <span className="font-medium">{b.kinds[entry.kind]}</span>
                    <span className="block text-sm text-muted">
                      {day(entry.at)}
                      {entry.orderNumber && (
                        <>
                          {" · "}
                          {orderId ? (
                            <Link href={`${base}/account/orders/${orderId}`} className="underline">
                              {m.account.order(entry.orderNumber)}
                            </Link>
                          ) : (
                            m.account.order(entry.orderNumber)
                          )}
                        </>
                      )}
                      {when.length > 0 && ` · ${when.join(" · ")}`}
                    </span>
                    {entry.note && <span className="block text-sm text-muted">{entry.note}</span>}
                  </span>
                  <span className="font-medium whitespace-nowrap">
                    {entry.amountMinor >= 0 ? "+" : "−"}
                    {money(Math.abs(entry.amountMinor))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * The link to the bonus credits page on My account (D130), with the balance usable now; nothing while the store's program
 * is off, so a store without it never shows a trace.
 */
export function BonusCard({
  bonus,
  m,
  locale,
  base,
}: {
  bonus: ShopperBonus;
  m: Messages;
  locale: string;
  base: string;
}) {
  if (!bonus.enabled) return null;
  return (
    <Link
      href={`${base}/account/bonus`}
      className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 hover:bg-surface"
    >
      <span>
        <span className="font-medium">{m.bonus.title}</span>
        <span className="block text-sm text-muted">
          {m.bonus.cardAvailable(formatMoney(bonus.balance.availableMinor, bonus.currency, locale))}
        </span>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
