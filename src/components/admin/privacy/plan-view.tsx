import { PLAN_WARNING_TEXT, type ErasurePlan, type PlanAction } from "@/lib/erasure-plan";
import { formatMoney } from "@/lib/money";
import { STAFF_TEXT } from "@/lib/privacy-text";

import { card, dayText } from "./styles";

export const ACTION_WORDS: Record<PlanAction, string> = {
  deleted: "Deleted",
  anonymised: "Made anonymous",
  restricted: "Kept restricted",
  kept: "Kept",
};

/**
 * Step 1 of the erase page (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 3): one row for every kind of data the store holds about the
 * person, with how many, what happens to it and the reason; then what else happens (subscriptions, cards, credits, orders that go on) and
 * the warnings. It is read-only and drawn from `planErasure()`, the same code as the run, so what it says is what will happen.
 */
export function ErasurePlanView({ plan, locale = "en-GB" }: { plan: ErasurePlan; locale?: string }) {
  const also = plan.alsoHappens;
  const lines: string[] = [];
  if (also.subscriptionsCancelled > 0) {
    lines.push(`${also.subscriptionsCancelled === 1 ? "1 subscription is" : `${also.subscriptionsCancelled} subscriptions are`} cancelled now and not refunded.`);
  }
  if (also.savedCardsDetached > 0) lines.push(`${also.savedCardsDetached === 1 ? "1 saved card is" : `${also.savedCardsDetached} saved cards are`} detached from the customer.`);
  for (const b of also.bonusForfeited) lines.push(`Bonus credits worth ${formatMoney(b.amountMinor, b.currency, locale)} are forfeited.`);
  for (const r of also.restrictedTotals) {
    lines.push(`${r.count === 1 ? "1 sale" : `${r.count ?? 0} sales`} worth ${formatMoney(r.amountMinor, r.currency, locale)} ${r.count === 1 ? "stays" : "stay"} in the accounts, cut loose from the person.`);
  }
  if (also.ordersCancelled > 0) lines.push(`${also.ordersCancelled === 1 ? "1 order waiting for payment is cancelled and its checkout closed." : `${also.ordersCancelled} orders waiting for payment are cancelled and their checkouts closed.`}`);
  if (also.openOrders > 0) lines.push(`${also.openOrders === 1 ? "1 open order continues" : `${also.openOrders} open orders continue`}.`);
  if (also.openReturns > 0) lines.push(`${also.openReturns === 1 ? "1 open return continues" : `${also.openReturns} open returns continue`}.`);
  if (also.emailOptOutKept) lines.push("The email opt-out is kept, so the address is not written to again.");
  lines.push(STAFF_TEXT.stripeNote);

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="plan-table" className={card}>
        <h2 id="plan-table" className="font-medium">
          What happens to each kind of data
        </h2>
        {plan.rows.length === 0 ? (
          <p className="text-sm text-muted">{STAFF_TEXT.noData}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">What erasing does to each kind of data</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Data</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Count</th>
                  <th scope="col" className="py-2 pr-3 font-medium">What happens</th>
                  <th scope="col" className="py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={`${row.table}:${row.action}`} className="border-t border-border align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {row.label}
                    </th>
                    <td className="py-2 pr-3 text-right">{row.count}</td>
                    <td className="py-2 pr-3">
                      {ACTION_WORDS[row.action]}
                      {row.keptUntil && (
                        <span className="block text-xs text-muted">
                          {row.keptUntil.first === row.keptUntil.last
                            ? `until ${dayText(row.keptUntil.first)}`
                            : `from ${dayText(row.keptUntil.first)} to ${dayText(row.keptUntil.last)}`}
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
        <h2 id="plan-also" className="font-medium">
          What else happens
        </h2>
        <ul className="list-disc pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-sm text-muted">{STAFF_TEXT.eraseIrreversible}</p>
      </section>

      {plan.warnings.length > 0 && (
        <section aria-labelledby="plan-warnings" className={card}>
          <h2 id="plan-warnings" className="font-medium">
            Check before you erase
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {plan.warnings.map((kind) => (
              <li key={kind}>{PLAN_WARNING_TEXT[kind]}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
