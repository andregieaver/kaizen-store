"use client";

import { useState, useTransition } from "react";

import type { OrderActionState } from "@/app/admin/(gated)/[store]/orders/actions";

/** *Email again* for one parcel (D174 2.1): the parcel's email (carrier, tracking, contents) sent to the customer once more, with a key of its own. */
export function EmailAgainButton({ send }: { send: () => Promise<OrderActionState> }) {
  const [result, setResult] = useState<OrderActionState | null>(null);
  const [working, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={working}
        onClick={() =>
          start(async () => {
            setResult(await send());
          })
        }
        className="text-sm underline underline-offset-2 disabled:opacity-40"
      >
        {working ? "Sending …" : "Email again"}
      </button>
      {result?.message && (
        <span role="status" aria-live="polite" className={`text-xs ${result.ok ? "text-muted" : "text-red-700 dark:text-red-400"}`}>
          {result.message}
        </span>
      )}
    </span>
  );
}
