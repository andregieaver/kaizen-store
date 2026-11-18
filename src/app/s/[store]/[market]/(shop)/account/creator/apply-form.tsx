"use client";

import { useActionState } from "react";

import type { CreatorFormState } from "./actions";

export type CreatorFormWords = {
  nameLabel: string;
  channelLabel: string;
  channelHint: string;
  consent: string;
  apply: string;
  applied: string;
  problems: Record<NonNullable<CreatorFormState["problem"]>, string>;
};

/**
 * The application (D386): the name a creator is known by, a link to their channel and the consent, ticked by them. What was typed stays in
 * the fields when the server refuses it (uncontrolled fields, no reset on an error).
 */
export function CreatorApplyForm({
  action,
  words,
}: {
  action: (state: CreatorFormState, form: FormData) => Promise<CreatorFormState>;
  words: CreatorFormWords;
}) {
  const [state, formAction, pending] = useActionState(action, { problem: null });
  if (state.done) {
    return (
      <p role="status" className="rounded-lg border border-border bg-surface p-4">
        {words.applied}
      </p>
    );
  }
  return (
    <form action={formAction} aria-busy={pending} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.nameLabel}</span>
        <input name="name" required maxLength={80} autoComplete="nickname" className="min-h-11 rounded-md border border-border bg-background px-3" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{words.channelLabel}</span>
        <input
          name="channel"
          type="url"
          required
          maxLength={300}
          inputMode="url"
          aria-describedby="creator-channel-hint"
          className="min-h-11 rounded-md border border-border bg-background px-3"
        />
        <span id="creator-channel-hint" className="text-sm text-muted">
          {words.channelHint}
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="consent" value="yes" required className="mt-1 size-5 shrink-0" />
        <span>{words.consent}</span>
      </label>
      {state.problem && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {words.problems[state.problem]}
        </p>
      )}
      <div>
        <button type="submit" disabled={pending} className="button-primary rounded-button min-h-11 px-5">
          {words.apply}
        </button>
      </div>
    </form>
  );
}
