"use client";

import { useActionState } from "react";

import { REVIEW_BODY_MAX, REVIEW_NAME_MAX, REVIEW_TITLE_MAX } from "@/lib/review-status";

import type { ReviewFormState } from "./actions";

/** The words the form draws, in the market's language, given by the page (D301). */
export type ReviewFormWords = {
  rating: string;
  stars: string[];
  titleLabel: string;
  bodyLabel: string;
  nameLabel: string;
  nameHint: string;
  submit: string;
  problems: Record<NonNullable<ReviewFormState["problem"]>, string>;
};

/**
 * A buyer's review (D301 9.3): stars as a radio group (required), a title, the text and the name to show. The words typed stay in the fields when
 * the server refuses them (the fields are uncontrolled and the form is not reset on an error).
 */
export function ReviewForm({
  action,
  words,
  initial,
}: {
  action: (state: ReviewFormState, form: FormData) => Promise<ReviewFormState>;
  words: ReviewFormWords;
  initial: { rating: number | null; title: string; body: string; name: string };
}) {
  const [state, formAction, pending] = useActionState(action, { problem: null });
  return (
    <form action={formAction} aria-busy={pending} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{words.rating}</legend>
        <div className="flex flex-row-reverse justify-end gap-1">
          {[5, 4, 3, 2, 1].map((n) => (
            <label key={n} className="kz-star-choice cursor-pointer">
              <input type="radio" name="rating" value={n} defaultChecked={initial.rating === n} required className="peer sr-only" />
              <span aria-hidden="true" className="block text-3xl leading-none text-muted peer-focus-visible:outline peer-focus-visible:outline-2">
                ★
              </span>
              <span className="sr-only">{words.stars[n - 1]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.titleLabel}</span>
        <input name="title" defaultValue={initial.title} maxLength={REVIEW_TITLE_MAX} className="min-h-11 rounded-lg border border-border px-3" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.bodyLabel}</span>
        <textarea name="body" defaultValue={initial.body} maxLength={REVIEW_BODY_MAX} rows={6} className="rounded-lg border border-border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.nameLabel}</span>
        <input name="name" defaultValue={initial.name} required maxLength={REVIEW_NAME_MAX} autoComplete="off" className="min-h-11 rounded-lg border border-border px-3" />
        <span className="text-sm text-muted">{words.nameHint}</span>
      </label>
      {state.problem && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {words.problems[state.problem]}
        </p>
      )}
      <button type="submit" disabled={pending} className="min-h-11 self-start button-primary px-5 font-medium">
        {words.submit}
      </button>
    </form>
  );
}
