import Link from "next/link";

import { BonusAdjustForm } from "@/components/admin/bonus-adjust-form";
import { fillWords } from "@/lib/admin-fill";
import { loyaltyEn, type LoyaltyMessages } from "@/lib/admin-messages/loyalty.en";
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
  words = loyaltyEn,
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
  /** The `loyalty` catalogue in the account's language; the adjust form reads its own through `useAdminText()`. */
  words?: LoyaltyMessages;
}) {
  const w = words.customerBonus;
  const money = moneyIn(balance.currency, locale);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const waiting = entries.filter((entry) => isUsableNow(entry, now) === false);

  return (
    <Card title={w.title} compact>
      {!enabled && (
        <p className="mb-3 rounded-md bg-sunken p-3 text-sm">
          {w.off}{" "}
          <Link href={`${adminBase}/bonus`} className="underline">
            {w.pageLink}
          </Link>
        </p>
      )}
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">{w.available}</dt>
          <dd className="text-xl font-medium">{money(balance.availableMinor)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">{w.waiting}</dt>
          <dd className="text-xl font-medium">{money(balance.pendingMinor)}</dd>
        </div>
        <div className="col-span-2 flex flex-col gap-0.5 md:col-span-1">
          <dt className="text-muted">{w.nextExpire}</dt>
          <dd>
            {balance.expiringSoon
              ? fillWords(w.expiringOn, { amount: money(balance.expiringSoon.amountMinor), date: date(balance.expiringSoon.at) })
              : w.nothingExpiring}
          </dd>
        </div>
      </dl>
      {waiting.length > 0 && (
        <ul className="mb-4 flex list-disc flex-col gap-0.5 pl-5 text-sm">
          {waiting.map((entry) => (
            <li key={entry.id}>
              {fillWords(w.waitingLine, {
                amount: money(entry.amountMinor),
                order: entry.orderNumber ? fillWords(w.onOrder, { number: entry.orderNumber }) : "",
                date: date(entry.availableAt as string),
              })}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-2 text-body-strong text-ink">{w.history}</h3>
      {entries.length === 0 ? (
        <p className="mb-4 text-sm text-muted">{w.none}</p>
      ) : (
        <div className="mb-4">
          <List label={w.listLabel}>
            {entries.map((entry) => {
              const orderId = entry.orderNumber ? orderIds[entry.orderNumber] : undefined;
              const usable = isUsableNow(entry, now);
              const notes = [
                entry.note,
                usable !== null && entry.availableAt ? (usable ? w.usable : fillWords(w.usableFrom, { date: date(entry.availableAt) })) : null,
                entry.expiresAt ? fillWords(w.expires, { date: date(entry.expiresAt) }) : null,
              ].filter(Boolean);
              return (
                <ListRow key={entry.id}>
                  <RowDate>
                    <time dateTime={entry.at}>{date(entry.at)}</time>
                  </RowDate>
                  <RowLead
                    title={entryLabel(entry, words.bonusKinds)}
                    sub={
                      notes.length > 0 || entry.orderNumber ? (
                        <>
                          {entry.orderNumber &&
                            (orderId ? (
                              <Link href={`${adminBase}/orders/${orderId}`} className="underline">
                                {fillWords(w.order, { number: entry.orderNumber })}
                              </Link>
                            ) : (
                              fillWords(w.order, { number: entry.orderNumber })
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
        <summary className="cursor-pointer text-sm underline">{w.adjust}</summary>
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
