import { formatMoney } from "@/lib/money";
import type { Messages } from "@/lib/i18n";
import type { ApprovalOrder } from "@/server/company-approvals";
import type { TermsDisplay } from "@/lib/checkout-terms";

import { ApprovedPayForm } from "./approved-pay-form";

/**
 * Your company's orders that wait (D321 C.2): those an approver may approve or decline, and the member's own orders waiting for approval or, once
 * approved, for them to pay. Plain forms posting to server actions, so they work without JavaScript.
 */
export function CompanyApprovals({
  toApprove,
  mine,
  locale,
  m,
  decide,
  pay,
  store,
  market,
  terms,
}: {
  toApprove: ApprovalOrder[];
  mine: ApprovalOrder[];
  locale: string;
  m: Messages["companyAccount"];
  decide: (orderId: string, approve: boolean) => (form: FormData) => Promise<void>;
  pay: (orderId: string) => (form: FormData) => Promise<void>;
  store: string;
  market: string;
  /** The store's terms at checkout as the checkout draws them, or null when it shows none. */
  terms: { display: TermsDisplay; template: string; newTab: string } | null;
}) {
  const box = "divide-y divide-border rounded-lg border border-border";
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
  const facts = (order: ApprovalOrder) =>
    [formatMoney(order.totalMinor, order.currency, locale), order.location && m.forLocation(order.location), order.poNumber && m.poShown(order.poNumber), date(order.placedAt)]
      .filter(Boolean)
      .join(" · ");
  return (
    <>
      {toApprove.length > 0 && (
        <section aria-labelledby="approve-heading" className="flex flex-col gap-3">
          <h2 id="approve-heading" className="text-xl font-heading">
            {m.toApprove}
          </h2>
          <ul className={box}>
            {toApprove.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.orderBy(order.number, order.buyer)}</span>
                  <span className="block text-sm text-muted">{facts(order)}</span>
                </span>
                <form action={decide(order.id, true)}>
                  <button type="submit" className="button-primary min-h-11 rounded-button px-4">
                    {m.approve}
                  </button>
                </form>
                <form action={decide(order.id, false)}>
                  <button type="submit" className="min-h-11 rounded-button border border-border px-4">
                    {m.decline}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      {mine.length > 0 && (
        <section aria-labelledby="mine-heading" className="flex flex-col gap-3">
          <h2 id="mine-heading" className="text-xl font-heading">
            {m.yourWaiting}
          </h2>
          <ul className={box}>
            {mine.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.orderNumber(order.number)}</span>
                  <span className="block text-sm text-muted">{facts(order)}</span>
                  <span className="block text-sm">{order.approval === "approved" ? m.approvedState : m.waitingState}</span>
                </span>
                {order.approval === "approved" && (
                  <ApprovedPayForm
                    store={store}
                    market={market}
                    display={terms?.display ?? null}
                    template={terms?.template ?? ""}
                    newTab={terms?.newTab ?? ""}
                    label={m.payNow}
                    action={pay(order.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
