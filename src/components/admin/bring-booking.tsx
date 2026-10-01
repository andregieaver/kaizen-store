"use client";

import { useState, useTransition } from "react";

import { bringBookAction, bringOptionsAction, type BringBookState } from "@/app/admin/(gated)/[store]/orders/bring-actions";
import type { OrderDelivery } from "@/lib/delivery-options";
import type { BringOptions } from "@/server/bring-shipping";

const label = "flex flex-col gap-1 text-sm font-medium";
const input = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

const nok = (minor: number, currency: string) =>
  new Intl.NumberFormat("nb-NO", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);

/**
 * Ships an order with Posten / Bring from its page (D134): the parcel's weight, Bring's services and prices for it, a pickup
 * point where the service needs one, and Book. Prices are what Bring charges the store (excluding VAT).
 */
export function BringBooking({
  storeSlug,
  orderId,
  estimatedGrams,
  test,
  hasEmail,
  chosen: shopperChoice = null,
}: {
  storeSlug: string;
  orderId: string;
  estimatedGrams: number;
  test: boolean;
  hasEmail: boolean;
  /** The service the shopper chose at checkout (D135), used unless the store picks another. */
  chosen?: OrderDelivery | null;
}) {
  const [weight, setWeight] = useState(estimatedGrams > 0 ? (estimatedGrams / 1000).toString().replace(".", ",") : "");
  const [dims, setDims] = useState({ l: "", w: "", h: "" });
  const [options, setOptions] = useState<Extract<BringOptions, { ok: true }> | null>(null);
  const [service, setService] = useState("");
  const [point, setPoint] = useState("");
  const [notify, setNotify] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<BringBookState | null>(null);
  const [busy, start] = useTransition();

  const parcel = () => {
    const grams = Math.round(Number(weight.replace(",", ".")) * 1000);
    const mm = (text: string) => (text.trim() && Number(text.replace(",", ".")) > 0 ? Math.round(Number(text.replace(",", ".")) * 10) : undefined);
    return { weightGrams: grams, lengthMm: mm(dims.l), widthMm: mm(dims.w), heightMm: mm(dims.h) };
  };
  const chosen = options?.options.find((o) => o.serviceId === service);

  const load = () =>
    start(async () => {
      setProblem(null);
      setResult(null);
      const answer = await bringOptionsAction(storeSlug, orderId, parcel());
      if (!answer.ok) {
        setOptions(null);
        setProblem(answer.problem);
        return;
      }
      setOptions(answer);
      // What the shopper chose is selected to begin with, when Bring still offers it.
      const wanted = shopperChoice && answer.options.some((o) => o.serviceId === shopperChoice.serviceId) ? shopperChoice : null;
      setService(wanted?.serviceId ?? answer.options[0]?.serviceId ?? "");
      setPoint(wanted?.pickupPoint?.id ?? answer.pickupPoints[0]?.id ?? "");
    });

  const book = () =>
    start(async () => {
      setProblem(null);
      setResult(await bringBookAction(storeSlug, orderId, { serviceId: service, pickupPointId: chosen?.needsPickupPoint ? point : undefined, notify: hasEmail && notify, parcel: parcel() }));
    });

  return (
    <div className="flex flex-col gap-3">
      {test && (
        <p role="status" className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Test environment: Bring books a test shipment. Nothing is shipped and the order is not marked as sent.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={label}>
          Weight (kg)
          <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={input} />
        </label>
        {(["l", "w", "h"] as const).map((key) => (
          <label key={key} className={label}>
            <span>
              {key === "l" ? "Length" : key === "w" ? "Width" : "Height"} (cm) <span className="font-normal text-muted">optional</span>
            </span>
            <input inputMode="decimal" value={dims[key]} onChange={(e) => setDims({ ...dims, [key]: e.target.value })} className={input} />
          </label>
        ))}
      </div>
      {shopperChoice && (
        <p className="text-sm">
          The shopper chose <strong>{shopperChoice.label}</strong>
          {shopperChoice.pickupPoint && <> with pickup at {shopperChoice.pickupPoint.name}, {shopperChoice.pickupPoint.street}, {shopperChoice.pickupPoint.city}</>}.
        </p>
      )}
      {estimatedGrams === 0 && <p className="text-sm text-muted">No weight is set on these products, so enter the parcel&apos;s weight.</p>}
      <div>
        <button type="button" onClick={load} disabled={busy || !weight.trim()} className="min-h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-surface disabled:opacity-50">
          {busy && !options ? "Asking Bring …" : options ? "Update services" : "Show Bring's services"}
        </button>
      </div>
      {options && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Service</legend>
          {options.options.map((o) => (
            <label key={o.serviceId} className="flex items-start gap-2 text-sm">
              <input type="radio" name="service" value={o.serviceId} checked={service === o.serviceId} onChange={() => setService(o.serviceId)} className="mt-1 size-4" />
              <span>
                {o.name} · {nok(o.priceMinor, o.currency)} excl. VAT
                {o.estimate && "minDays" in o.estimate && <span className="text-muted"> · {o.estimate.minDays === 1 ? "1 working day" : `${o.estimate.minDays} working days`}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {options && chosen?.needsPickupPoint && (
        <label className={label}>
          Pickup point
          {options.pickupPoints.length === 0 ? (
            <span className="font-normal text-muted">Bring found no pickup point near the recipient. Choose another service.</span>
          ) : (
            <select value={point} onChange={(e) => setPoint(e.target.value)} className={input}>
              {shopperChoice?.pickupPoint && !options.pickupPoints.some((p) => p.id === shopperChoice.pickupPoint!.id) && (
                <option value={shopperChoice.pickupPoint.id}>
                  {shopperChoice.pickupPoint.name}, {shopperChoice.pickupPoint.street}, {shopperChoice.pickupPoint.city} (chosen by the shopper)
                </option>
              )}
              {options.pickupPoints.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}, {p.address.street}, {p.address.city}
                  {p.distanceMeters !== undefined ? ` (${(p.distanceMeters / 1000).toFixed(1).replace(".", ",")} km)` : ""}
                </option>
              ))}
            </select>
          )}
        </label>
      )}
      {options && hasEmail && !test && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4" />
          Email the customer that it is on its way
        </label>
      )}
      {options && (
        <div>
          <button
            type="button"
            onClick={book}
            disabled={busy || !service || (chosen?.needsPickupPoint && !point)}
            className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          >
            {busy ? "Booking …" : test ? "Make a test booking" : "Book and mark as sent"}
          </button>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "" : "text-red-700 dark:text-red-400"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
