"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button, ButtonLink } from "@/components/admin/ui";

import type { IssueState } from "../actions";

/**
 * Issuing a gift card by hand (D300 F4): an amount, a currency the store sells in, and optionally who it is for. Once issued the code is
 * shown here, once: it is kept nowhere, so the person copies it or it went by email.
 */
export function IssueGiftCardForm({
  action,
  currencies,
  languages,
  base,
}: {
  action: (state: IssueState, form: FormData) => Promise<IssueState>;
  currencies: string[];
  languages: { code: string; label: string }[];
  base: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [copied, setCopied] = useState(false);

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-body text-ink">The gift card is issued. Its code:</p>
        <p className="rounded-panel border border-line bg-sunken p-4 font-mono text-display tracking-wider text-ink" data-gift-code>
          {state.code}
        </p>
        <p className="text-body text-ink-2">
          {state.emailed === "sent"
            ? "It was emailed to the person it is for. "
            : state.emailed === "failed"
              ? "The email did not go: pass the code on yourself. "
              : "Pass the code on to the person it is for. "}
          This is the only time the code is shown: Kaizena Flow keeps it nowhere.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(state.code).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy the code"}
          </Button>
          <ButtonLink href={`${base}/${state.cardId}`}>Open the card</ButtonLink>
          <Link href={base} className="self-center text-body text-ink-2 underline-offset-2 hover:underline">
            All gift cards
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} aria-busy={pending} className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-body">
          <span className="text-caption text-muted">Amount</span>
          <input name="amount" inputMode="decimal" required autoComplete="off" placeholder="500" className="min-h-10 rounded-md border border-line px-3" />
        </label>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">Currency</span>
          <select name="currency" defaultValue={currencies[0]} className="min-h-10 rounded-md border border-line px-3">
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-body-strong text-ink">Who it is for (optional)</legend>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">Their email: the code is sent there</span>
          <input name="email" type="email" maxLength={254} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
        </label>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">Their name</span>
          <input name="name" maxLength={80} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
        </label>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">A message in the email</span>
          <textarea name="message" maxLength={500} rows={3} className="rounded-md border border-line px-3 py-2" />
        </label>
        {languages.length > 1 && (
          <label className="flex flex-col gap-1 text-body">
            <span className="text-caption text-muted">Language of the email</span>
            <select name="lang" defaultValue={languages[0].code} className="min-h-10 rounded-md border border-line px-3">
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      <label className="flex flex-col gap-1 text-body">
        <span className="text-caption text-muted">Why it is issued (for your own records, not shown to them)</span>
        <input name="note" maxLength={500} autoComplete="off" placeholder="A make-good for order 1042" className="min-h-10 rounded-md border border-line px-3" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-body text-danger-text">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" kind="main" disabled={pending}>
          Issue the gift card
        </Button>
      </div>
    </form>
  );
}
