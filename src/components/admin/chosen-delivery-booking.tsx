"use client";

import { useState, useTransition } from "react";

import { ParcelChoice } from "@/components/admin/orders/parcel-choice";
import type { ParcelRow } from "@/components/admin/orders/send-parcel";
import type { ParcelLine } from "@/lib/fulfilment";
import { parcelLinesFromChoice } from "@/lib/parcel-form";

export type BookState = { ok: boolean; message: string };

const input = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/**
 * Books the delivery the customer chose at checkout with its carrier (Porterbuddy D137, Helthjem D138): the parcel's weight,
 * then Book. What was chosen (a window, a service point) is given as text; the booking itself is the carrier's bound action. With `rows`
 * (D174) the booking takes the *In this parcel* choice: the chosen units, or everything still to send when nothing is lowered.
 */
export function ChosenDeliveryBooking({
  carrierName,
  chosenText,
  estimatedGrams,
  test,
  hasEmail,
  book,
  rows = [],
}: {
  carrierName: string;
  /** What the customer chose, written out. */
  chosenText: string;
  estimatedGrams: number;
  test: boolean;
  hasEmail: boolean;
  book: (input: { notify: boolean; parcel: { weightGrams: number }; lines: ParcelLine[] | null }) => Promise<BookState>;
  /** The order's physical lines with what is still to send (D174), for the parcel's choice. */
  rows?: ParcelRow[];
}) {
  const [weight, setWeight] = useState(estimatedGrams > 0 ? (estimatedGrams / 1000).toString().replace(".", ",") : "");
  const [notify, setNotify] = useState(true);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const lines = parcelLinesFromChoice(rows, typed);
  const [result, setResult] = useState<BookState | null>(null);
  const [busy, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (lines === "invalid") return;
      const grams = Math.round(Number(weight.replace(",", ".")) * 1000);
      setResult(await book({ notify: hasEmail && !test && notify, parcel: { weightGrams: grams }, lines }));
    });

  return (
    <div className="flex flex-col gap-3">
      {test && (
        <p role="status" className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Test environment: {carrierName} delivers nothing and the order is not marked as sent.
        </p>
      )}
      <p className="text-sm">
        The customer chose <strong>{chosenText}</strong>.
      </p>
      <ParcelChoice rows={rows} typed={typed} onChange={setTyped} />
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
        <button type="button" onClick={submit} disabled={busy || !weight.trim() || lines === "invalid"} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">
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
