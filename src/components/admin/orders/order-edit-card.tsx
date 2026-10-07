import Link from "next/link";

import { ORDER_EDIT_REASON_LABELS, ORDER_EDIT_STATUS_LABELS, type OrderEditReason, type OrderEditStatus } from "@/lib/order-edit-status";

import { AwaitingEditControls, type AwaitingEditActions } from "./order-edit-parts";

/** A change as the order page lists it (`OrderEditSummary` of `getOrderAdmin()`, structurally). */
export type EditListItem = {
  id: string;
  label: string;
  status: OrderEditStatus;
  reason: string;
  differenceMinor: number;
  totalBeforeMinor: number;
  totalAfterMinor: number;
  documents: string;
  expiresAt: string | null;
  createdAt: string;
  appliedAt: string | null;
  endedAt: string | null;
  madeBy: string | null;
  /** The change's refund failed after the change was applied on Stripe's `pending` answer: what the customer is still owed (0 or absent: nothing). */
  refundOwedMinor?: number;
};

const DOCUMENT_WORDS: Record<string, string> = {
  issued: "documents issued",
  waiting: "documents waiting",
  not_invoiced: "no documents (the order has no invoice)",
  in_original: "in the order's own invoice",
  none: "",
};

/**
 * The order page's *Items* changes (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): *Edit items* when the order can be changed, else the reason in words; a change
 * waiting for the customer's payment with its link's end and what staff can do with it; and the order's changes so far (number, state, difference, who and when; never
 * staff's note, which is only in the history). English: the admin.
 */
export function OrderEditCard({
  editHref,
  canWrite,
  blockText,
  edits,
  money,
  when,
  hasEmail,
  mayRecordOutside,
  awaitingActions,
}: {
  editHref: string;
  canWrite: boolean;
  /** Why the order cannot be changed now, in words (`editBlockText()`), or null when it can. */
  blockText: string | null;
  edits: EditListItem[];
  money: (minor: number) => string;
  when: (iso: string) => string;
  hasEmail: boolean;
  mayRecordOutside: boolean;
  /** The actions on the waiting change, bound to the store and the change by the page; null for someone who may only read. */
  awaitingActions: AwaitingEditActions | null;
}) {
  const awaiting = edits.find((e) => e.status === "awaiting_payment") ?? null;
  const owed = edits.filter((e) => (e.refundOwedMinor ?? 0) > 0);
  return (
    <section aria-labelledby="order-changes" className="rounded-lg border border-border bg-background p-5 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 id="order-changes" className="font-medium">
          Change the items
        </h2>
        {canWrite && !blockText && (
          <Link href={editHref} className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 font-medium text-background">
            Edit items
          </Link>
        )}
      </div>
      {blockText ? (
        <p className="text-muted">{blockText}</p>
      ) : (
        <p className="text-muted">
          {canWrite
            ? "Add products, lower quantities or take items off, and change the shipping. A lower total is refunded; a higher one is paid by the customer through a link before the order changes."
            : "This order can be changed by someone who may change orders."}
        </p>
      )}
      {owed.map((e) => (
        <p key={`owed-${e.id}`} role="alert" className="mt-4 rounded-md border border-foreground bg-surface p-4">
          <span className="font-medium">The refund of change {e.label} failed.</span> {money(e.refundOwedMinor ?? 0)} has not reached the customer, although the order already shows the
          lower total. Refund it again from this page (Refund), or pay it back another way and record it.
        </p>
      ))}
      {awaiting && (
        <div role="status" className="mt-4 flex flex-col gap-3 rounded-md border border-foreground bg-surface p-4">
          <p>
            <span className="font-medium">Change {awaiting.label} is waiting for the customer&apos;s payment</span> of {money(awaiting.differenceMinor)}
            {awaiting.expiresAt && <> until {when(awaiting.expiresAt)}</>}. The order stays as it is until it is paid; nothing is sent, refunded or cancelled meanwhile. If it is not paid, the
            items held for it are released and nothing changes.
          </p>
          {awaitingActions && <AwaitingEditControls hasEmail={hasEmail} mayRecordOutside={mayRecordOutside} amountText={money(awaiting.differenceMinor)} actions={awaitingActions} />}
        </div>
      )}
      {edits.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 border-t border-border pt-3" aria-label="Changes to this order">
          {edits.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{e.label}</span> · {ORDER_EDIT_STATUS_LABELS[e.status]} · {when(e.appliedAt ?? e.endedAt ?? e.createdAt)} ·{" "}
              {e.differenceMinor === 0 ? "no difference" : `${e.differenceMinor > 0 ? "+" : "−"}${money(Math.abs(e.differenceMinor))}`} ({money(e.totalBeforeMinor)} → {money(e.totalAfterMinor)})
              <span className="text-muted">
                {" "}
                · {ORDER_EDIT_REASON_LABELS[e.reason as OrderEditReason] ?? e.reason}
                {e.status === "applied" && DOCUMENT_WORDS[e.documents] ? ` · ${DOCUMENT_WORDS[e.documents]}` : ""}
                {e.madeBy ? ` · ${e.madeBy}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
