"use client";

import { useState, useTransition } from "react";

import { porterbuddyBookAction, type PorterbuddyBookState } from "@/app/admin/(gated)/[store]/orders/porterbuddy-actions";

const input = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/**
 * Books the delivery window the customer chose at checkout with Porterbuddy (D137): the parcel's weight, then Book. The
 * window is asked for again just before it is booked, and nothing is booked if Porterbuddy no longer offers it.
 */
export function PorterbuddyBooking({
  storeSlug,
  orderId,
  windowText,
  estimatedGrams,
  test,
  hasEmail,
}: {
  storeSlug: string;
  orderId: string;
  /** The window the customer chose, written out. */
  windowText: string;
  estimatedGrams: number;
  test: boolean;
  hasEmail: boolean;
}) {
  const [weight, setWeight] = useState(estimatedGrams > 0 ? (estimatedGrams / 1000).toString().replace(".", ",") : "");
  const [notify, setNotify] = useState(true);
  const [result, setResult] = useState<PorterbuddyBookState | null>(null);
  const [busy, start] = useTransition();

  const book = () =>
    start(async () => {
      const grams = Math.round(Number(weight.replace(",", ".")) * 1000);
      setResult(await porterbuddyBookAction(storeSlug, orderId, { notify: hasEmail && !test && notify, parcel: { weightGrams: grams } }));
    });

  return (
    <div className="flex flex-col gap-3">
      {test && (
        <p role="status" className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Test environment: Porterbuddy delivers nothing and the order is not marked as sent.
        </p>
      )}
      <p className="text-sm">
        The customer chose delivery <strong>{windowText}</strong>.
      </p>
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Weight (kg)
        <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={input} />
      </label>
      {estimatedGrams === 0 && <p className="text-sm text-muted">No weight is set on these products, so enter the parcel&apos;s weight.</p>}
      {hasEmail && !test && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4" />
          Email the customer that it is on its way
        </label>
      )}
      <div>
        <button type="button" onClick={book} disabled={busy || !weight.trim()} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">
          {busy ? "Booking …" : test ? "Make a test booking" : "Book and mark as sent"}
        </button>
      </div>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "" : "text-red-700 dark:text-red-400"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
