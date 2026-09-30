import Link from "next/link";

import { BonusAdjustForm } from "@/components/admin/bonus-adjust-form";
import { entryLabel, isUsableNow, moneyIn, signedMoney } from "@/lib/bonus-admin";
import type { BonusBalance, BonusEntry, BonusResult } from "@/lib/bonus";

/** Whether a customer's page shows credits: the program is on, or the customer has some history from before. */
export const showsBonus = (enabled: boolean, entries: readonly unknown[]): boolean => enabled || entries.length > 0;

/**
 * A customer's bonus credits on their page (D130): what they can use, what is waiting, what expires next, the whole
 * ledger with its orders, and a form for staff to add or take away credits with a reason. Amounts are in the store's
 * main currency.
 */
export function CustomerBonus({
  enabled,
  balance,
  entries,
  locale,
  adminBase,
  orderIds,
  who,
  adjust,
  now = new Date(),
}: {
  /** The program is on for the store. */
  enabled: boolean;
  balance: BonusBalance;
  entries: BonusEntry[];
  locale: string;
  /** `/admin/{store}`. */
  adminBase: string;
  /** The customer's orders by number, so a ledger line can link to its order. */
  orderIds: Record<string, string>;
  who: string;
  adjust: (amountMinor: number, note: string) => Promise<BonusResult>;
  now?: Date;
}) {
  const money = moneyIn(balance.currency, locale);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const waiting = entries.filter((entry) => isUsableNow(entry, now) === false);

  return (
    <section aria-labelledby="bonus" className="rounded-lg border border-border bg-background p-5">
      <h2 id="bonus" className="mb-3 font-medium">
        Bonus credits
      </h2>
      {!enabled && (
        <p className="mb-3 rounded-md bg-surface p-3 text-sm">
          The bonus program is off, so this customer earns and uses no credits now. Their balance is kept.{" "}
          <Link href={`${adminBase}/bonus`} className="underline">
            Bonus credits
          </Link>
        </p>
      )}
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Available now</dt>
          <dd className="text-xl font-semibold">{money(balance.availableMinor)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Waiting for the return period</dt>
          <dd className="text-xl font-semibold">{money(balance.pendingMinor)}</dd>
        </div>
        <div className="col-span-2 flex flex-col gap-0.5 md:col-span-1">
          <dt className="text-muted">Next to expire</dt>
          <dd>
            {balance.expiringSoon
              ? `${money(balance.expiringSoon.amountMinor)} on ${date(balance.expiringSoon.at)}`
              : "Nothing is expiring"}
          </dd>
        </div>
      </dl>
      {waiting.length > 0 && (
        <ul className="mb-4 flex list-disc flex-col gap-0.5 pl-5 text-sm">
          {waiting.map((entry) => (
            <li key={entry.id}>
              {money(entry.amountMinor)} earned
              {entry.orderNumber ? ` on order #${entry.orderNumber}` : ""} can be used from{" "}
              {date(entry.availableAt as string)}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-2 text-sm font-medium">History</h3>
      {entries.length === 0 ? (
        <p className="mb-4 text-sm text-muted">No credits yet.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-left text-sm">
            <caption className="sr-only">Every change to this customer&apos;s credits</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Date
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  What
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Order
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Credits
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const orderId = entry.orderNumber ? orderIds[entry.orderNumber] : undefined;
                const usable = isUsableNow(entry, now);
                return (
                  <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <time dateTime={entry.at}>{date(entry.at)}</time>
                    </td>
                    <td className="py-2 pr-4">
                      {entryLabel(entry)}
                      {entry.note && <span className="block text-xs text-muted">{entry.note}</span>}
                      {usable !== null && entry.availableAt && (
                        <span className="block text-xs text-muted">
                          {usable ? "Usable" : `Usable from ${date(entry.availableAt)}`}
                        </span>
                      )}
                      {entry.expiresAt && (
                        <span className="block text-xs text-muted">Expires {date(entry.expiresAt)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {entry.orderNumber ? (
                        orderId ? (
                          <Link href={`${adminBase}/orders/${orderId}`} className="underline">
                            #{entry.orderNumber}
                          </Link>
                        ) : (
                          `#${entry.orderNumber}`
                        )
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {signedMoney(entry.amountMinor, balance.currency, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-sm underline">Adjust credits</summary>
        <div className="mt-3">
          <BonusAdjustForm
            adjust={adjust}
            currency={balance.currency}
            locale={locale}
            who={who}
            availableMinor={balance.availableMinor}
          />
        </div>
      </details>
    </section>
  );
}
