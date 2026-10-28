"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/admin/ui";
import { giftCardsEn, type GiftCardsMessages } from "@/lib/admin-messages/gift-cards.en";

import type { NewCodeState } from "../actions";

/**
 * A new code for a delivered card (wave 11 unit B2, D381): the old one stops working at once. The new code is shown here once, as when a card
 * is issued by hand, and was emailed to the address the card went to when there is one.
 */
export function NewCodeForm({
  action,
  words: w = giftCardsEn.card,
}: {
  action: (state: NewCodeState, form: FormData) => Promise<NewCodeState>;
  words?: GiftCardsMessages["card"];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [copied, setCopied] = useState(false);

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-3" role="status">
        <p className="rounded-panel border border-line bg-sunken p-4 font-mono text-display tracking-wider text-ink" data-gift-code>
          {state.code}
        </p>
        <p className="text-body text-ink-2">
          {state.emailed === "sent" ? w.newCodeEmailed : state.emailed === "failed" ? w.newCodeEmailFailed : w.newCodePassOn}
          {w.newCodeOnlyTime}
        </p>
        <div>
          <Button type="button" onClick={() => void navigator.clipboard?.writeText(state.code).then(() => setCopied(true))}>
            {copied ? w.copied : w.copy}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} aria-busy={pending} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-body">
        <input type="checkbox" name="sure" required />
        <span>{w.newCodeSure}</span>
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-body text-danger-text">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" kind="secondary" disabled={pending}>
          {w.newCodeButton}
        </Button>
      </div>
    </form>
  );
}
