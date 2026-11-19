"use client";

import type { ReactNode } from "react";

/**
 * Fields that belong to one radio choice (D763's "Someone else"): typing in them picks that choice, so what was written is what is
 * saved. `name` and `value` say which radio, found in the same form.
 */
export function PickOnInput({ name, value, className, children }: { name: string; value: string; className?: string; children: ReactNode }) {
  return (
    <div
      className={className}
      onInput={(event) => {
        const radio = event.currentTarget.closest("form")?.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`);
        if (radio) radio.checked = true;
      }}
    >
      {children}
    </div>
  );
}
