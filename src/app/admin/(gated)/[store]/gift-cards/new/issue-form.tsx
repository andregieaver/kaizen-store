"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button, ButtonLink } from "@/components/admin/ui";
import { giftCardsEn, type GiftCardsMessages } from "@/lib/admin-messages/gift-cards.en";

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
  words: w = giftCardsEn.issue,
}: {
  action: (state: IssueState, form: FormData) => Promise<IssueState>;
  currencies: string[];
  languages: { code: string; label: string }[];
  base: string;
  /** The `giftCards` catalogue's `issue` words in the account's language (D312 A5). */
  words?: GiftCardsMessages["issue"];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [copied, setCopied] = useState(false);

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-body text-ink">{w.issued}</p>
        <p className="rounded-panel border border-line bg-sunken p-4 font-mono text-display tracking-wider text-ink" data-gift-code>
          {state.code}
        </p>
        <p className="text-body text-ink-2">
          {state.emailed === "sent"
            ? w.emailed
            : state.emailed === "failed"
              ? w.emailFailed
              : w.passOn}
          {w.onlyTime}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(state.code).then(() => setCopied(true));
            }}
          >
            {copied ? w.copied : w.copy}
          </Button>
          <ButtonLink href={`${base}/${state.cardId}`}>{w.openCard}</ButtonLink>
          <Link href={base} className="self-center text-body text-ink-2 underline-offset-2 hover:underline">
            {w.allCards}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} aria-busy={pending} className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-body">
          <span className="text-caption text-muted">{w.amount}</span>
          <input name="amount" inputMode="decimal" required autoComplete="off" placeholder="500" className="min-h-10 rounded-md border border-line px-3" />
        </label>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">{w.currency}</span>
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
        <legend className="mb-1 text-body-strong text-ink">{w.forWhom}</legend>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">{w.email}</span>
          <input name="email" type="email" maxLength={254} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
        </label>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">{w.name}</span>
          <input name="name" maxLength={80} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
        </label>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-caption text-muted">{w.message}</span>
          <textarea name="message" maxLength={500} rows={3} className="rounded-md border border-line px-3 py-2" />
        </label>
        {languages.length > 1 && (
          <label className="flex flex-col gap-1 text-body">
            <span className="text-caption text-muted">{w.language}</span>
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
        <span className="text-caption text-muted">{w.note}</span>
        <input name="note" maxLength={500} autoComplete="off" placeholder={w.notePlaceholder} className="min-h-10 rounded-md border border-line px-3" />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-body text-danger-text">
          {state.message}
        </p>
      )}
      <div>
        <Button type="submit" kind="main" disabled={pending}>
          {w.submit}
        </Button>
      </div>
    </form>
  );
}
