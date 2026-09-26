"use client";

import { useActionState } from "react";

import {
  changeMySubscription,
  type SubscriptionActionState,
} from "@/app/s/[store]/[market]/subscription/[token]/actions";

/**
 * One change to a subscription (D25, D29): cancel or keep it, pause for
 * some deliveries, skip the next or end a pause.
 */
export function SubscriptionButton({
  store,
  market,
  token,
  change,
  periods = 1,
  primary = false,
  labels,
}: {
  store: string;
  market: string;
  token: string;
  change: "cancel" | "resume" | "pause" | "unpause" | "skip";
  periods?: number;
  primary?: boolean;
  labels: { action: string; busy: string; failed: string };
}) {
  const [state, action, pending] = useActionState(
    async (): Promise<SubscriptionActionState> => changeMySubscription(store, market, token, change, periods),
    { failed: false },
  );
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={pending}
        className={
          primary
            ? "min-h-11 button-primary px-5 font-medium disabled:opacity-40"
            : "min-h-11 rounded-button border border-foreground px-5 font-medium disabled:opacity-40"
        }
      >
        {pending ? labels.busy : labels.action}
      </button>
      {state.failed && (
        <p role="alert" className="text-sm">
          {labels.failed}
        </p>
      )}
    </form>
  );
}
