"use client";

import { useState, type ReactNode } from "react";

/**
 * Round 32 (D706): a long list on a phone shows its first items and a button for the rest. The items past the first are drawn with
 * `PHONE_MORE_HIDDEN` (`phone-more-class.ts`), which hides them on a phone until the button is pressed; from the small breakpoint up every item shows and the
 * button is not there.
 */
export function PhoneMore({ hidden, label, children, className = "" }: { hidden: number; label: string; children: ReactNode; className?: string }) {
  const [all, setAll] = useState(false);
  return (
    <div data-more={all || hidden === 0 ? "all" : "some"} className={`group/more ${className}`}>
      {children}
      {!all && hidden > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken sm:hidden"
        >
          {label}
        </button>
      ) : null}
    </div>
  );
}
