"use client";

import { useState, type ReactNode } from "react";

/**
 * Round 26 (D699): the period picker on a phone. The day chips stay on one line with an "Other dates" chip at its end; the date fields and
 * the comparison open under it when pressed. From the small breakpoint up everything shows as before and the chip is not there.
 */
export function PeriodMore({ chips, label, more, children }: { chips: ReactNode; label: string; more?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex min-w-0 items-center gap-1 max-sm:w-full max-sm:overflow-x-auto max-sm:[scrollbar-width:none]">
        {chips}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
          className={`inline-flex h-9 shrink-0 items-center rounded-panel border px-2.5 text-sm whitespace-nowrap sm:hidden ${open ? "border-brand bg-sunken font-medium" : "border-line"}`}
        >
          {label}
        </button>
      </div>
      <div className={open ? "contents" : "contents max-sm:hidden"}>
        {more}
        {children}
      </div>
    </>
  );
}
