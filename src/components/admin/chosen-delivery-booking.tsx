"use client";

import { useState, useTransition } from "react";

import { ParcelChoice } from "@/components/admin/orders/parcel-choice";
import type { ParcelRow } from "@/components/admin/orders/send-parcel";
import type { ParcelLine } from "@/lib/fulfilment";
import { parcelLinesFromChoice } from "@/lib/parcel-form";
import { NotifySwitchedOff } from "@/components/admin/orders/notify-off";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

export type BookState = { ok: boolean; message: string };

const input = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * Books the delivery the customer chose at checkout with its carrier (Porterbuddy D137, Helthjem D138, Instabox, UPS and DHL D458): the parcel's
 * weight, then Book. What was chosen (a window, a service point) is given as text; the booking itself is the carrier's bound action. With `rows`
 * (D174) the booking takes the *In this parcel* choice: the chosen units, or everything still to send when nothing is lowered. With `services`
 * (UPS and DHL, for an order whose customer chose none of theirs) staff choose the service instead, and `chosenText` is not shown.
 */
export function ChosenDeliveryBooking({
  carrierName,
  chosenText,
  estimatedGrams,
  test,
  hasEmail,
  book,
  rows = [],
  notifyOff = null,
  basis = null,
  services,
  serviceLabel,
  collectLabel = null,
}: {
  /** The *Order sent* email is switched off in Notifications (D238): no email is offered, and the box says so. */
  notifyOff?: string | null;
  /** The order's fulfilment as this page shows it (`OrderFulfilment.basis`, D372): a press made before the page showed the last parcel is refused. */
  basis?: string | null;
  carrierName: string;
  /** What the customer chose, written out; null when staff choose from `services`. */
  chosenText: string | null;
  /** The services staff may choose from when the customer chose none of this carrier's, with the word for the choice. */
  services?: { id: string; name: string }[];
  serviceLabel?: string;
  /** The words for asking the carrier to collect the parcel (D459), when it can and the store gave its hours; ticked unless staff untick it. */
  collectLabel?: string | null;
  estimatedGrams: number;
  test: boolean;
  hasEmail: boolean;
  book: (input: { notify: boolean; parcel: { weightGrams: number }; lines: ParcelLine[] | null; seen: string | null; serviceId?: string; collect?: boolean }) => Promise<BookState>;
  /** The order's physical lines with what is still to send (D174), for the parcel's choice. */
  rows?: ParcelRow[];
}) {
  const w = useAdminText("order").booking;
  const [serviceId, setServiceId] = useState(services?.[0]?.id ?? "");
  const [weight, setWeight] = useState(estimatedGrams > 0 ? (estimatedGrams / 1000).toString().replace(".", ",") : "");
  const [notify, setNotify] = useState(true);
  const [collect, setCollect] = useState(true);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const lines = parcelLinesFromChoice(rows, typed);
  const [result, setResult] = useState<BookState | null>(null);
  const [busy, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (lines === "invalid") return;
      const grams = Math.round(Number(weight.replace(",", ".")) * 1000);
      setResult(await book({ notify: hasEmail && !test && !notifyOff && notify, parcel: { weightGrams: grams }, lines, seen: basis, ...(services ? { serviceId } : {}), ...(collectLabel ? { collect } : {}) }));
    });

  return (
    <div className="flex flex-col gap-3">
      {test && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-text">
          {fillWords(w.testCarrier, { carrier: carrierName })}
        </p>
      )}
      {chosenText !== null && (
        <p className="text-sm">
          {w.customerChose} <strong>{chosenText}</strong>.
        </p>
      )}
      {services && (
        <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
          {serviceLabel}
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={input}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ParcelChoice rows={rows} typed={typed} onChange={setTyped} />
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        {w.weight}
        <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={input} />
      </label>
      {estimatedGrams === 0 && <p className="text-sm text-muted">{w.noWeight}</p>}
      {collectLabel && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} className="size-4" />
          {collectLabel}
        </label>
      )}
      {hasEmail && !test && !notifyOff && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4" />
          {w.email}
        </label>
      )}
      {hasEmail && !test && notifyOff && <NotifySwitchedOff href={notifyOff}>{w.email}</NotifySwitchedOff>}
      <div>
        <button type="button" onClick={submit} disabled={busy || !weight.trim() || lines === "invalid"} className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50">
          {busy ? w.booking : test ? w.testBook : w.book}
        </button>
      </div>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "" : "text-danger-text "}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
