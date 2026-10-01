"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/cart/actions";
import { rangeDatesAction, rentalTimesAction, type RentalTimeChoice } from "@/app/s/[store]/[market]/p/actions";
import { rangeCount, rangeOpen, type RangeCalendar, type RangeKind, type RentalPeriod } from "@/lib/booking-ranges";
import { bookingPrice, type Season } from "@/lib/booking-prices";
import { addDays, zonedTime } from "@/lib/booking-slots";
import { minorUnitDigits } from "@/lib/money";
import type { PriceVat } from "@/lib/pricing";

import { AffiliateField } from "./affiliate-field";
import { RecommendField } from "./recommend-field";
import type { AddToCartLabels } from "./add-to-cart";
import { useOpenCartAfterAdd } from "./cart-drawer";
import { Dropdown } from "./dropdown";
import { VatAmount } from "./price";
import { showVariantPicture, type VariantPicture } from "./variant-picture";

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
  /** Rentals by the half day or hour (D69). */
  pickDay: string;
  pickTime: string;
  chooseTime: string;
  howLong: string;
  noTimes: string;
  hourOne: string;
  hourMany: string;
  total: string;
  /** Said under the total when a fee per booking is in it, such as final cleaning. */
  feeIncluded: string;
  vatIncluded: string;
  vatExcluded: string;
};

const initialState: AddToCartState = { outcome: "idle", quantity: 0 };

/**
 * Choosing a stay's nights or a rental's days (D67): four weeks of dates,
 * the first and the last, then into the cart as that many nights or days
 * from check-in. A rental's variant by the half day or hour (D69) takes one
 * date, then a half or a start time and how many hours. The server says
 * what is free and checks it again; checkout holds it.
 */
