"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { ADJUST_NOTE_MAX, adjustmentQuestion, moneyIn, readAdjustment } from "@/lib/bonus-admin";
import type { BonusResult } from "@/lib/bonus";

const control =
  "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700 dark:aria-invalid:border-red-400";
const errorText = "text-sm text-red-700 dark:text-red-400";

/**
 * Adds credits to a customer, or takes some away, with a reason that stays in their history (D130). Two steps: what
 * and why, then a question to confirm; the answer is shown in place. The server keeps the balance from going below
 * zero and says so if an amount would.
 */
export function BonusAdjustForm({
  adjust,
  currency,
  locale,
  who,
  availableMinor,
}: {
  adjust: (amountMinor: number, note: string) => Promise<BonusResult>;
  currency: string;
  locale: string;
  /** Who the credits are for, as the question names them. */
  who: string;
  availableMinor: number;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; note?: string }>({});
  const [confirming, setConfirming] = useState<{ amountMinor: number; note: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const question = useRef<HTMLParagraphElement>(null);
  const money = moneyIn(currency, locale);

  useEffect(() => {
    if (confirming) question.current?.focus();
  }, [confirming]);

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(null);
    setProblems([]);
    const read = readAdjustment(amount, note, currency);
    if (!read.ok) {
      setErrors({ [read.field]: read.problem });
      window.setTimeout(() => document.getElementById(`bonus-adjust-${read.field}`)?.focus(), 0);
      return;
    }
    setErrors({});
    setConfirming({ amountMinor: read.amountMinor, note: read.note });
  }

  function confirm() {
    if (!confirming) return;
    const { amountMinor, note: reason } = confirming;
    startTransition(async () => {
      const result = await adjust(amountMinor, reason);
      setConfirming(null);
      if (!result.ok) {
        setProblems(result.problems);
        return;
      }
      setDone(
        amountMinor > 0
          ? `Added ${money(amountMinor)} in credits. It is in their history with your reason.`
          : `Took ${money(-amountMinor)} in credits. It is in their history with your reason.`,
      );
      setAmount("");
      setNote("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm" aria-busy={pending}>
          <p ref={question} tabIndex={-1} className="font-medium outline-none">
            {adjustmentQuestion(confirming.amountMinor, who, money)}
          </p>
          <p>
            Reason: <span className="whitespace-pre-wrap">{confirming.note}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
            >
              {pending ? "Working …" : confirming.amountMinor > 0 ? "Yes, add the credits" : "Yes, take the credits"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={pending}
              className="min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-40"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={review} noValidate className="flex flex-col gap-3 text-sm">
          <div className="flex max-w-xs flex-col gap-1">
            <label htmlFor="bonus-adjust-amount" className="font-medium">
              Amount
              <span className="sr-only"> ({currency})</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="bonus-adjust-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={
                  errors.amount ? "bonus-adjust-amount-error bonus-adjust-amount-hint" : "bonus-adjust-amount-hint"
                }
                className={`${control} w-32`}
              />
              <span aria-hidden="true" className="text-muted">
                {currency}
              </span>
            </div>
            {errors.amount && (
              <p id="bonus-adjust-amount-error" className={errorText}>
                {errors.amount}
              </p>
            )}
            <p id="bonus-adjust-amount-hint" className="text-muted">
              Write 50 to add credits, which can be used at once, or -20 to take some away, available credits first and
              then those still waiting. Available now: {money(availableMinor)}. Credits cannot go below zero.
            </p>
          </div>
          <div className="flex max-w-xl flex-col gap-1">
            <label htmlFor="bonus-adjust-note" className="font-medium">
              Reason
            </label>
            <textarea
              id="bonus-adjust-note"
              rows={2}
              maxLength={ADJUST_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={
                errors.note ? "bonus-adjust-note-error bonus-adjust-note-hint" : "bonus-adjust-note-hint"
              }
              className={`${control} py-2`}
            />
            {errors.note && (
              <p id="bonus-adjust-note-error" className={errorText}>
                {errors.note}
              </p>
            )}
            <p id="bonus-adjust-note-hint" className="text-muted">
              Required. It stays in the customer&apos;s history, and staff see it.
            </p>
          </div>
          <div>
            <button type="submit" className="min-h-10 rounded-md border border-border bg-background px-4 text-sm">
              Review
            </button>
          </div>
        </form>
      )}
      <div role="alert" className={errorText}>
        {problems.length > 0 && (
          <ul className="list-disc pl-5">
            {problems.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
      <div role="status" aria-live="polite" className="text-sm">
        {done && <p>{done}</p>}
      </div>
    </div>
  );
}
