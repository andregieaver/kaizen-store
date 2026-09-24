"use client";

import { useActionState } from "react";

import {
  changeSubscriptionAction,
  type StaffSubscriptionState,
} from "@/app/admin/(gated)/[store]/subscriptions/actions";
import type { SubscriptionChange } from "@/server/subscriptions";

const LABELS: Record<SubscriptionChange, string> = {
  cancel: "Cancel at period end",
  resume: "Keep the subscription",
  cancel_now: "Cancel now",
};

/** Cancel or resume buttons for staff; cancelling now asks first. */
export function SubscriptionActions({
  storeSlug,
  subscriptionId,
  changes,
}: {
  storeSlug: string;
  subscriptionId: string;
  changes: SubscriptionChange[];
}) {
  const [state, action, pending] = useActionState(
    async (_: StaffSubscriptionState, form: FormData): Promise<StaffSubscriptionState> =>
      changeSubscriptionAction(storeSlug, subscriptionId, form.get("change") as SubscriptionChange),
    { failed: false },
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (
          submitter?.value === "cancel_now" &&
          !window.confirm("End the subscription now? The customer is not charged again and gets no more deliveries.")
        ) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-2"
      aria-busy={pending}
    >
      <div className="flex flex-wrap gap-2">
        {changes.map((change) => (
          <button
            key={change}
            type="submit"
            name="change"
            value={change}
            disabled={pending}
            className="min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-50"
          >
            {LABELS[change]}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {state.failed && "Stripe could not make the change. Try again in a moment."}
      </p>
    </form>
  );
}
