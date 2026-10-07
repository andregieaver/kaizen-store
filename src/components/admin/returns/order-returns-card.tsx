import Link from "next/link";

import { dayText, KIND_LABELS } from "@/lib/return-admin";
import { formatStoreDay } from "@/lib/return-time";
import type { OrderReturnsOverview } from "@/server/order-returns";

import { DayStepForm, RegisterWithdrawalForm, type StepAction } from "./step-forms";
import { Card, StatusBadge } from "./ui";

const REFUSAL_WORDS: Record<string, string> = {
  order_not_paid: "not paid",
  copied_order: "copied history",
  already_returned: "all of it is already withdrawn or returned",
  excluded_by_law: "excluded by law",
  digital_content: "digital content",
  booking: "a booking",
  business_order: "a company's order",
  period_over: "the 14 days had passed by the records",
};

/** Where an order stands in the 14 days, in a sentence for staff. */
export function windowSentence(overview: Pick<OrderReturnsOverview, "window" | "business" | "copied" | "unitsLeft" | "right">, locale = "en-GB"): string {
  if (overview.copied) return "This order is history copied from another store, so nothing can be withdrawn or returned on it.";
  const { window } = overview;
  if (!window) return "The order is not paid, so there is nothing to withdraw from yet.";
  if (overview.business) {
    return overview.right === "return"
      ? "This order was placed by a company, which has no legal right of withdrawal. Your own return window is open for it."
      : "This order was placed by a company, which has no legal right of withdrawal.";
  }
  const day = (value: string | null) => (value ? formatStoreDay(value, locale) : "");
  switch (window.state) {
    case "before_delivery":
      return "The order has not been sent. The customer can withdraw from it at any time before it arrives.";
    case "statutory":
      // Sent but not recorded as received: the 14 days have not started, so there is no end day (an estimate is never a deadline).
      if (!window.statutoryEndDay) {
        return `The goods have been sent, but their receipt is not recorded, so the customer's 14 days have not started and they can withdraw. Record the day they received the goods below.${
          window.estimatedEndDay ? ` If the parcel took your usual transit time the days would run to about ${day(window.estimatedEndDay)}: an estimate, not a deadline.` : ""
        }`;
      }
      return `The customer can withdraw until ${day(window.statutoryEndDay)}${window.daysLeft !== null ? ` (${window.daysLeft} ${window.daysLeft === 1 ? "day" : "days"} left)` : ""}.`;
    case "voluntary":
      return `The 14 days of the right of withdrawal are over. Your own return window runs to ${day(window.voluntaryEndDay)}, and a request inside it is yours to approve or decline.`;
    default:
      return "The return period is over.";
  }
}

/**
 * The order page's part of returns (D153): the withdrawals and returns made on the order, each linking to its screen, and
 * where the order stands in time. Customers make a withdrawal themselves, on the store's withdrawal page.
 */
export function OrderReturnsCard({
  base,
  overview,
  withdrawalPage,
  timeZone,
  locale = "en-GB",
  actions,
  today,
  partlySent = false,
}: {
  /** `/admin/{store}` */
  base: string;
  overview: OrderReturnsOverview;
  /** The customer's withdrawal page for this order's market, without the order's key. */
  withdrawalPage: string;
  timeZone: string;
  locale?: string;
  /** Staff's own steps on this order, bound to the store and the order by the page; without them only the facts are shown. */
  actions?: { markDelivered: StepAction; registerWithdrawal: StepAction };
  /** The store's today, `YYYY-MM-DD`, the latest day a form accepts. */
  today?: string;
  /**
   * Part of the order is sent and part is still to send (D174): goods ordered together and delivered separately are received when the last one is (CRD Art. 9(2)(b)),
   * so there is no receipt to record yet and the form is replaced by a sentence.
   */
  partlySent?: boolean;
}) {
  const open = !overview.copied && overview.window !== null;
  return (
    <Card id="returns" title="Returns and withdrawals">
      <p className="mb-3 text-sm text-muted">{windowSentence(overview, locale)}</p>
      {overview.heldBack.length > 0 && (
        <p role="note" className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Withdrawn before sending: {overview.heldBack.map((line) => `${line.quantity} × ${line.title}`).join(", ")}. Leave {overview.heldBack.length === 1 ? "it" : "them"} out of
          the parcel; the refund is due without waiting for any goods.
        </p>
      )}
      {overview.returns.length === 0 ? (
        <p className="text-sm">No withdrawal or return has been made on this order.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {overview.returns.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`${base}/returns/${row.id}`} className="font-medium underline">
                {row.number}
              </Link>
              <StatusBadge status={row.status} />
              <span className="text-muted">
                {KIND_LABELS[row.kind]} · <time dateTime={row.createdAt}>{dayText(row.createdAt, timeZone)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!overview.copied && overview.window && overview.unitsLeft > 0 && (
        <p className="mt-3 text-sm text-muted">
          {overview.unitsLeft} of {overview.unitsBought} {overview.unitsBought === 1 ? "unit" : "units"} can still be withdrawn or returned. The
          customer does it on the store&apos;s{" "}
          <a href={withdrawalPage} target="_blank" rel="noreferrer" className="underline">
            withdrawal page
          </a>
          ; the order emails link to it with the order filled in.
        </p>
      )}
      {open && actions && today && overview.sent && !overview.business && partlySent && (
        <p className="mt-4 text-sm text-muted">Record the receipt when the last parcel has arrived: part of this order is still to send.</p>
      )}
      {open && actions && today && overview.sent && !overview.business && !partlySent && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm underline">{overview.deliveredOn ? "Change the day the goods were received" : "Mark the goods as received by the customer"}</summary>
          <div className="mt-3">
            <p className="mb-2 text-sm text-muted">
              {overview.deliveredOn
                ? `Recorded as received on ${formatStoreDay(overview.deliveredOn, locale)}.`
                : "The customer's 14 days start the day they received the goods, the last of them if they came in parts. Mark it from the carrier's tracking or what the customer says; never from the day you sent it."}
            </p>
            <DayStepForm action={actions.markDelivered} button="Save the day" help="the day the goods arrived; today if left empty" today={today} successMessage="Saved." />
          </div>
        </details>
      )}
      {open && actions && today && !overview.business && overview.lines.some((line) => line.remaining > 0) && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm underline">Register a withdrawal the customer made outside the form</summary>
          <div className="mt-3">
            <p className="mb-2 text-sm text-muted">
              An email, a letter or a call counts as a withdrawal if it says clearly that the customer withdraws, and so does a statement the form could not match
              to this order. Register it here: it is recorded as the form would, with the day you were told starting the 14 days for the refund, and the customer
              is sent the acknowledgement.
            </p>
            <RegisterWithdrawalForm
              action={actions.registerWithdrawal}
              today={today}
              lines={overview.lines.map((line) => ({ ...line, refused: line.refusal ? REFUSAL_WORDS[line.refusal] : null }))}
            />
          </div>
        </details>
      )}
      <p className="mt-3 text-sm">
        <Link href={`${base}/returns`} className="underline">
          All returns
        </Link>
      </p>
    </Card>
  );
}
