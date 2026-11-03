"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import type { QuantityRule } from "@/lib/quantity-rules";

import { QuantityStepper, type QuantityStepperLabels } from "./quantity-stepper";

const noSubscribe = () => () => {};

/** How long after the last press or keystroke a cart line's new quantity is saved (D430). */
const SAVE_AFTER_MS = 450;

/**
 * A cart line's quantity (D430): the − and + chooser, saved by itself a moment after the last change (one save for several presses), the
 * cart's totals following once the server has it (`updateCartLine()` refreshes the page). Without a script the form is the one it always
 * was: the number and an Update button, which only shows then. A quantity the server changed (capped by stock) is shown as the server has
 * it, unless the shopper is changing it again.
 */
export function CartQuantity({
  action,
  fields,
  rule,
  quantity,
  labels,
  context,
  compact = false,
}: {
  /** `updateCartLine`, bound to nothing: the line is named by `fields`. */
  action: (form: FormData) => Promise<void>;
  /** The line's hidden fields: store, market, variant and, where it has them, its purchase option and gift card key. */
  fields: Record<string, string>;
  rule: QuantityRule;
  quantity: number;
  labels: QuantityStepperLabels & { update: string; saving: string };
  /** The line's product, said after the buttons' words. */
  context: string;
  compact?: boolean;
}) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [value, setValue] = useState(quantity);
  // Changed here and not yet sent: the server's quantity does not overwrite it.
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();
  // The server's quantity, taken over whenever it changes and nothing typed here waits to be sent.
  const [known, setKnown] = useState(quantity);
  if (known !== quantity && !dirty) {
    setKnown(quantity);
    setValue(quantity);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = () => {
    window.clearTimeout(timer.current);
    const element = form.current;
    if (!element) return;
    const data = new FormData(element);
    setDirty(false);
    startSaving(async () => {
      await action(data);
    });
  };

  return (
    <form
      ref={form}
      action={action}
      onSubmit={(event) => {
        // Enter in the field: saved now, once.
        event.preventDefault();
        save();
      }}
      className="flex items-end gap-2"
      aria-busy={saving}
    >
      {Object.entries(fields).map(([name, field]) => (
        <input key={name} type="hidden" name={name} value={field} />
      ))}
      <QuantityStepper
        rule={rule}
        value={value}
        compact={compact}
        context={context}
        labels={labels}
        onChange={(n) => {
          setValue(n);
          setDirty(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(save, SAVE_AFTER_MS);
        }}
      />
      {/* Only without a script: with one, each change is saved by itself. */}
      {!inBrowser && (
        <button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm">
          {labels.update}
        </button>
      )}
      <span role="status" className="sr-only">
        {saving ? labels.saving : ""}
      </span>
    </form>
  );
}
