"use client";

import { field, hint } from "@/components/admin/data/ui";
import { parcelLinesFromChoice, unitsInChoice } from "@/lib/parcel-form";

import type { ParcelRow } from "./send-parcel";

/**
 * *In this parcel* for a carrier booking (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.1): the lines with units still to send, each with a number that starts at what
 * is left; the booking sends the chosen units (all of them when nothing is lowered, the booking's meaning before parcels named their lines). Controlled: the booking form
 * keeps `typed` and sends `parcelLinesFromChoice(rows, typed)`; the server checks the parcel before the carrier is paid and again under the order's lock. The weight shown
 * by the form is guessed from the whole order, so a parcel holding part of it says to weigh it. English: the admin.
 */
export function ParcelChoice({ rows, typed, onChange }: { rows: ParcelRow[]; typed: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const open = rows.filter((r) => r.toSend > 0);
  if (open.length === 0) return null;
  const chosen = parcelLinesFromChoice(open, typed);
  const left = unitsInChoice(open, null);
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1 font-medium">In this parcel</legend>
      <ul className="flex flex-col gap-1">
        {open.map((row) => (
          <li key={row.lineId} className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              {row.title}
              {row.sku && <span className="font-mono text-xs text-muted"> {row.sku}</span>}
              <span className="text-xs text-muted"> · {row.toSend} to send</span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={row.toSend}
              step={1}
              value={typed[row.lineId] ?? String(row.toSend)}
              onChange={(e) => onChange({ ...typed, [row.lineId]: e.target.value })}
              aria-label={`In this parcel: ${row.title}`}
              className={`${field} w-20 text-right tabular-nums`}
            />
          </li>
        ))}
      </ul>
      {chosen === "invalid" ? (
        <p role="alert" className="text-red-700 dark:text-red-400">
          A number is not a whole number from 0 to what is left of its item.
        </p>
      ) : chosen === null ? (
        <p className={hint}>
          Everything still to send ({left} {left === 1 ? "unit" : "units"}). Lower a number to book part of it now.
        </p>
      ) : (
        <p className={hint}>
          {unitsInChoice(open, chosen)} of {left} units in this parcel; the rest stays to send. The weight is guessed from the whole order: weigh this parcel.
        </p>
      )}
    </fieldset>
  );
}
