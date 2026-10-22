"use client";

import { useId, useState, useTransition } from "react";

import type { EditActionResponse } from "@/app/admin/(gated)/[store]/orders/[orderId]/edit/actions";
import { field, hint, secondary } from "@/components/admin/data/ui";
import { LinkNotice, useCashWarning } from "@/components/admin/drafts/draft-send";
import { useAdminText } from "@/components/admin/admin-text";
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "@/lib/draft-input";
import { fillWords } from "@/lib/drafts-words";
import { DRAFT_REFERENCE_MAX, MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";

/** What *Record as paid outside Kaizen* sends (`editPaidOutsideInput`, D173's fields). */
export type OutsideInput = { method: ManualPaymentMethod; receivedOn?: string; reference?: string };

/** The answer of an action on a change: what happened, or why nothing did, with the problems in words. */
export function EditOutcome({ result }: { result: EditActionResponse | null }) {
  if (!result) return null;
  return (
    <div role={result.ok ? "status" : "alert"} aria-live="polite" className={`flex flex-col gap-1 text-sm ${result.ok ? "" : "text-danger-text "}`}>
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
  const all = useAdminText("drafts");
  const w = all.edit.parts;
  const cashWarning = useCashWarning();
  const [method, setMethod] = useState<ManualPaymentMethod>("bank_transfer");
  const [receivedOn, setReceivedOn] = useState("");
  const [reference, setReference] = useState("");
  if (!allowed) {
    return <p className={hint}>{w.ownerOnly}</p>;
  }
  return (
    <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer font-medium">{w.record}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className={hint}>{fillWords(w.hint, { amount: amountText })}</p>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{w.how}</legend>
          {MANUAL_PAYMENT_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name={`${id}-method`} value={m} checked={method === m} onChange={() => setMethod(m)} className="size-4" />
              {all.methods[m]}
            </label>
          ))}
        </fieldset>
        {method === "cash" && (
          <p role="note" className="rounded-md border border-line bg-sunken p-3">
            {cashWarning}
          </p>
        )}
        <label className="flex flex-col gap-1 font-medium">
          {w.receivedOn} <span className="font-normal text-muted">{fillWords(w.receivedHint, { max: MANUAL_RECEIVED_DAYS_MAX })}</span>
          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={`${field} w-44`} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          {w.reference} <span className="font-normal text-muted">{w.referenceHint}</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={DRAFT_REFERENCE_MAX} autoComplete="off" className={field} />
        </label>
        <div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm(fillWords(w.confirm, { amount: amountText }))) return;
              record({ method, ...(receivedOn ? { receivedOn } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) });
            }}
            className={secondary}
          >
            {w.apply}
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
  const w = useAdminText("drafts").edit.parts;
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
        setResult({ ok: false, message: w.failed });
      }
    });
  return (
    <div className="flex flex-col gap-3">
      {link && <LinkNotice link={link} onClose={() => setLink(null)} />}
      <div className="flex flex-wrap gap-2">
        {hasEmail && (
          <button type="button" disabled={working} onClick={() => run(() => actions.resend({ email: true }))} className={secondary}>
            {w.sendAgain}
          </button>
        )}
        <button type="button" disabled={working} onClick={() => run(() => actions.resend({ email: false }))} className={secondary}>
          {w.share}
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => {
            if (!window.confirm(w.cancelConfirm)) return;
            run(actions.cancel);
          }}
          className={secondary}
        >
          {w.cancel}
        </button>
      </div>
      <OutsidePaymentForm allowed={mayRecordOutside} disabled={working} amountText={amountText} record={(input) => run(() => actions.paidOutside(input))} />
      <EditOutcome result={result} />
    </div>
  );
}
