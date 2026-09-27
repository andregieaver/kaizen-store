"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type ReactNode } from "react";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/cart/actions";
import { rangeDatesAction } from "@/app/s/[store]/[market]/p/actions";
import { rangeCount, rangeOpen, type RangeCalendar, type RangeKind } from "@/lib/booking-ranges";
import { addDays, zonedTime } from "@/lib/booking-slots";

import type { AddToCartLabels } from "./add-to-cart";
import { useOpenCartAfterAdd } from "./cart-drawer";

export type RangePickerLabels = AddToCartLabels & {
  chooseDates: string;
  pickStart: string;
  pickEnd: string;
  start: string;
  end: string;
  earlier: string;
  later: string;
  taken: string;
  free: string;
  full: string;
  clear: string;
  loading: string;
  option: string;
  /** "1 night" and "# nights" (or days), `#` standing for the number. */
  lengthOne: string;
  lengthMany: string;
  tooShort: string;
  tooLong: string;
};

const initialState: AddToCartState = { outcome: "idle", quantity: 0 };

/**
 * Choosing a stay's nights or a rental's days (D67): four weeks of dates,
 * the first and the last, then into the cart as that many nights or days
 * from check-in. The server says which dates are free and checks the whole
 * range again; checkout holds it.
 */
export function RangePicker({
  store,
  market,
  cartHref,
  productId,
  kind,
  variants,
  initial,
  checkInTime,
  timeZone,
  minNights,
  maxNights,
  openCart = false,
  labels,
}: {
  store: string;
  market: string;
  cartHref: string;
  productId: string;
  kind: RangeKind;
  variants: { id: string; label: string; price: ReactNode }[];
  initial: RangeCalendar;
  checkInTime: string;
  timeZone: string;
  minNights: number;
  maxNights: number;
  openCart?: boolean;
  labels: RangePickerLabels;
}) {
  const [calendar, setCalendar] = useState(initial);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [loading, startLoading] = useTransition();
  const stay = kind === "stay";

  async function fetchDates(from: string | null) {
    const next = await rangeDatesAction(store, market, { productId, from });
    if (next) setCalendar(next);
  }
  const load = (from: string) => startLoading(() => fetchDates(from));

  const [state, action, pending] = useActionState(async (previous: AddToCartState, form: FormData) => {
    const result = await addToCart(previous, form);
    // Taken meanwhile: show the dates as they are now, and choose again.
    if (result.outcome === "slot_taken") {
      await fetchDates(calendar.from);
      setStart(null);
      setEnd(null);
    }
    return result;
  }, initialState);
  useOpenCartAfterAdd(openCart, cartHref, state);

  const count = start && end ? rangeCount(kind, start, end) : 0;
  const lengthProblem = count > 0 && count < minNights ? labels.tooShort : count > maxNights ? labels.tooLong : null;

  function choose(date: string) {
    // A date that cannot end this range starts a new one.
    if (!start || end || date < start || (stay && date === start) || !rangeOpen(kind, start, date, calendar.dates)) {
      setStart(date);
      setEnd(null);
      return;
    }
    setEnd(date);
  }

  /** Whether a date can be chosen now: a free first night or day, or an end the whole range fits (else it starts anew). */
  function selectable(d: { date: string; open: boolean }): boolean {
    if (d.date < calendar.today) return false;
    if (!start || end || d.date < start) return d.open;
    if (stay && d.date === start) return true;
    return rangeOpen(kind, start, d.date, calendar.dates) || d.open;
  }

  const inRange = (date: string) => Boolean(start && end && date >= start && date <= end);
  const message =
    state.outcome === "added" || state.outcome === "capped"
      ? labels.added
      : state.outcome === "slot_taken"
        ? labels.taken
        : state.outcome === "unavailable"
          ? labels.unavailable
          : state.outcome === "error"
            ? labels.tryAgain
            : null;
  const prompt = !start ? labels.pickStart : !end ? labels.pickEnd : lengthProblem;
  const ready = Boolean(start && end && !lengthProblem && rangeOpen(kind, start, end, calendar.dates));

  return (
    <div className="flex flex-col gap-4" data-range-picker>
      {variants.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">{labels.option}</legend>
          {variants.map((variant) => (
            <label
              key={variant.id}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-3 has-checked:border-foreground"
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="range-option" checked={variantId === variant.id} onChange={() => setVariantId(variant.id)} />
                {variant.label}
              </span>
              {variant.price}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-3" aria-busy={loading}>
        <legend className="mb-2 font-medium">{labels.chooseDates}</legend>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => load(addDays(calendar.from, -calendar.dates.length))}
            disabled={loading || calendar.from <= calendar.today}
            className="min-h-11 rounded-button border border-border px-3 text-sm disabled:opacity-40"
          >
            {labels.earlier}
          </button>
          <span className="text-sm font-medium first-letter:uppercase">{calendar.title}</span>
          <button
            type="button"
            onClick={() => load(addDays(calendar.from, calendar.dates.length))}
            disabled={loading || addDays(calendar.from, calendar.dates.length) > calendar.last}
            className="min-h-11 rounded-button border border-border px-3 text-sm disabled:opacity-40"
          >
            {labels.later}
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {calendar.weekdays.map((name) => (
            <span key={name} aria-hidden className="text-xs text-muted">
              {name}
            </span>
          ))}
          {calendar.dates.map((d) => {
            const chosen = d.date === start || d.date === end;
            return (
              <button
                key={d.date}
                type="button"
                aria-pressed={chosen}
                disabled={loading || !selectable(d)}
                onClick={() => choose(d.date)}
                aria-label={`${d.label}, ${d.open ? labels.free : labels.full}`}
                className={`min-h-11 min-w-0 rounded-md border text-sm tabular-nums disabled:opacity-30 aria-pressed:bg-accent aria-pressed:text-accent-foreground ${
                  inRange(d.date) && !chosen ? "border-accent bg-accent/20" : "border-border"
                } ${d.open ? "" : "line-through"}`}
              >
                {d.day}
              </button>
            );
          })}
        </div>
      </fieldset>

      {start && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted">{labels.start}</dt>
            <dd>{calendar.dates.find((d) => d.date === start)?.label ?? start}</dd>
          </div>
          <div>
            <dt className="text-muted">{labels.end}</dt>
            <dd>{end ? (calendar.dates.find((d) => d.date === end)?.label ?? end) : "–"}</dd>
          </div>
          {count > 0 && <dd className="col-span-2 font-medium">{count === 1 ? labels.lengthOne : labels.lengthMany.replace("#", String(count))}</dd>}
        </dl>
      )}

      <form action={action} className="flex flex-col items-start gap-1">
        <input type="hidden" name="store" value={store} />
        <input type="hidden" name="market" value={market} />
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="quantity" value={Math.max(1, count)} />
        {ready && start && (
          <input type="hidden" name="startsAt" value={new Date(zonedTime(start, checkInTime, timeZone)).toISOString()} />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={!ready || pending || loading}
            className="min-h-11 button-primary px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? labels.adding : labels.addToCart}
          </button>
          {start && (
            <button
              type="button"
              onClick={() => {
                setStart(null);
                setEnd(null);
              }}
              className="min-h-11 rounded-button border border-border px-3 text-sm"
            >
              {labels.clear}
            </button>
          )}
        </div>
        <p role="status" aria-live="polite" className="text-sm">
          {state.outcome === "slot_taken" ? [labels.taken, prompt].filter(Boolean).join(" ") : (prompt ?? message)}{" "}
          {(state.outcome === "added" || state.outcome === "capped") && (
            <Link href={cartHref} className="underline">
              {labels.goToCart}
            </Link>
          )}
        </p>
      </form>
    </div>
  );
}
