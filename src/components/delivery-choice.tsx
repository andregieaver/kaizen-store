"use client";

import { useActionState, useState } from "react";

import {
  chooseDeliveryAction,
  lookUpDeliveryAction,
  type DeliveryLookup,
} from "@/app/s/[store]/[market]/checkout/actions";
import { withoutVat } from "@/lib/b2b";
import type { DeliveryKind } from "@/lib/delivery-options";
import type { ShownDeliveryOption, ShownDeliveryOptions } from "@/lib/delivery-words";
import { formatMoney } from "@/lib/money";
import { formatWindow } from "@/lib/porterbuddy";

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
  /** The groups (D237): ways it is sent, the store's own local delivery, collecting at a place. */
  shipGroup: string;
  localGroup: string;
  collectGroup: string;
  noteLabel: string;
  noteHint: string;
  instructions: string;
  /** "Local delivery from {minimum}": for an area that covers the code but whose minimum the basket has not reached. */
  localFrom: string;
  /** "We cannot deliver this basket to {code}. Collect it, or contact the store.", and the same without a code. */
  noShipping: string;
  noShippingAnywhere: string;
  /** "Enter your postal code to see the delivery price." */
  needCode: string;
  /** "Delivery has changed, check the price." */
  changed: string;
  noteProblem: string;
};

/** What kind an option is: the store's own kinds say so (D237); a carrier's service or the flat rate otherwise. */
const kindOf = (o: ShownDeliveryOption): DeliveryKind => o.kind ?? (o.carrier === "flat" ? "flat" : "carrier");

const NOTE_MAX = 500;

const distance = (meters: number, locale: string) =>
  meters < 1000
    ? `${Math.round(meters)} m`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;

/**
 * How the order is delivered (D135, D237 2.4), at the checkout: the postal code first, then the options in groups. **Delivery**: the store's methods
 * that price the basket in the code's zone (or the flat rate) and the carriers' services, each at its price for this basket. **Local delivery**: the
 * store's own delivery to the code's area, with its information and a note for the driver, or, greyed, the minimum the basket has not reached.
 * **Collect**: the store's pickup places with the address, today's hours and how soon an order is usually ready. Choosing places the order again at
 * that price. A carrier that does not answer leaves the store's own options, with a note saying so.
 */
export function DeliveryChoice({
  store,
  market,
  initial,
  currency,
  locale,
  business,
  vatRate,
  timeZone,
  labels,
}: {
  store: string;
  market: string;
  initial: ShownDeliveryOptions;
  currency: string;
  locale: string;
  /** The store's time zone, in which delivery windows are written. */
  timeZone: string;
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
  const signature = `${options.options.map((o) => `${o.id}:${o.selected}:${o.priceMinor}`).join("|")}:${options.note ?? ""}`;
  // What the page says before the options: the price waits for a code, the choice changed, or nothing delivers the basket.
  const notice = options.changed
    ? labels.changed
    : options.noShipping
      ? options.postalCode
        ? labels.noShipping.replace("{code}", options.postalCode)
        : labels.noShippingAnywhere
      : null;
  const below = options.localBelowMinimum;
  const localFrom = below
    ? labels.localFrom.replace("{minimum}", formatMoney(business ? withoutVat(below.minimumMinor, vatRate) : below.minimumMinor, currency, locale))
    : null;
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
          {found.problem
            ? (labels.problems[found.problem] ?? labels.problems.unavailable)
            : options.needsPostalCode
              ? labels.needCode
              : options.options.length <= 1
                ? labels.intro
                : null}
        </p>
      </form>
      {notice && (
        <p role="status" className="text-sm font-medium" data-delivery-notice>
          {notice}
        </p>
      )}
      <Choice
        key={signature}
        store={store}
        market={market}
        options={options.options}
        note={options.note ?? ""}
        localFrom={localFrom}
        currency={currency}
        locale={locale}
        business={business}
        vatRate={vatRate}
        timeZone={timeZone}
        labels={labels}
      />
    </section>
  );
}

