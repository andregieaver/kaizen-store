import { countWords, fillWords } from "@/lib/admin-fill";
import { privacyEn, type PrivacyMessages } from "@/lib/admin-messages/privacy.en";
import type { ErasurePlan } from "@/lib/erasure-plan";
import { formatMoney } from "@/lib/money";

import { card, dayText } from "./styles";

/**
 * Step 1 of the erase page (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 3): one row for every kind of data the store holds about the
 * person, with how many, what happens to it and the reason; then what else happens (subscriptions, cards, credits, orders that go on) and
 * the warnings. It is read-only and drawn from `planErasure()`, the same code as the run, so what it says is what will happen.
 */
export function ErasurePlanView({
  plan,
  locale = "en-GB",
  words = privacyEn,
  dateLocale = "en-GB",
}: {
  plan: ErasurePlan;
  /** The store's locale, for amounts. */
  locale?: string;
  /** The privacy screens' words in the admin's language, and its date locale. */
  words?: PrivacyMessages;
  dateLocale?: string;
}) {
  const w = words.plan;
  const day = (value: string) => dayText(value, undefined, dateLocale);
  const also = plan.alsoHappens;
  const lines: string[] = [];
  if (also.subscriptionsCancelled > 0) lines.push(countWords(also.subscriptionsCancelled, w.subscriptions));
  if (also.savedCardsDetached > 0) lines.push(countWords(also.savedCardsDetached, w.cards));
  for (const b of also.bonusForfeited) lines.push(fillWords(w.bonus, { amount: formatMoney(b.amountMinor, b.currency, locale) }));
  for (const r of also.restrictedTotals) lines.push(countWords(r.count ?? 0, w.sales, { amount: formatMoney(r.amountMinor, r.currency, locale) }));
  if (also.ordersCancelled > 0) lines.push(countWords(also.ordersCancelled, w.ordersCancelled));
  if (also.openOrders > 0) lines.push(countWords(also.openOrders, w.openOrders));
  if (also.openReturns > 0) lines.push(countWords(also.openReturns, w.openReturns));
  if (also.emailOptOutKept) lines.push(w.optOutKept);
  lines.push(words.staff.stripeNote);
  /** A row's name in the admin's language: the orders' two rows by what happens to them, the rest by table. */
  const rowLabel = (row: ErasurePlan["rows"][number]): string =>
    row.table === "orders" ? (row.action === "restricted" ? w.ordersRestricted : w.ordersAnonymised) : (w.tables[row.table] ?? row.label);

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="plan-table" className={card}>
        <h2 id="plan-table" className="text-title text-ink">
          {w.tableTitle}
        </h2>
        {plan.rows.length === 0 ? (
          <p className="text-sm text-muted">{words.staff.noData}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">{w.tableCaption}</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {w.data}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    {w.count}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {w.whatHappens}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {w.why}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={`${row.table}:${row.action}`} className="border-t border-line align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {rowLabel(row)}
                    </th>
                    <td className="py-2 pr-3 text-right">{row.count}</td>
                    <td className="py-2 pr-3">
                      {w.actions[row.action]}
                      {row.keptUntil && (
                        <span className="block text-xs text-muted">
                          {row.keptUntil.first === row.keptUntil.last
                            ? fillWords(w.until, { date: day(row.keptUntil.first) })
                            : fillWords(w.fromTo, { first: day(row.keptUntil.first), last: day(row.keptUntil.last) })}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-muted">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="plan-also" className={card}>
        <h2 id="plan-also" className="text-title text-ink">
          {w.alsoTitle}
        </h2>
        <ul className="list-disc pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-sm text-muted">{words.staff.eraseIrreversible}</p>
      </section>

      {plan.warnings.length > 0 && (
        <section aria-labelledby="plan-warnings" className={card}>
          <h2 id="plan-warnings" className="text-title text-ink">
            {w.warningsTitle}
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {plan.warnings.map((kind) => (
              <li key={kind}>{w.warnings[kind]}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
