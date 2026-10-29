"use client";

import { useEffect } from "react";

/** How long after a press the button is watched: a form's action that takes longer is not waited for. */
const WATCH_MS = 60_000;

/**
 * Puts the focus back on a button that was disabled while it sent something, wherever the page has one (wave 11 unit K, D390, PSI
 * ACC-02). `useKeepFocus()` does it for the buy forms that ask for it; the other forms of the storefront and of Kaizena Flow's own site
 * (an account's, a company's, privacy, codes, the withdrawal, reviews, exchanges, pay links, the chat: about thirty) disable their button
 * while their action runs as well, and the browser then drops the focus to the page itself, so someone on a keyboard or a screen reader
 * starts again from the top. One listener per page covers them all: the button pressed is watched until it is enabled again, and gets
 * the focus back only if nothing else took it meanwhile (a dialog, the slide-out cart, a message the form moved it to) and it is still
 * on the page. Nothing is stored and nothing is sent.
 */
export function KeepFocusEverywhere() {
  useEffect(() => {
    let stop: (() => void) | null = null;
    const watch = (button: HTMLButtonElement | HTMLInputElement) => {
      stop?.();
      let wasDisabled = button.disabled;
      const observer = new MutationObserver(() => {
        if (button.disabled) {
          wasDisabled = true;
          return;
        }
        if (!wasDisabled) return;
        end();
        const active = document.activeElement;
        if ((!active || active === document.body) && button.isConnected) button.focus();
      });
      const timer = window.setTimeout(() => end(), WATCH_MS);
      const end = () => {
        observer.disconnect();
        window.clearTimeout(timer);
        if (stop === end) stop = null;
      };
      observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
      stop = end;
    };
    const pressable = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest("button, input[type=submit]") : null;
      return element instanceof HTMLButtonElement || element instanceof HTMLInputElement ? element : null;
    };
    const onClick = (event: MouseEvent) => {
      const button = pressable(event.target);
      if (button && !button.closest("[data-staff-tools]")) watch(button);
    };
    const onSubmit = (event: SubmitEvent) => {
      const button = pressable(event.submitter);
      if (button) watch(button);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      stop?.();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
}
