import type { OrderEditStatus } from "@/lib/order-edit-status";
import { draftsEn, type DraftsMessages } from "@/lib/admin-messages/drafts.en";
import { blockTextWords, fillWords } from "@/lib/drafts-words";

import { AwaitingEditControls, type AwaitingEditActions } from "./order-edit-parts";
import { ButtonLink, Card } from "@/components/admin/ui";

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

/**
 * The order page's *Items* changes (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): *Edit items* when the order can be changed, else the reason in words; a change
 * waiting for the customer's payment with its link's end and what staff can do with it; and the order's changes so far (number, state, difference, who and when; never
 * staff's note, which is only in the history). In the `drafts` catalogue's words, English unless given.
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
  words = draftsEn,
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
  /** The `drafts` catalogue in the account's language (the waiting change's controls read it from the page's `AdminTextScope`). */
  words?: DraftsMessages;
}) {
  const edit = words.edit;
  const w = edit.card;
  const reasons: Record<string, string> = edit.reasons;
  const documents: Record<string, string> = w.documents;
  const blocked = blockText === null ? null : blockTextWords(blockText, edit);
  const awaiting = edits.find((e) => e.status === "awaiting_payment") ?? null;
  const owed = edits.filter((e) => (e.refundOwedMinor ?? 0) > 0);
  return (
    <Card
      title={w.title}
      aside={
        canWrite &&
        !blockText && (
          <ButtonLink href={editHref} kind="main">
            {w.edit}
          </ButtonLink>
        )
      }
      className="text-sm"
      compact
    >
      {blocked ? (
        <p className="text-muted">{blocked}</p>
      ) : (
        <p className="text-muted">
          {canWrite ? w.canWrite : w.cannotWrite}
        </p>
      )}
      {owed.map((e) => (
        <p key={`owed-${e.id}`} role="alert" className="mt-4 rounded-md border border-brand bg-sunken p-4">
          <span className="font-medium">{fillWords(w.refundFailed, { label: e.label })}</span> {fillWords(w.refundFailedText, { amount: money(e.refundOwedMinor ?? 0) })}
        </p>
      ))}
      {awaiting && (
        <div role="status" className="mt-4 flex flex-col gap-3 rounded-md border border-brand bg-sunken p-4">
          <p>
            <span className="font-medium">{fillWords(w.waiting, { label: awaiting.label })}</span>
            {fillWords(w.waitingOf, { amount: money(awaiting.differenceMinor) })}
            {awaiting.expiresAt && fillWords(w.waitingUntil, { when: when(awaiting.expiresAt) })}
            {w.waitingText}
          </p>
          {awaitingActions && <AwaitingEditControls hasEmail={hasEmail} mayRecordOutside={mayRecordOutside} amountText={money(awaiting.differenceMinor)} actions={awaitingActions} />}
        </div>
      )}
      {edits.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-3" aria-label={w.changes}>
          {edits.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{e.label}</span> · {edit.status[e.status]} · {when(e.appliedAt ?? e.endedAt ?? e.createdAt)} ·{" "}
              {e.differenceMinor === 0 ? w.noDifference : `${e.differenceMinor > 0 ? "+" : "−"}${money(Math.abs(e.differenceMinor))}`} ({money(e.totalBeforeMinor)} → {money(e.totalAfterMinor)})
              <span className="text-muted">
                {" "}
                · {reasons[e.reason] ?? e.reason}
                {e.status === "applied" && documents[e.documents] ? ` · ${documents[e.documents]}` : ""}
                {e.madeBy ? ` · ${e.madeBy}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
