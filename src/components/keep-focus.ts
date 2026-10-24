"use client";

import { useEffect, useRef, type FormEvent } from "react";

/**
 * Puts the focus back on the button that sent a form once its action is done (PSI 2026-10-24, ACC-02). A form's submit button is
 * disabled while its action runs, and a browser moves the focus of a disabled element to the page itself, so someone on a keyboard
 * or a screen reader was left at the top of the page after adding to the cart. Give the form the handler this returns as its
 * `onSubmit` (call it from an existing one); nothing is moved when the focus went somewhere on purpose meanwhile (the slide-out cart).
 */
export function useKeepFocus(pending: boolean): (event: FormEvent<HTMLFormElement>) => void {
  const submitter = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (pending || !submitter.current) return;
    const button = submitter.current;
    submitter.current = null;
    const active = document.activeElement;
    if ((!active || active === document.body) && button.isConnected) button.focus();
  }, [pending]);
  return (event) => {
    const native = event.nativeEvent as SubmitEvent;
    const from = native.submitter ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    submitter.current = from instanceof HTMLElement && event.currentTarget.contains(from) ? from : null;
  };
}
