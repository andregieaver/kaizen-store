"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type ReactNode } from "react";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/cart/actions";
import { appointmentWeekAction } from "@/app/s/[store]/[market]/p/actions";
import { addDays, type SlotWeek } from "@/lib/booking-slots";
import type { ChangeOutcome } from "@/server/booking-changes";

import type { AddToCartLabels } from "./add-to-cart";
import { useOpenCartAfterAdd } from "./cart-drawer";

export type AppointmentPickerLabels = AddToCartLabels & {
  chooseTime: string;
  who: string;
  anyone: string;
  earlier: string;
  later: string;
  noTimes: string;
  noTimesDay: string;
  choose: string;
  slotTaken: string;
  loading: string;
  option: string;
  /** A class's seats under its time: "{left}" and "{seats}" are filled in ("4 av 12 ledige"). */
  seatsLeft: string;
  full: string;
};

const initialState: AddToCartState = { outcome: "idle", quantity: 0 };

/** A move's outcome, said as adding to the cart would be (the messages differ). */
const moved = (outcome: ChangeOutcome): AddToCartState => ({
  outcome: outcome === "done" ? "added" : outcome === "taken" ? "slot_taken" : outcome === "closed" ? "unavailable" : "error",
  quantity: outcome === "done" ? 1 : 0,
});

/** The first date of a week with a free time, or its first date. */
const firstFree = (week: SlotWeek) => (week.days.find(hasFree) ?? week.days[0])?.date ?? week.from;

/** Whether a day has a time that can still be booked (a full class's cannot). */
const hasFree = (day: SlotWeek["days"][number]) => day.slots.some((slot) => slot.left > 0);

/**
 * Choosing an appointment's time (D65): who with, a week of dates and the
 * free times on the chosen one, then into the cart. Times come from the
 * server in the store's time zone and language; checkout holds the time.
 */
