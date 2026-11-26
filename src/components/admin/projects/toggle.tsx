"use client";

import type { ReactNode } from "react";

/**
 * A choice that is on or off, drawn as a pill (D903): a weekday of a repeat, a filter's value. Pressed, it is filled; the mouse over it
 * changes only one not chosen, so a chosen one never looks switched off under the pointer.
 */
export function Toggle({ on, onClick, disabled, label, children }: { on: boolean; onClick: () => void; disabled?: boolean; label?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-pill border border-line px-2.5 text-sm text-ink-2 aria-[pressed=false]:hover:bg-sunken aria-[pressed=false]:hover:text-ink aria-pressed:border-transparent aria-pressed:bg-inverse aria-pressed:text-inverse-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}
