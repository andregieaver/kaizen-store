"use client";

import { useId, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { lineMax, type QuantityRule } from "@/lib/quantity-rules";
import { snapQuantity, stepDown, stepUp, typedQuantity } from "@/lib/quantity-stepper";

/** The words a quantity chooser says, in the shopper's language (`Messages.quantity`, `quantityLess`, `quantityMore`). */
export type QuantityStepperLabels = { quantity: string; less: string; more: string };

const noSubscribe = () => () => {};

/**
 * How many to buy (D430): a number field with − and + beside it that follows the variant's quantity rule (D323: its minimum, the line's
 * maximum, whole steps). The buttons are 44 px targets named for a screen reader (with `context`, such as a cart line's product, after
 * the words), and switch off at the limits; the field takes typing and the arrow keys (the browser steps it by the rule's step from its
 * minimum), and a typed number that the rule does not allow becomes the nearest one it does when the field is left or Enter is pressed.
 * Without a script the field is an ordinary number in its form, so the form sends what was typed and the server holds it to the rule;
 * the buttons stay switched off until the script runs. `buttons: false` draws the field alone (the store's "number box").
 */
export function QuantityStepper({
  name = "quantity",
  rule,
  value,
  onChange,
  labels,
  buttons = true,
  context,
  hideLabel = false,
  disabled = false,
  compact = false,
}: {
  name?: string;
  rule: QuantityRule;
  value: number;
  /** A quantity the rule allows: on each button, each allowed number typed, and the nearest allowed one when the field is left. */
  onChange: (n: number) => void;
  labels: QuantityStepperLabels;
  buttons?: boolean;
  /** Said after each button's and the field's words to a screen reader ("Increase quantity: Linen shirt"). */
  context?: string;
  /** The word "Quantity" for a screen reader only, where the place says it (the phone's bar). */
  hideLabel?: boolean;
  disabled?: boolean;
  /** Narrower field, for the phone's bar. */
  compact?: boolean;
}) {
  const id = useId();
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const most = lineMax(rule);
  // What the field shows: the value, or what is being typed until it is left.
  const [typing, setTyping] = useState<string | null>(null);
  // A value changed from outside (the cart's server capped it to the stock) replaces what was typed, unless it is what was typed.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (typing !== null && typedQuantity(typing) !== value) setTyping(null);
  }
  const shown = typing ?? String(value);
  const settle = (text: string) => {
    const typed = typedQuantity(text);
    const next = snapQuantity(typed ?? value, rule);
    setTyping(null);
    if (next !== value) onChange(next);
    return next;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter sends the form: with the nearest allowed quantity in the field, so the browser does not stop it.
    if (event.key === "Enter") event.currentTarget.value = String(settle(event.currentTarget.value));
  };
  const sr = context ? `: ${context}` : "";
  const button =
    "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-lg leading-none outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-col gap-1 text-sm" data-quantity-stepper="">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {labels.quantity}
        {context && <span className="sr-only">{sr}</span>}
      </label>
      <div className="rounded-button inline-flex w-fit items-stretch border border-border bg-background">
        {buttons && (
          <button
            type="button"
            className={`${button} rounded-l-[inherit]`}
            aria-label={`${labels.less}${sr}`}
            aria-controls={id}
            disabled={disabled || !inBrowser || value <= rule.min}
            onClick={() => {
              setTyping(null);
              onChange(stepDown(value, rule));
            }}
          >
            <span aria-hidden="true">−</span>
          </button>
        )}
        <input
          id={id}
          type="number"
          inputMode="numeric"
          name={name}
          min={rule.min}
          max={most}
          step={rule.step}
          required
          disabled={disabled}
          value={shown}
          onChange={(event) => {
            const text = event.target.value;
            setTyping(text);
            // A number the rule allows counts at once (the arrow keys, or a whole number typed); anything else waits until the field is left.
            const typed = typedQuantity(text);
            if (typed !== null && typed >= rule.min && typed <= most && typed % rule.step === 0) onChange(typed);
          }}
          onBlur={(event) => settle(event.target.value)}
          onKeyDown={onKeyDown}
          // Beside − and + the browser's own little arrows are left out; the number box alone keeps them.
          className={`min-h-11 ${!buttons ? "w-16" : compact ? "w-12" : "w-14"} border-0 bg-transparent px-1 text-center tabular-nums outline-offset-2 ${
            buttons
              ? "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              : "rounded-[inherit]"
          }`}
        />
        {buttons && (
          <button
            type="button"
            className={`${button} rounded-r-[inherit]`}
            aria-label={`${labels.more}${sr}`}
            aria-controls={id}
            disabled={disabled || !inBrowser || value >= most}
            onClick={() => {
              setTyping(null);
              onChange(stepUp(value, rule));
            }}
          >
            <span aria-hidden="true">+</span>
          </button>
        )}
      </div>
    </div>
  );
}