export function AppointmentPicker({
  store,
  market,
  cartHref,
  productId,
  variants,
  staff,
  initial,
  openCart = false,
  labels,
  reschedule,
}: {
  store: string;
  market: string;
  cartHref: string;
  productId: string;
  /** The appointment's options (a longer session, a package), each with its price drawn by the page. */
  variants: { id: string; label: string; price: ReactNode }[];
  staff: { id: string; name: string }[];
  initial: SlotWeek;
  openCart?: boolean;
  labels: AppointmentPickerLabels;
  /** Moving a booking the shopper has (D66) instead of adding one to the cart. */
  reschedule?: { move: (startsAt: string) => Promise<ChangeOutcome>; labels: { moveTo: string; moved: string; closed: string } };
}) {
  const [week, setWeek] = useState(initial);
  const [date, setDate] = useState(() => firstFree(initial));
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [loading, startLoading] = useTransition();

  async function fetchWeek(from: string | null, who: string | null) {
    const next = await appointmentWeekAction(store, market, { productId, from, resourceId: who });
    if (!next) return;
    setWeek(next);
    setDate(firstFree(next));
    setStartsAt(null);
  }
  const load = (from: string | null, who: string | null) => startLoading(() => fetchWeek(from, who));

  const [state, action, pending] = useActionState(async (previous: AddToCartState, form: FormData) => {
    const result: AddToCartState = reschedule
      ? moved(await reschedule.move(String(form.get("startsAt") ?? "")))
      : await addToCart(previous, form);
    // Taken meanwhile: show the week's times as they are now.
    if (result.outcome === "slot_taken") await fetchWeek(week.from, resourceId);
    return result;
  }, initialState);
  useOpenCartAfterAdd(openCart, cartHref, state);

  const day = week.days.find((d) => d.date === date);
  const anyFree = week.days.some(hasFree);
  const message =
    reschedule && state.outcome === "added"
      ? reschedule.labels.moved
      : reschedule && state.outcome === "unavailable"
        ? reschedule.labels.closed
        : state.outcome === "added" || state.outcome === "capped"
      ? labels.added
      : state.outcome === "slot_taken"
        ? labels.slotTaken
        : state.outcome === "unavailable"
          ? labels.unavailable
          : state.outcome === "error"
            ? labels.tryAgain
            : null;

  return (
    <div className="flex flex-col gap-4" data-appointment-picker>
      {variants.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">{labels.option}</legend>
          {variants.map((variant) => (
            <label
              key={variant.id}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-3 has-checked:border-foreground"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="appointment-option"
                  checked={variantId === variant.id}
                  onChange={() => setVariantId(variant.id)}
                />
                {variant.label}
              </span>
              {variant.price}
            </label>
          ))}
        </fieldset>
      )}

      {staff.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{labels.who}</span>
          <select
            value={resourceId ?? ""}
            onChange={(event) => {
              const who = event.target.value || null;
              setResourceId(who);
              load(week.from, who);
            }}
            className="min-h-11 rounded-md border border-border bg-background px-2"
          >
            <option value="">{labels.anyone}</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="flex flex-col gap-3" aria-busy={loading}>
        <legend className="mb-2 font-medium">{labels.chooseTime}</legend>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => load(addDays(week.from, -week.days.length), resourceId)}
            disabled={loading || week.from <= week.today}
            className="min-h-11 rounded-button border border-border px-3 text-sm disabled:opacity-40"
          >
            ← {labels.earlier}
          </button>
          <button
            type="button"
            onClick={() => load(addDays(week.from, week.days.length), resourceId)}
            disabled={loading || addDays(week.from, week.days.length) > week.last}
            className="min-h-11 rounded-button border border-border px-3 text-sm disabled:opacity-40"
          >
            {labels.later} →
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {week.days.map((d) => (
            <button
              key={d.date}
              type="button"
              aria-pressed={d.date === date}
              disabled={!hasFree(d)}
              onClick={() => {
                setDate(d.date);
                setStartsAt(null);
              }}
              aria-label={`${d.weekday} ${d.day} ${d.month}`}
              className="flex min-h-16 min-w-0 flex-col items-center justify-center rounded-md border border-border px-0.5 text-xs leading-tight disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              <span>{d.weekday}</span>
              <span className="text-base font-medium">{d.day}</span>
              <span>{d.month}</span>
            </button>
          ))}
        </div>
        <div aria-live="polite">
          {loading ? (
            <p className="text-sm text-muted">{labels.loading}</p>
          ) : !anyFree ? (
            <p className="text-sm text-muted">{labels.noTimes}</p>
          ) : !day || !hasFree(day) ? (
            <p className="text-sm text-muted">{labels.noTimesDay}</p>
          ) : (
            <div className={day.slots.some((slot) => slot.seats !== null) ? "grid grid-cols-3 gap-2 sm:grid-cols-4" : "grid grid-cols-4 gap-2 sm:grid-cols-5"}>
              {day.slots.map((slot) => {
                // A class (D65) says its seats: all, and how many are still free.
                const seats =
                  slot.seats === null
                    ? null
                    : slot.left > 0
                      ? labels.seatsLeft.replace("{left}", String(slot.left)).replace("{seats}", String(slot.seats))
                      : labels.full;
                return (
                  <button
                    key={slot.startsAt}
                    type="button"
                    aria-pressed={slot.startsAt === startsAt}
                    disabled={slot.left === 0}
                    onClick={() => setStartsAt(slot.startsAt)}
                    aria-label={seats ? `${slot.time}, ${seats}` : undefined}
                    className="flex min-h-11 flex-col items-center justify-center rounded-button border border-border px-1 py-1 text-sm leading-tight disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  >
                    <span>{slot.time}</span>
                    {seats && <span className="text-[11px] opacity-80">{seats}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </fieldset>

      <form action={action} className="flex flex-col items-start gap-1">
        <input type="hidden" name="store" value={store} />
        <input type="hidden" name="market" value={market} />
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="quantity" value="1" />
        {startsAt && <input type="hidden" name="startsAt" value={startsAt} />}
        {resourceId && <input type="hidden" name="resourceId" value={resourceId} />}
        <button
          type="submit"
          disabled={!startsAt || pending || loading}
          className="min-h-11 button-primary px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? labels.adding : (reschedule?.labels.moveTo ?? labels.addToCart)}
        </button>
        <p role="status" aria-live="polite" className="text-sm">
          {!startsAt && state.outcome === "idle" ? labels.choose : message}{" "}
          {!reschedule && (state.outcome === "added" || state.outcome === "capped") && (
            <Link href={cartHref} className="underline">
              {labels.goToCart}
            </Link>
          )}
        </p>
      </form>
    </div>
  );
}
