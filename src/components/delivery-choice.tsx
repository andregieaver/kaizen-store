"use client";

import { useActionState, useState } from "react";

import {
  chooseDeliveryAction,
  lookUpDeliveryAction,
  type DeliveryLookup,
} from "@/app/s/[store]/[market]/checkout/actions";
import { withoutVat } from "@/lib/b2b";
import type { DeliveryOption, DeliveryOptions } from "@/lib/delivery-options";
import { formatMoney } from "@/lib/money";

export type DeliveryChoiceLabels = {
  heading: string;
  postalCode: string;
  lookUp: string;
  looking: string;
  intro: string;
  problems: Record<string, string>;
  free: string;
  /** "Working days: {range}". */
  workingDays: string;
  pickupHeading: string;
  choose: string;
  choosing: string;
};

const distance = (meters: number, locale: string) =>
  meters < 1000
    ? `${Math.round(meters)} m`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;

/**
 * How the order is delivered (D135), at the checkout: the market's flat rate and, once the shopper has given a postal
 * code, the store's carrier's services with their prices and, for one that needs it, the pickup points nearby. Choosing
 * places the order again at that price. A carrier that does not answer leaves the flat rate, with a note saying so.
 */
export function DeliveryChoice({
  store,
  market,
  initial,
  currency,
  locale,
  business,
  vatRate,
  labels,
}: {
  store: string;
  market: string;
  initial: DeliveryOptions;
  currency: string;
  locale: string;
  /** A business sees prices without VAT (B2B). */
  business: boolean;
  vatRate: number;
  labels: DeliveryChoiceLabels;
}) {
  const [found, look, looking] = useActionState(
    (_previous: DeliveryLookup, form: FormData) => lookUpDeliveryAction(store, market, String(form.get("postalCode") ?? "")),
    { options: initial, problem: null } satisfies DeliveryLookup,
  );
  const options = found.options ?? initial;
  // A new answer starts the choice over from what the order has now.
  const signature = options.options.map((o) => `${o.id}:${o.selected}:${o.priceMinor}`).join("|");
  return (
    <section aria-labelledby="delivery-choice-heading" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="delivery-choice-heading" className="text-lg font-medium">
        {labels.heading}
      </h2>
      <form action={look} className="flex flex-col gap-1">
        <label htmlFor="delivery-postal-code" className="text-sm">
          {labels.postalCode}
        </label>
        <div className="flex gap-2">
          <input
            id="delivery-postal-code"
            name="postalCode"
            defaultValue={options.postalCode ?? ""}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={12}
            required
            aria-invalid={found.problem ? true : undefined}
            aria-describedby="delivery-problem"
            className="min-h-11 w-32 rounded-md border border-border bg-background px-3"
          />
          <button type="submit" disabled={looking} className="min-h-11 rounded-md border border-foreground px-4 text-sm font-medium disabled:opacity-50">
            {looking ? labels.looking : labels.lookUp}
          </button>
        </div>
        <p id="delivery-problem" role={found.problem ? "alert" : undefined} aria-live="polite" className="text-sm empty:hidden">
          {found.problem ? (labels.problems[found.problem] ?? labels.problems.unavailable) : options.options.length <= 1 ? labels.intro : null}
        </p>
      </form>
      <Choice
        key={signature}
        store={store}
        market={market}
        options={options.options}
        currency={currency}
        locale={locale}
        business={business}
        vatRate={vatRate}
        labels={labels}
      />
    </section>
  );
}

function Choice({
  store,
  market,
  options,
  currency,
  locale,
  business,
  vatRate,
  labels,
}: {
  store: string;
  market: string;
  options: DeliveryOption[];
  currency: string;
  locale: string;
  business: boolean;
  vatRate: number;
  labels: DeliveryChoiceLabels;
}) {
  const current = options.find((o) => o.selected) ?? options[0];
  const [picked, setPicked] = useState(current?.id ?? "flat");
  const [pickup, setPickup] = useState(current?.pickupPointId ?? "");
  const [state, choose, choosing] = useActionState(
    (previous: { problem: string | null }, form: FormData) => chooseDeliveryAction(store, market, previous, form),
    { problem: null },
  );
  if (options.length === 0) return null;
  const option = options.find((o) => o.id === picked) ?? options[0];
  const money = (minor: number) => (minor === 0 ? labels.free : formatMoney(business ? withoutVat(minor, vatRate) : minor, currency, locale));
  // Nothing to do when the choice is what the order already has (and a pickup point is what it already has).
  const unchanged = option.selected && (!option.needsPickupPoint || option.pickupPointId === pickup);
  return (
    <form action={choose} className="flex flex-col gap-3">
      <input type="hidden" name="option" value={option.id} />
      <input type="hidden" name="pickup" value={option.needsPickupPoint ? pickup : ""} />
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{labels.heading}</legend>
        {options.map((o) => {
          const days = o.estimate ? (o.estimate.min === o.estimate.max ? String(o.estimate.min) : `${o.estimate.min}–${o.estimate.max}`) : null;
          return (
            <div key={o.id} className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-checked:border-foreground">
                <input
                  type="radio"
                  name="choice"
                  checked={picked === o.id}
                  onChange={() => {
                    setPicked(o.id);
                    setPickup(o.pickupPointId ?? "");
                  }}
                  className="mt-1 size-4"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{o.label}</span>
                  {days && <span className="block text-sm text-muted">{labels.workingDays.replace("{range}", days)}</span>}
                </span>
                <span className="whitespace-nowrap font-medium">{money(o.priceMinor)}</span>
              </label>
              {picked === o.id && o.needsPickupPoint && (
                <fieldset className="ml-7 flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">{labels.pickupHeading}</legend>
                  {o.pickupPoints.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-start gap-3 text-sm">
                      <input type="radio" name="pickup-point" checked={pickup === p.id} onChange={() => setPickup(p.id)} className="mt-1 size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{p.name}</span>
                        <span className="block text-muted">
                          {p.street}, {p.postalCode} {p.city}
                          {p.distanceMeters !== null && ` · ${distance(p.distanceMeters, locale)}`}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          );
        })}
      </fieldset>
      {state.problem && (
        <p role="alert" className="text-sm">
          {labels.problems[state.problem] ?? labels.problems.gone}
        </p>
      )}
      {!unchanged && (
        <button type="submit" disabled={choosing} className="min-h-11 self-start button-primary px-4 font-medium disabled:opacity-50">
          {choosing ? labels.choosing : labels.choose}
        </button>
      )}
    </form>
  );
}
