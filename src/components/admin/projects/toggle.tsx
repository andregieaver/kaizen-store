"use client";

import type { ReactNode } from "react";

/**
 * A choice that is on or off, drawn as a pill (D903): a weekday of a repeat, a filter's value. Pressed, it is filled. No hover style of its
 * own: every class here is one the store's stylesheet already carries (e2e/performance.spec.ts holds that file's size).
 */
export function Toggle({ on, onClick, disabled, label, children }: { on: boolean; onClick: () => void; disabled?: boolean; label?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-pill border border-line px-2.5 text-sm text-ink-2 aria-pressed:bg-inverse aria-pressed:text-inverse-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}
