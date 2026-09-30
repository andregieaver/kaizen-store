"use client";

import { useEffect } from "react";

/** What only the runtime can do: waypoints, split text, pointer effects. */
const WAITING =
  '[data-fx-trigger="view"]:not([data-fx-in]), [data-fx-text], [data-fx-hover="tilt"], [data-fx-hover="magnetic"], [data-fx-hover="spotlight"]';

/** Whether anything on the page needs the runtime in this browser (scroll effects only when CSS lacks scroll timelines). */
function needed(): boolean {
  if (document.querySelector(WAITING)) return true;
  const timelines =
    typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timeline: view()");
  return !timelines && document.querySelector("[data-fx-scroll]") !== null;
}

/**
 * Starts the motion runtime (`src/lib/motion-runtime.ts`) once the page is up, and stops it when the page goes. Drawn only
 * by pages that use motion that needs it (`pageUsesMotion()`), so no other page loads it; the code itself is fetched
 * only when something on the page needs it in this browser.
 */
export function MotionRuntime(): null {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    const begin = () => {
      if (gone || !needed()) return;
      void import("@/lib/motion-runtime")
        .then((m) => {
          if (!gone) stop = m.initMotion(document);
        })
        .catch(() => undefined);
    };
    // After hydration, when the browser is idle (the page's first row does not wait for this: it is CSS).
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(begin, { timeout: 500 }) : window.setTimeout(begin, 1);
    return () => {
      gone = true;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      stop?.();
    };
  }, []);
  return null;
}