export function RangePicker({
  store,
  market,
  cartHref,
  productId,
  kind,
  variants,
  pricing,
  locale,
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
  variants: {
    id: string;
    label: string;
    price: ReactNode;
    image?: VariantPicture | null;
    period: RentalPeriod;
    /** The price of a night, day, half day or hour before seasons (D70), kept with VAT, and how it is shown (B2B). */
    base: { amountMinor: number; currency: string; vat: PriceVat };
  }[];
  /** The seasons and fee per booking (D70), for the total before adding. */
  pricing: { seasons: Season[]; feeMinor: number };
  locale: string;
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
  // The gallery shows the chosen option's picture (D82).
  useEffect(() => showVariantPicture(productId, variants.find((v) => v.id === variantId)?.image ?? null), [productId, variants, variantId]);
  const stay = kind === "stay";
  const period: RentalPeriod = stay ? "day" : (variants.find((v) => v.id === variantId)?.period ?? "day");
  const byDay = period === "day";
  // A rental by the half day or hour: its date's times, the chosen one, and how many hours.
  const [times, setTimes] = useState<RentalTimeChoice[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [hours, setHours] = useState(1);

  async function fetchDates(from: string | null, forPeriod: RentalPeriod = period) {
    const next = await rangeDatesAction(store, market, { productId, from, period: forPeriod });
    if (next) setCalendar(next);
  }
  const load = (from: string) => startLoading(() => fetchDates(from));

  function clear() {
    setStart(null);
    setEnd(null);
    setTimes(null);
    setTime(null);
    setHours(1);
  }

  function chooseVariant(id: string) {
    const next = variants.find((v) => v.id === id)?.period ?? "day";
    setVariantId(id);
    if (next !== period) {
      clear();
      startLoading(() => fetchDates(calendar.from, next));
    }
  }

  function chooseDay(date: string) {
    clear();
    setStart(date);
    if (period === "day") return;
    const forPeriod = period;
    startLoading(async () => setTimes(await rentalTimesAction(store, market, { productId, date, period: forPeriod })));
  }

  const [state, action, pending] = useActionState(async (previous: AddToCartState, form: FormData) => {
    const result = await addToCart(previous, form);
    // Taken meanwhile: show the dates as they are now, and choose again.
    if (result.outcome === "slot_taken") {
      await fetchDates(calendar.from);
      clear();
    }
    return result;
  }, initialState);
  useOpenCartAfterAdd(openCart, cartHref, state);

  const count = byDay ? (start && end ? rangeCount(kind, start, end) : 0) : time ? (period === "hour" ? hours : 1) : 0;
  const lengthProblem = byDay && count > 0 && count < minNights ? labels.tooShort : byDay && count > maxNights ? labels.tooLong : null;
  const chosenTime = times?.find((t) => t.startsAt === time) ?? null;

  function choose(date: string) {
    if (!byDay) return chooseDay(date);
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
    if (!byDay || !start || end || d.date < start) return d.open;
    if (stay && d.date === start) return true;
    return rangeOpen(kind, start, d.date, calendar.dates) || d.open;
  }

  const inRange = (date: string) => Boolean(byDay && start && end && date >= start && date <= end);
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
  const prompt = byDay
    ? !start
      ? labels.pickStart
      : !end
        ? labels.pickEnd
        : lengthProblem
    : !start
      ? labels.pickDay
      : times && times.every((t) => t.free === 0)
        ? labels.noTimes
        : !time
          ? labels.pickTime
          : null;
  const ready = byDay
    ? Boolean(start && end && !lengthProblem && rangeOpen(kind, start, end, calendar.dates))
    : Boolean(chosenTime && chosenTime.free >= count && count > 0);
  const startsAt = byDay
    ? ready && start
      ? new Date(zonedTime(start, checkInTime, timeZone)).toISOString()
      : null
    : ready
      ? time
      : null;
  const lengthLabel = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));
  // What the chosen dates or hours cost, as the cart will price them: seasons night by night, and the fee.
  const base = variants.find((v) => v.id === variantId)?.base ?? null;
  const total =
    ready && start && base
      ? bookingPrice(
          { kind, period, startDate: start, count, baseMinor: base.amountMinor, seasons: pricing.seasons, feeMinor: pricing.feeMinor },
          10 ** minorUnitDigits(base.currency),
        ).totalMinor
      : null;

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
                <input type="radio" name="range-option" checked={variantId === variant.id} onChange={() => chooseVariant(variant.id)} />
                {variant.image && (
                  // eslint-disable-next-line @next/next/no-img-element -- the store's own small picture
                  <img src={variant.image.thumbnailUrl} alt="" className="size-10 rounded-md bg-surface object-cover" />
                )}
                {variant.label}
              </span>
              {variant.price}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-3" aria-busy={loading}>
        <legend className="mb-2 font-medium">{byDay ? labels.chooseDates : labels.pickDay.replace(/\.$/, "")}</legend>
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

      {byDay && start && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted">{labels.start}</dt>
            <dd>{calendar.dates.find((d) => d.date === start)?.label ?? start}</dd>
          </div>
          <div>
            <dt className="text-muted">{labels.end}</dt>
            <dd>{end ? (calendar.dates.find((d) => d.date === end)?.label ?? end) : "–"}</dd>
          </div>
          {count > 0 && <dd className="col-span-2 font-medium">{lengthLabel(count, labels.lengthOne, labels.lengthMany)}</dd>}
        </dl>
      )}

      {!byDay && start && times && (
        <fieldset className="flex flex-col gap-3" aria-busy={loading}>
          <legend className="mb-2 font-medium">{labels.chooseTime}</legend>
          <div className={`grid gap-2 ${period === "half_day" ? "grid-cols-2" : "grid-cols-4 sm:grid-cols-5"}`}>
            {times.map((t) => (
              <button
                key={t.startsAt}
                type="button"
                aria-pressed={t.startsAt === time}
                disabled={loading || t.free === 0}
                onClick={() => {
                  setTime(t.startsAt);
                  setHours((h) => Math.min(Math.max(1, h), t.free));
                }}
                className="min-h-11 rounded-button border border-border text-sm tabular-nums disabled:opacity-30 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              >
                {t.label}
              </button>
            ))}
          </div>
          {period === "hour" && chosenTime && (
            <Dropdown
              label={labels.howLong}
              className="max-w-48 text-sm"
              value={String(hours)}
              onChange={(value) => setHours(Number(value))}
              options={Array.from({ length: chosenTime.free }, (_, i) => i + 1).map((n) => ({
                value: String(n),
                label: lengthLabel(n, labels.hourOne, labels.hourMany),
              }))}
            />
          )}
        </fieldset>
      )}

      {total !== null && base && (
        <p className="text-sm" data-range-total>
          <span className="font-medium">
            {labels.total}:{" "}
            <VatAmount amountMinor={total} currency={base.currency} locale={locale} vat={base.vat} labels={labels} />
          </span>
          {pricing.feeMinor > 0 && <span className="block text-muted">{labels.feeIncluded}</span>}
        </p>
      )}

      <form action={action} className="flex flex-col items-start gap-1">
        <input type="hidden" name="store" value={store} />
        <input type="hidden" name="market" value={market} />
        <input type="hidden" name="variantId" value={variantId} />
        <input type="hidden" name="quantity" value={Math.max(1, count)} />
        <AffiliateField store={store} />
        <RecommendField />
        {startsAt && <input type="hidden" name="startsAt" value={startsAt} />}
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
              onClick={clear}
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
