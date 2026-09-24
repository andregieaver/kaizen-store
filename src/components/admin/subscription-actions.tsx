"use client";

import { useActionState } from "react";

import {
  changeSubscriptionAction,
  type StaffSubscriptionState,
} from "@/app/admin/(gated)/[store]/subscriptions/actions";
import type { ChangeProblem, SubscriptionChange } from "@/server/subscriptions";

export type StaffChange = { change: SubscriptionChange; periods?: number };

const label = ({ change, periods = 1 }: StaffChange) =>
  ({
    cancel: "Cancel",
    resume: "Keep the subscription",
    cancel_now: "Cancel now",
    pause: `Pause ${periods} deliveries`,
    unpause: "End the pause",
    skip: "Skip next delivery",
  })[change];

const PROBLEMS: Record<ChangeProblem, string> = {
  not_found: "The subscription is no longer running.",
  not_allowed: "That change is not possible right now.",
  invalid: "Check the changes and try again.",
  stripe: "Stripe could not make the change. Try again in a moment.",
};

/** Cancel, keep, pause, skip and end-pause buttons for staff; cancelling now asks first. */
export function SubscriptionActions({
  storeSlug,
  subscriptionId,
  changes,
}: {
  storeSlug: string;
  subscriptionId: string;
  changes: StaffChange[];
}) {
  const [state, action, pending] = useActionState(
    async (_: StaffSubscriptionState, form: FormData): Promise<StaffSubscriptionState> => {
      const [change, periods] = String(form.get("change")).split(":");
      return changeSubscriptionAction(storeSlug, subscriptionId, change as SubscriptionChange, Number(periods ?? 1));
    },
    { failed: false },
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (
          submitter?.value.startsWith("cancel_now") &&
          !window.confirm("End the subscription now? The customer is not charged again and gets no more deliveries.")
        ) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-2"
      aria-busy={pending}
    >
      <div className="flex flex-wrap gap-2">
        {changes.map((c) => (
          <button
            key={`${c.change}:${c.periods ?? 1}`}
            type="submit"
            name="change"
            value={`${c.change}:${c.periods ?? 1}`}
            disabled={pending}
            className="min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-50"
          >
            {label(c)}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {state.failed && state.problem ? PROBLEMS[state.problem] : state.saved && !pending ? "Saved. The customer was emailed." : ""}
      </p>
    </form>
  );
}
