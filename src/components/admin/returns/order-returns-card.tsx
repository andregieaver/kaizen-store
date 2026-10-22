import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
import { dayText } from "@/lib/return-admin";
import { formatStoreDay } from "@/lib/return-time";
import type { OrderReturnsOverview } from "@/server/order-returns";

import { DayStepForm, RegisterWithdrawalForm, type StepAction } from "./step-forms";
import { Card, StatusBadge } from "./ui";


/** Where an order stands in the 14 days, in a sentence for staff. */
export function windowSentence(
  overview: Pick<OrderReturnsOverview, "window" | "business" | "copied" | "unitsLeft" | "right">,
  locale = "en-GB",
  w: ReturnsMessages = returnsEn,
): string {
  const c = w.orderCard;
  if (overview.copied) return c.copied;
  const { window } = overview;
  if (!window) return c.notPaid;
  if (overview.business) return overview.right === "return" ? c.companyReturn : c.company;
  const day = (value: string | null) => (value ? formatStoreDay(value, locale) : "");
  switch (window.state) {
    case "before_delivery":
      return c.beforeDelivery;
    case "statutory":
      // Sent but not recorded as received: the 14 days have not started, so there is no end day (an estimate is never a deadline).
      if (!window.statutoryEndDay) {
        return fillWords(c.notReceived, { estimate: window.estimatedEndDay ? fillWords(c.estimate, { day: day(window.estimatedEndDay) }) : "" });
      }
      return fillWords(c.until, { day: day(window.statutoryEndDay), left: window.daysLeft !== null ? countWords(window.daysLeft, c.daysLeft) : "" });
    case "voluntary":
      return fillWords(c.voluntary, { day: day(window.voluntaryEndDay) });
    default:
      return c.over;
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
  exchanges = {},
  words: w = returnsEn,
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
  /** The orders this order's returns were exchanged for (D239), by return id: "Exchanged: order {M}". */
  exchanges?: Record<string, { orderId: string; orderNumber: string; settled: boolean }>;
  /** The reader's words (D312 A4); English unless given. */
  words?: ReturnsMessages;
}) {
  const c = w.orderCard;
  const open = !overview.copied && overview.window !== null;
  const refusal = (code: string) => (Object.hasOwn(c.refusal, code) ? c.refusal[code as keyof typeof c.refusal] : undefined);
  return (
    <AdminTextScope texts={{ returns: w }}>
    <Card id="returns" title={c.title}>
      <p className="mb-3 text-sm text-muted">{windowSentence(overview, locale, w)}</p>
      {overview.heldBack.length > 0 && (
        <p role="note" className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-text">
          {fillWords(c.heldBack, { lines: overview.heldBack.map((line) => `${line.quantity} × ${line.title}`).join(", "), them: overview.heldBack.length === 1 ? c.it : c.them })}
        </p>
      )}
      {overview.returns.length === 0 ? (
        <p className="text-sm">{c.none}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {overview.returns.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`${base}/returns/${row.id}`} className="font-medium underline">
                {row.number}
              </Link>
              <StatusBadge status={row.status} words={w} />
              <span className="text-muted">
                {w.labels.kind[row.kind]} · <time dateTime={row.createdAt}>{dayText(row.createdAt, timeZone, locale)}</time>
              </span>
              {exchanges[row.id] && (
                <span>
                  {exchanges[row.id].settled ? c.exchanged : c.exchanging}
                  <Link href={`${base}/orders/${exchanges[row.id].orderId}`} className="underline">
                    #{exchanges[row.id].orderNumber}
                  </Link>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!overview.copied && overview.window && overview.unitsLeft > 0 && (
        <p className="mt-3 text-sm text-muted">
          {countWords(overview.unitsBought, c.canStill, { left: overview.unitsLeft })}{" "}
          <a href={withdrawalPage} target="_blank" rel="noreferrer" className="underline">
            {c.withdrawalPage}
          </a>
          {c.emailsLink}
        </p>
      )}
      {open && actions && today && overview.sent && !overview.business && partlySent && (
        <p className="mt-4 text-sm text-muted">{c.partlySent}</p>
      )}
      {open && actions && today && overview.sent && !overview.business && !partlySent && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm underline">{overview.deliveredOn ? c.changeReceived : c.markReceived}</summary>
          <div className="mt-3">
            <p className="mb-2 text-sm text-muted">
              {overview.deliveredOn ? fillWords(c.receivedOn, { day: formatStoreDay(overview.deliveredOn, locale) }) : c.receiptRule}
            </p>
            <DayStepForm action={actions.markDelivered} button={c.saveDay} help={c.arrivedHelp} today={today} successMessage={c.saved} />
          </div>
        </details>
      )}
      {open && actions && today && !overview.business && overview.lines.some((line) => line.remaining > 0) && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm underline">{c.register}</summary>
          <div className="mt-3">
            <p className="mb-2 text-sm text-muted">{c.registerRule}</p>
            <RegisterWithdrawalForm
              action={actions.registerWithdrawal}
              today={today}
              lines={overview.lines.map((line) => ({ ...line, refused: line.refusal ? (refusal(line.refusal) ?? null) : null }))}
            />
          </div>
        </details>
      )}
      <p className="mt-3 text-sm">
        <Link href={`${base}/returns`} className="underline">
          {c.all}
        </Link>
      </p>
    </Card>
    </AdminTextScope>
  );
}
