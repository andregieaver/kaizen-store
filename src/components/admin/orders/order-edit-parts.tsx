"use client";

import { useId, useState, useTransition } from "react";

import type { EditActionResponse } from "@/app/admin/(gated)/[store]/orders/[orderId]/edit/actions";
import { field, hint, secondary } from "@/components/admin/data/ui";
import { CASH_WARNING, LinkNotice } from "@/components/admin/drafts/draft-send";
import { MANUAL_METHOD_LABELS, MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "@/lib/draft-input";
import { DRAFT_REFERENCE_MAX, MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";

/** What *Record as paid outside Kaizen* sends (`editPaidOutsideInput`, D173's fields). */
export type OutsideInput = { method: ManualPaymentMethod; receivedOn?: string; reference?: string };

/** The answer of an action on a change: what happened, or why nothing did, with the problems in words. */
export function EditOutcome({ result }: { result: EditActionResponse | null }) {
  if (!result) return null;
  return (
    <div role={result.ok ? "status" : "alert"} aria-live="polite" className={`flex flex-col gap-1 text-sm ${result.ok ? "" : "text-red-700 dark:text-red-400"}`}>
      <p>{result.message}</p>
      {result.problems && result.problems.length > 0 && (
        <ul className="list-disc pl-5">
          {result.problems.map((p, i) => (
            <li key={`${p.code}-${p.key ?? i}`}>{p.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * *Record as paid outside Kaizen* for a change with a higher total (D174 2.2, D173's rule): the customer paid the difference by bank transfer, in cash or another way. The
 * owner always may; staff only when the owner allowed it. Kaizen records a payment of the difference with the method, the day received and a reference, and applies the
 * change at once. It never charges a card.
 */
export function OutsidePaymentForm({ allowed, disabled, amountText, record }: { allowed: boolean; disabled: boolean; amountText: string; record: (input: OutsideInput) => void }) {
  const id = useId();
  const [method, setMethod] = useState<ManualPaymentMethod>("bank_transfer");
  const [receivedOn, setReceivedOn] = useState("");
  const [reference, setReference] = useState("");
  if (!allowed) {
    return <p className={hint}>Only the owner can record a payment taken outside Kaizen, unless the owner allows staff to (Settings, Orders).</p>;
  }
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer font-medium">Record as paid outside Kaizen</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className={hint}>
          The customer paid you {amountText} by bank transfer, in cash or another way. The change is applied at once and the additional invoice says it was paid outside the online checkout. Kaizen
          did not touch the money and takes no sale fee on it.
        </p>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">How was it paid?</legend>
          {MANUAL_PAYMENT_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name={`${id}-method`} value={m} checked={method === m} onChange={() => setMethod(m)} className="size-4" />
              {MANUAL_METHOD_LABELS[m]}
            </label>
          ))}
        </fieldset>
        {method === "cash" && (
          <p role="note" className="rounded-md border border-border bg-surface p-3">
            {CASH_WARNING}
          </p>
        )}
        <label className="flex flex-col gap-1 font-medium">
          Received on <span className="font-normal text-muted">(leave empty if it was today; at most {MANUAL_RECEIVED_DAYS_MAX} days back)</span>
          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={`${field} w-44`} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Reference <span className="font-normal text-muted">(optional, kept in the order&apos;s history)</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={DRAFT_REFERENCE_MAX} autoComplete="off" className={field} />
        </label>
        <div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm(`Record ${amountText} as paid outside Kaizen and apply the change? This cannot be undone: a mistake is corrected with a refund.`)) return;
              record({ method, ...(receivedOn ? { receivedOn } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) });
            }}
            className={secondary}
          >
            Record the payment and apply the change
          </button>
        </div>
      </div>
    </details>
  );
}

export type AwaitingEditActions = {
  resend: (options: { email: boolean }) => Promise<EditActionResponse>;
  cancel: () => Promise<EditActionResponse>;
  paidOutside: (input: OutsideInput) => Promise<EditActionResponse>;
};

/**
 * What staff do with a change waiting for the customer's payment (D174 2.2), on the order page: *Send again* (a new link replaces the old), *Create a link to share* (shown
 * once), *Record as paid outside Kaizen*, *Cancel the change* (its Stripe session closed first, the held items released). While it waits, nothing of the order is sent,
 * refunded or cancelled.
 */
export function AwaitingEditControls({ hasEmail, mayRecordOutside, amountText, actions }: { hasEmail: boolean; mayRecordOutside: boolean; amountText: string; actions: AwaitingEditActions }) {
  const [result, setResult] = useState<EditActionResponse | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [working, start] = useTransition();
  const run = (action: () => Promise<EditActionResponse>) =>
    start(async () => {
      setResult(null);
      try {
        const answer = await action();
        setResult(answer);
        if (answer.ok && answer.link) setLink(answer.link);
      } catch {
        setResult({ ok: false, message: "That could not be done. Check your connection and try again." });
      }
    });
  return (
    <div className="flex flex-col gap-3">
      {link && <LinkNotice link={link} onClose={() => setLink(null)} />}
      <div className="flex flex-wrap gap-2">
        {hasEmail && (
          <button type="button" disabled={working} onClick={() => run(() => actions.resend({ email: true }))} className={secondary}>
            Send again
          </button>
        )}
        <button type="button" disabled={working} onClick={() => run(() => actions.resend({ email: false }))} className={secondary}>
          Create a link to share
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => {
            if (!window.confirm("Cancel this change? The link stops working, the items held for it are released and the order stays as it is.")) return;
            run(actions.cancel);
          }}
          className={secondary}
        >
          Cancel the change
        </button>
      </div>
      <OutsidePaymentForm allowed={mayRecordOutside} disabled={working} amountText={amountText} record={(input) => run(() => actions.paidOutside(input))} />
      <EditOutcome result={result} />
    </div>
  );
}
