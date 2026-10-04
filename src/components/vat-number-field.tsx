"use client";

import { useId } from "react";

import type { VatNumberMessage } from "@/lib/vat-text";

export type VatNumberFieldLabels = { label: string; help: string; check: string; checking: string };

/**
 * The EU VAT number a business buyer types in the cart (D157): a field and a *Check* button that asks the server (VIES), and
 * under them what became of the number, in plain words. It holds nothing itself and sets no cookie and uses no storage: the
 * number is on the cart's row, and the text under the field is what the server worked out. Pressing Enter checks the number
 * and does not start the checkout. The sentence is a live region, so a screen reader hears the answer when it arrives.
 */
export function VatNumberField({
  value,
  onChange,
  onCheck,
  checking,
  message,
  problem,
  labels,
}: {
  value: string;
  onChange: (value: string) => void;
  onCheck: () => void;
  checking: boolean;
  /** What the server says of the number on the cart, while the field still holds it. */
  message: VatNumberMessage | null;
  /** What is wrong with what was typed or with the cart (after pressing Check). */
  problem: string | null;
  labels: VatNumberFieldLabels;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const problemId = `${id}-problem`;
  return (
    <div className="flex flex-col gap-1" data-vat-number-field>
      <label htmlFor={id} className="flex flex-col gap-1">
        {labels.label}
        <span className="text-muted">{labels.help}</span>
      </label>
      <div className="flex flex-wrap items-stretch gap-2">
        <input
          id={id}
          name="vatNumber"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCheck();
            }
          }}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${noteId} ${problemId}`}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3"
        />
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className="min-h-11 rounded-md border border-border px-3 disabled:opacity-40"
        >
          {checking ? labels.checking : labels.check}
        </button>
      </div>
      <p id={noteId} role="status" aria-live="polite" data-tone={message?.tone} className="empty:hidden">
        {problem ? null : message?.text}
      </p>
      <p id={problemId} role="alert" className="empty:hidden">
        {problem}
      </p>
    </div>
  );
}
