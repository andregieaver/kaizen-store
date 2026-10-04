"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import type { DeleteLabels, StepUpLabels } from "@/lib/privacy-labels";


/**
 * The shopper's two forms in "Your data" (wave 1, 1g, D162): confirming it is them again (a code emailed to the address on file, or the
 * password), and the one button that deletes the account. The server actions come in as props (bound by the page), so the forms can be
 * drawn and tested without a server. Fields are labelled, a step change moves focus to its field, and every result is announced.
 */

export type PrivacyFormState = { step: "start" | "code"; message: string | null; error: boolean };
export const INITIAL_PRIVACY_STATE: PrivacyFormState = { step: "start", message: null, error: false };

export type PrivacyAction = (previous: PrivacyFormState, form: FormData) => Promise<PrivacyFormState>;

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3";
const label = "flex flex-col gap-1 text-sm font-medium";
const secondary = "min-h-11 rounded-button border border-border px-5 disabled:opacity-40";

function Message({ state }: { state: PrivacyFormState }) {
  // An error is announced at once; a note (the code was sent) politely.
  return state.error ? (
    <p role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
      {state.message}
    </p>
  ) : (
    <p role="status" aria-live="polite" className="text-sm empty:hidden">
      {state.message}
    </p>
  );
}

export function StepUpForm({
  labels,
  hasPassword,
  requestCode,
  confirm,
}: {
  labels: StepUpLabels;
  /** Password accounts may confirm with the password instead of a code. */
  hasPassword: boolean;
  requestCode: PrivacyAction;
  confirm: PrivacyAction;
}) {
  const [sent, sendCode, sending] = useActionState(requestCode, INITIAL_PRIVACY_STATE);
  const [confirmed, confirmAction, confirming] = useActionState(confirm, INITIAL_PRIVACY_STATE);
  const codeField = useRef<HTMLInputElement>(null);
  // The step changed: the code field is where the shopper goes next.
  useEffect(() => {
    if (sent.step === "code" && !sent.error) codeField.current?.focus();
  }, [sent]);

  return (
    <section aria-labelledby="step-up-heading" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 id="step-up-heading" className="text-xl font-heading">
          {labels.heading}
        </h2>
        <p className="text-sm text-muted">{labels.text}</p>
      </div>

      <form action={sendCode} className="flex flex-col gap-2">
        <div>
          <button type="submit" disabled={sending} className={secondary}>
            {labels.sendCode}
          </button>
        </div>
        <Message state={sent} />
      </form>

      {sent.step === "code" && (
        <form action={confirmAction} className="flex flex-col gap-3">
          <label className={label}>
            {labels.codeLabel}
            <input
              ref={codeField}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className={input}
            />
          </label>
          <div>
            <button type="submit" disabled={confirming} className={secondary}>
              {labels.confirm}
            </button>
          </div>
        </form>
      )}

      {hasPassword && (
        <form action={confirmAction} className="flex flex-col gap-3">
          <label className={label}>
            {labels.passwordLabel}
            <input name="password" type="password" autoComplete="current-password" required className={input} />
          </label>
          <div>
            <button type="submit" disabled={confirming} className={secondary}>
              {labels.confirm}
            </button>
          </div>
        </form>
      )}
      <Message state={confirmed} />
    </section>
  );
}

export function DeleteForm({ labels, erase, backHref }: { labels: DeleteLabels; erase: PrivacyAction; backHref: string }) {
  const [state, action, pending] = useActionState(erase, INITIAL_PRIVACY_STATE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="font-medium">{labels.irreversible}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-button border border-red-700 px-5 text-red-700 disabled:opacity-40 dark:border-red-400 dark:text-red-400"
        >
          {labels.confirmButton}
        </button>
        <Link href={backHref} className="underline">
          {labels.backLink}
        </Link>
      </div>
      <Message state={state} />
    </form>
  );
}
