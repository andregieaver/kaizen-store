import Link from "next/link";

import { BonusAdjustForm } from "@/components/admin/bonus-adjust-form";
import { entryLabel, isUsableNow, moneyIn, signedMoney } from "@/lib/bonus-admin";
import type { BonusBalance, BonusEntry, BonusResult } from "@/lib/bonus";
import { Card, List, ListRow, RowAmount, RowDate, RowLead } from "@/components/admin/ui";

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
    <Card title="Bonus credits" compact>
      {!enabled && (
        <p className="mb-3 rounded-md bg-sunken p-3 text-sm">
          The bonus program is off, so this customer earns and uses no credits now. Their balance is kept.{" "}
          <Link href={`${adminBase}/bonus`} className="underline">
            Bonus credits
          </Link>
        </p>
      )}
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Available now</dt>
          <dd className="text-xl font-medium">{money(balance.availableMinor)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Waiting for the return period</dt>
          <dd className="text-xl font-medium">{money(balance.pendingMinor)}</dd>
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

      <h3 className="mb-2 text-body-strong text-ink">History</h3>
      {entries.length === 0 ? (
        <p className="mb-4 text-sm text-muted">No credits yet.</p>
      ) : (
        <div className="mb-4">
          <List label="Every change to this customer's credits">
            {entries.map((entry) => {
              const orderId = entry.orderNumber ? orderIds[entry.orderNumber] : undefined;
              const usable = isUsableNow(entry, now);
              const notes = [
                entry.note,
                usable !== null && entry.availableAt ? (usable ? "Usable" : `Usable from ${date(entry.availableAt)}`) : null,
                entry.expiresAt ? `Expires ${date(entry.expiresAt)}` : null,
              ].filter(Boolean);
              return (
                <ListRow key={entry.id}>
                  <RowDate>
                    <time dateTime={entry.at}>{date(entry.at)}</time>
                  </RowDate>
                  <RowLead
                    title={entryLabel(entry)}
                    sub={
                      notes.length > 0 || entry.orderNumber ? (
                        <>
                          {entry.orderNumber &&
                            (orderId ? (
                              <Link href={`${adminBase}/orders/${orderId}`} className="underline">
                                Order #{entry.orderNumber}
                              </Link>
                            ) : (
                              `Order #${entry.orderNumber}`
                            ))}
                          {entry.orderNumber && notes.length > 0 && " · "}
                          {notes.join(" · ")}
                        </>
                      ) : undefined
                    }
                  />
                  <RowAmount>{signedMoney(entry.amountMinor, balance.currency, locale)}</RowAmount>
                </ListRow>
              );
            })}
          </List>
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
    </Card>
  );
}
