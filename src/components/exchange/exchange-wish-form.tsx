"use client";

import { useActionState, useId, useState } from "react";

import type { WishState } from "@/app/s/[store]/[market]/returns/[token]/actions";
import { sendExchangeWishAction } from "@/app/s/[store]/[market]/returns/[token]/actions";
import { browserText } from "@/lib/browser-text";
import { cleanExchangeWish, EXCHANGE_WISH_LINES, EXCHANGE_WISH_NOTE_MAX } from "@/lib/exchange-input-browser";

import { markStepChange } from "./step-focus";

/**
 * The exchange wish on a return's status page (wave 3, D239, `docs/wave-3-exchanges.md` 2.1): *Would you like something else instead of your money back?*,
 * one labelled text field (plain text, at most `EXCHANGE_WISH_NOTE_MAX` characters) and *Ask for an exchange*. Shown only after the withdrawal's two steps, on
 * the status page, so it never burdens the withdrawal function. The field is checked here with the same function the server uses (`cleanExchangeWish()`, no
 * zod in a visitor's bundle) and a problem is announced; once sent, the page is drawn afresh and says so. Nothing is stored in the browser.
 */
export function ExchangeWishForm({ store, market, token, lang }: { store: string; market: string; token: string; lang: string }) {
  const w = browserText(lang).exchangeWish;
  const id = useId();
  const [note, setNote] = useState("");
  const [local, setLocal] = useState<WishState["problem"]>(null);
  const [state, action, pending] = useActionState((previous: WishState, form: FormData) => {
    markStepChange();
    return sendExchangeWishAction(store, market, token, previous, form);
  }, { sent: false, problem: null });
  const problem = local ?? state.problem;
  const words =
    problem === "empty"
      ? w.empty
      : problem === "too_long"
        ? w.tooLong(Math.max(1, note.length - EXCHANGE_WISH_NOTE_MAX))
        : problem === "too_many_lines"
          ? w.tooManyLines(EXCHANGE_WISH_LINES)
          : problem === "failed"
            ? w.failed
            : null;
  const left = EXCHANGE_WISH_NOTE_MAX - note.length;
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3 rounded-lg border border-border p-4" data-exchange-wish>
      <h2 id={`${id}-heading`} className="font-medium">
        {w.heading}
      </h2>
      <form
        action={action}
        aria-busy={pending}
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          const checked = cleanExchangeWish(note);
          if (!checked.ok) {
            event.preventDefault();
            setLocal(checked.problem);
            return;
          }
          setLocal(null);
        }}
      >
        <label htmlFor={`${id}-note`} className="text-sm font-medium">
          {w.label}
        </label>
        <p id={`${id}-hint`} className="text-sm text-muted">
          {w.hint}
        </p>
        <textarea
          id={`${id}-note`}
          name="note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby={`${id}-hint ${id}-count${words ? ` ${id}-error` : ""}`}
          aria-invalid={words ? true : undefined}
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        />
        <p id={`${id}-count`} className="text-sm text-muted">
          {left >= 0 ? w.counter(left) : w.tooLong(-left)}
        </p>
        {words && (
          <p id={`${id}-error`} role="alert" className="text-sm">
            {words}
          </p>
        )}
        <div>
          <button type="submit" disabled={pending} className="min-h-11 rounded-button border border-border px-5 disabled:opacity-40">
            {pending ? w.working : w.button}
          </button>
        </div>
      </form>
    </section>
  );
}
