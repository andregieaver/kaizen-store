"use client";

import { useFormStatus } from "react-dom";

/**
 * A switch that is the form's submit button (round 22): one control for one choice, in place of a state chip beside a Switch on/off button. It
 * says its state to a screen reader as a switch, and its name says what pressing it does ("Switch off Order sent").
 */
export function SwitchButton({ on, label }: { on: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={pending}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill transition-colors disabled:opacity-60 ${on ? "bg-brand" : "bg-line"}`}
    >
      <span aria-hidden className={`absolute size-5 rounded-pill bg-card shadow transition-[left] ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}
