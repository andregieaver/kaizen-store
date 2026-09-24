"use client";

import { useActionState } from "react";

import {
  changeMySubscription,
  type SubscriptionActionState,
} from "@/app/s/[store]/[market]/subscription/[token]/actions";

/** Cancels a subscription at the end of its period, or keeps it after all. */
export function SubscriptionButton({
  store,
  market,
  token,
  change,
  labels,
}: {
  store: string;
  market: string;
  token: string;
  change: "cancel" | "resume";
  labels: { action: string; busy: string; failed: string };
}) {
  const [state, action, pending] = useActionState(
    async (): Promise<SubscriptionActionState> => changeMySubscription(store, market, token, change),
    { failed: false },
  );
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={pending}
        className={
          change === "cancel"
            ? "min-h-11 rounded-full border border-foreground px-5 font-medium disabled:opacity-40"
            : "min-h-11 rounded-full bg-foreground px-5 font-medium text-background disabled:opacity-40"
        }
      >
        {pending ? labels.busy : labels.action}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {state.failed && labels.failed}
      </p>
    </form>
  );
}