function Choice({
  store,
  market,
  options,
  note,
  localFrom,
  currency,
  locale,
  business,
  vatRate,
  timeZone,
  labels,
}: {
  store: string;
  market: string;
  options: ShownDeliveryOption[];
  note: string;
  localFrom: string | null;
  currency: string;
  locale: string;
  timeZone: string;
  business: boolean;
  vatRate: number;
  labels: DeliveryChoiceLabels;
}) {
  const current = options.find((o) => o.selected) ?? options[0];
  const [picked, setPicked] = useState(current?.id ?? "flat");
  const [pickup, setPickup] = useState(current?.pickupPointId ?? "");
  const [driverNote, setDriverNote] = useState(note);
  const [state, choose, choosing] = useActionState(
    (previous: { problem: string | null }, form: FormData) => chooseDeliveryAction(store, market, previous, form),
    { problem: null },
  );
  if (options.length === 0 && !localFrom) return null;
  const option = options.find((o) => o.id === picked) ?? options[0];
  const money = (minor: number) => (minor === 0 ? labels.free : formatMoney(business ? withoutVat(minor, vatRate) : minor, currency, locale));
  const local = option ? kindOf(option) === "local" : false;
  // Nothing to do when the choice is what the order already has (with the same pickup point, or the same note for the driver).
  const unchanged = !option || (option.selected && (!option.needsPickupPoint || option.pickupPointId === pickup) && (!local || driverNote.trim() === note.trim()));
  const groups: { key: string; title: string; items: ShownDeliveryOption[] }[] = [
    { key: "ship", title: labels.shipGroup, items: options.filter((o) => ["flat", "method", "carrier"].includes(kindOf(o))) },
    { key: "local", title: labels.localGroup, items: options.filter((o) => kindOf(o) === "local") },
    { key: "collect", title: labels.collectGroup, items: options.filter((o) => kindOf(o) === "pickup") },
  ];
  // One group of the market's own shipping only (the flat rate and carriers, as before D237) needs no group heading.
  const grouped = groups.filter((g) => g.items.length > 0).length > 1 || localFrom !== null;
  return (
    <form action={choose} className="flex flex-col gap-3">
      <input type="hidden" name="option" value={option?.id ?? ""} />
      <input type="hidden" name="pickup" value={option?.needsPickupPoint ? pickup : ""} />
      <fieldset className="flex flex-col gap-4">
        <legend className="sr-only">{labels.heading}</legend>
        {groups.map((group) =>
          group.items.length === 0 && !(group.key === "local" && localFrom) ? null : (
            <div key={group.key} role="group" aria-labelledby={grouped ? `delivery-group-${group.key}` : undefined} className="flex flex-col gap-2" data-delivery-group={group.key}>
              {grouped && (
                <h3 id={`delivery-group-${group.key}`} className="text-sm font-medium">
                  {group.title}
                </h3>
              )}
              {group.items.map((o) => (
                <OptionRow
                  key={o.id}
                  o={o}
                  checked={picked === o.id}
                  onPick={() => {
                    setPicked(o.id);
                    setPickup(o.pickupPointId ?? "");
                  }}
                  pickup={pickup}
                  setPickup={setPickup}
                  money={money}
                  locale={locale}
                  timeZone={timeZone}
                  labels={labels}
                />
              ))}
              {group.key === "local" && group.items.length === 0 && localFrom && (
                // An area that covers the code, but the basket is below its minimum: shown so the shopper sees why, never chosen.
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted" data-local-below-minimum>
                  {localFrom}
                </p>
              )}
            </div>
          ),
        )}
      </fieldset>
      {local && (
        <div className="flex flex-col gap-1">
          <label htmlFor="delivery-note" className="text-sm font-medium">
            {labels.noteLabel}
          </label>
          <textarea
            id="delivery-note"
            name="note"
            value={driverNote}
            onChange={(event) => setDriverNote(event.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            aria-describedby="delivery-note-hint"
            aria-invalid={state.problem === "note" ? true : undefined}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          />
          <p id="delivery-note-hint" className="text-sm text-muted">
            {labels.noteHint}
          </p>
        </div>
      )}
      {state.problem && (
        <p role="alert" className="text-sm">
          {state.problem === "note" ? labels.noteProblem : (labels.problems[state.problem] ?? labels.problems.gone)}
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

/** One option: its name and price; a carrier's window, transit time and pickup points; a pickup place's address, hours today and ready time; an area's information. */
function OptionRow({
  o,
  checked,
  onPick,
  pickup,
  setPickup,
  money,
  locale,
  timeZone,
  labels,
}: {
  o: ShownDeliveryOption;
  checked: boolean;
  onPick: () => void;
  pickup: string;
  setPickup: (id: string) => void;
  money: (minor: number) => string;
  locale: string;
  timeZone: string;
  labels: DeliveryChoiceLabels;
}) {
  const days = o.estimate ? (o.estimate.min === o.estimate.max ? String(o.estimate.min) : `${o.estimate.min}–${o.estimate.max}`) : null;
  const kind = kindOf(o);
  return (
    <div className="flex flex-col gap-2" data-delivery-option={kind}>
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-checked:border-foreground">
        <input type="radio" name="choice" checked={checked} onChange={onPick} className="mt-1 size-4" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{o.label}</span>
          {o.window && <span className="block text-sm">{formatWindow(o.window, locale, timeZone)}</span>}
          {days && <span className="block text-sm text-muted">{labels.workingDays.replace("{range}", days)}</span>}
          {kind === "pickup" && o.place && (
            <>
              <span className="block text-sm">{[o.place.street, `${o.place.postalCode} ${o.place.city}`.trim()].filter(Boolean).join(", ")}</span>
              {o.words?.today && <span className="block text-sm text-muted">{o.words.today}</span>}
              {o.words?.ready && <span className="block text-sm text-muted">{o.words.ready}</span>}
            </>
          )}
          {kind === "local" && o.info && <span className="block text-sm text-muted whitespace-pre-line">{o.info}</span>}
        </span>
        <span className="whitespace-nowrap font-medium">{money(o.priceMinor)}</span>
      </label>
      {checked && kind === "pickup" && o.place?.instructions && (
        <p className="ml-7 text-sm whitespace-pre-line">
          <span className="font-medium">{labels.instructions}:</span> {o.place.instructions}
        </p>
      )}
      {checked && o.needsPickupPoint && (
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
}
