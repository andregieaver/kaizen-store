"use client";

import { useState, useTransition } from "react";

import type { OrderActionState } from "@/app/admin/(gated)/[store]/orders/actions";
import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";

/** *Email again* for one parcel (D174 2.1): the parcel's email (carrier, tracking, contents) sent to the customer once more, with a key of its own. */
export function EmailAgainButton({ send }: { send: () => Promise<OrderActionState> }) {
  const [result, setResult] = useState<OrderActionState | null>(null);
  const [working, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={working}
        onClick={() =>
          start(async () => {
            setResult(await send());
          })
        }
        className="text-sm underline underline-offset-2 disabled:opacity-40"
      >
        {working ? "Sending …" : "Email again"}
      </button>
      {result?.message && (
        <span role="status" aria-live="polite" className={`text-xs ${result.ok ? "text-muted" : "text-red-700 dark:text-red-400"}`}>
          {result.message}
        </span>
      )}
    </span>
  );
}

/**
 * *Undo "sent"* for one parcel (D174 follow-up, `docs/wave-3-fulfilment.md` "Undoing a parcel"): a disclosure that says what happens and what Kaizen does not do (the
 * carrier's booking is not cancelled, the customer is not emailed, a recorded receipt is cleared) before the button, with an optional reason for the history.
 */
export function UndoParcel({ undo, warnings, index }: { undo: (state: FormState, form: FormData) => Promise<FormState>; warnings: string[]; index: number }) {
  return (
    <details className="w-full text-sm">
      <summary className="cursor-pointer underline underline-offset-2">Undo &ldquo;sent&rdquo;</summary>
      <ActionForm action={undo} replaceOnSuccess className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
        <p className="font-medium">Undo &ldquo;sent&rdquo; for parcel {index}?</p>
        <ul className="list-disc pl-5 text-muted">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <label className="flex flex-col gap-1 font-medium">
          <span>
            Reason <span className="font-normal text-muted">(optional, for the history)</span>
          </span>
          <input name="reason" maxLength={200} autoComplete="off" className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal" />
        </label>
        <div>
          <SubmitButton>Undo &ldquo;sent&rdquo;</SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
