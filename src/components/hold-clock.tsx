"use client";

import { useEffect, useState } from "react";

/** When the warning shows: this many seconds before the hold ends. */
export const HOLD_WARN_SECONDS = 5 * 60;

/**
 * How long the items are held while the shopper pays, with a warning before the hold ends (PSI ACC-05, WCAG 2.2.1): five minutes before,
 * the line becomes an alert, and at the end the page is drawn again, which then offers to start over. Stripe's session cannot be made
 * longer, so starting over is the way to more time. The seconds are the server's, counted from when the page arrived.
 */
export function HoldClock({ secondsLeft, held, ending }: { secondsLeft: number; held: string; ending: string }) {
  const [warn, setWarn] = useState(secondsLeft <= HOLD_WARN_SECONDS);
  useEffect(() => {
    const timers = [
      window.setTimeout(() => setWarn(true), Math.max(0, secondsLeft - HOLD_WARN_SECONDS) * 1000),
      // A second after the end, so the server reads the hold as over.
      window.setTimeout(() => window.location.reload(), (secondsLeft + 1) * 1000),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [secondsLeft]);
  return warn ? (
    <p role="alert" data-hold-ending className="rounded-lg border border-border p-3 text-sm font-medium">
      {ending}
    </p>
  ) : (
    <p className="text-sm text-muted">{held}</p>
  );
}
