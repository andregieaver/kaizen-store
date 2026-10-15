"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Focus follows a step (wave 3, D239, `docs/wave-3-exchanges.md` 2.1): when the customer presses a button on the exchange page (or sends a wish on the return's
 * status page) and the server draws the page afresh in its next state, the button they pressed is gone and the browser's focus would fall back to the page.
 * `markStepChange()` is called by the form just before its action runs; the next `StepFocus` drawn takes the focus to the sentence that says what happened, so
 * a screen reader reads it and a keyboard user carries on from there. A page opened from a link takes no focus (nothing was pressed). The mark lives only in
 * this document's memory: nothing is stored.
 */
let stepChanged = false;

export function markStepChange(): void {
  stepChanged = true;
}

/** The sentence a new step starts with, focused once when it follows a press. */
export function StepFocus({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stepChanged || !ref.current) return;
    stepChanged = false;
    ref.current.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} role="status" className={className ? `${className} outline-none` : "outline-none"}>
      {children}
    </div>
  );
}
