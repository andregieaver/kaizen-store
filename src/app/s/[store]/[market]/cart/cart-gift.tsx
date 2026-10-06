"use client";

import { useId, useRef, useState, useTransition } from "react";

import { t } from "@/lib/i18n";
import {
  GIFT_MESSAGE_LINES,
  GIFT_MESSAGE_MAX,
  GIFT_NAME_MAX,
  cleanGift,
  sameGift,
  shopperTextLength,
  type GiftFields,
  type GiftProblem,
} from "@/lib/gift";

import { setGiftAction } from "./actions";

/**
 * The gift box on the cart (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1): a tick, and when ticked To, From and a message of at most 300 characters and six lines.
 * What is typed is kept on the cart by `setGiftAction()` when a field is left or the tick changes; a text over its limit is refused with how much is over (never cut), and the
 * box says so beside the field. Unticking clears the three fields. Nothing is kept in the browser: no cookie and no storage (the cart's own cookie already exists).
 *
 * This is the cart's own client component, and the cart is a pay route (D158): it imports no zod and no server module (`pay-routes.graph.test.ts`). The checks it makes
 * are `cleanGift()` and `shopperTextLength()` from `@/lib/gift`, the same functions the server runs, so what is counted on the screen is what is refused there.
 */
export function GiftBox({ store, market, lang, initial }: { store: string; market: string; lang: string; initial: GiftFields }) {
  const words = t(lang).gift;
  const saving = t(lang).savingChange;
  const id = useId();
  const [ticked, setTicked] = useState(initial.isGift);
  const [to, setTo] = useState(initial.to ?? "");
  const [from, setFrom] = useState(initial.from ?? "");
  const [message, setMessage] = useState(initial.message ?? "");
  const [problems, setProblems] = useState<GiftProblem[]>([]);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  // What the cart holds, so a field left unchanged sends nothing.
  const kept = useRef<GiftFields>(initial);
  // The last request that was sent, so an old answer never overwrites a newer one.
  const sent = useRef(0);

  const input = (next: Partial<{ isGift: boolean; to: string; from: string; message: string }> = {}) => ({
    isGift: next.isGift ?? ticked,
    to: next.to ?? to,
    from: next.from ?? from,
    message: next.message ?? message,
  });

  const save = (next: Partial<{ isGift: boolean; to: string; from: string; message: string }> = {}) => {
    const wanted = input(next);
    // The same check the server makes: a text over its limit is not sent, and the box says how much is over.
    const cleaned = cleanGift(wanted, true);
    if (!cleaned.ok) {
      setProblems(cleaned.problems);
      return;
    }
    setProblems([]);
    if (sameGift(cleaned.gift, kept.current)) return;
    const turn = ++sent.current;
    startTransition(async () => {
      try {
        const result = await setGiftAction(store, market, wanted);
        if (turn !== sent.current) return;
        if (result.ok) {
          kept.current = result.gift;
          setFailed(false);
        } else {
          setProblems(result.problems);
          setFailed(result.problems.length === 0);
        }
      } catch {
        if (turn === sent.current) setFailed(true);
      }
    });
  };

  // A tick made while the fields hold text keeps the text; an untick clears the fields in the browser as the server clears them.
  const toggle = (checked: boolean) => {
    setTicked(checked);
    if (!checked) {
      setTo("");
      setFrom("");
      setMessage("");
      setProblems([]);
    }
    save({ isGift: checked, ...(checked ? {} : { to: "", from: "", message: "" }) });
  };

  const left = GIFT_MESSAGE_MAX - shopperTextLength(message);
  const problemOf = (field: GiftProblem["field"]) => problems.find((p) => p.field === field);
  const problemText = (problem: GiftProblem | undefined) => {
    if (!problem) return null;
    if (problem.field !== "message") return words.note.nameTooLong(GIFT_NAME_MAX);
    return problem.problem === "too_many_lines" ? words.note.tooManyLines(GIFT_MESSAGE_LINES) : words.note.tooLong(problem.over);
  };

  const field = "min-h-11 w-full rounded-md border border-border bg-background px-3";

  return (
    <div role="group" aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-lg border border-border p-4" data-gift-box>
      <div className="flex items-start gap-3">
        <input
          id={`${id}-tick`}
          type="checkbox"
          checked={ticked}
          onChange={(event) => toggle(event.target.checked)}
          className="mt-0.5 size-5 shrink-0"
        />
        <label id={`${id}-title`} htmlFor={`${id}-tick`} className="font-medium">
          {words.title}
        </label>
      </div>
      {ticked && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-to`} className="text-sm">
                {words.to}
              </label>
              <input
                id={`${id}-to`}
                name="giftTo"
                value={to}
                maxLength={GIFT_NAME_MAX}
                autoComplete="off"
                onChange={(event) => setTo(event.target.value)}
                onBlur={() => save()}
                aria-invalid={problemOf("to") ? true : undefined}
                aria-describedby={problemOf("to") ? `${id}-to-problem` : undefined}
                className={field}
              />
              {problemOf("to") && (
                <p id={`${id}-to-problem`} role="alert" className="text-sm">
                  {problemText(problemOf("to"))}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-from`} className="text-sm">
                {words.from}
              </label>
              <input
                id={`${id}-from`}
                name="giftFrom"
                value={from}
                maxLength={GIFT_NAME_MAX}
                autoComplete="off"
                onChange={(event) => setFrom(event.target.value)}
                onBlur={() => save()}
                aria-invalid={problemOf("from") ? true : undefined}
                aria-describedby={problemOf("from") ? `${id}-from-problem` : undefined}
                className={field}
              />
              {problemOf("from") && (
                <p id={`${id}-from-problem`} role="alert" className="text-sm">
                  {problemText(problemOf("from"))}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-message`} className="text-sm">
              {words.message}
            </label>
            <textarea
              id={`${id}-message`}
              name="giftMessage"
              value={message}
              rows={4}
              maxLength={GIFT_MESSAGE_MAX}
              onChange={(event) => setMessage(event.target.value)}
              onBlur={() => save()}
              aria-invalid={problemOf("message") ? true : undefined}
              aria-describedby={`${id}-counter ${id}-printed${problemOf("message") ? ` ${id}-message-problem` : ""}`}
              className={`${field} py-2`}
            />
            <p id={`${id}-counter`} className="text-sm text-muted" data-gift-counter>
              {words.counter(Math.max(0, left))}
            </p>
            {problemOf("message") && (
              <p id={`${id}-message-problem`} role="alert" className="text-sm">
                {problemText(problemOf("message"))}
              </p>
            )}
          </div>
          {/* What the store does with the words, said plainly: printed on the slip, never sent on. */}
          <p id={`${id}-printed`} className="text-sm text-muted">
            {words.note.printed}
          </p>
        </div>
      )}
      {/* One live region for the answer, so a screen reader hears the save or the failure and not every key. */}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">
        {pending ? saving : failed ? words.note.saveFailed : ""}
      </p>
    </div>
  );
}
