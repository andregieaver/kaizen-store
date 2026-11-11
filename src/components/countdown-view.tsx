"use client";

import { useSyncExternalStore } from "react";

import { timeLeft, type TimeLeft } from "@/lib/countdown";

/** A clock that ticks each second, shared by every timer of the page. */
function subscribeSeconds(tick: () => void): () => void {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}
const currentSecond = (): number => Math.floor(Date.now() / 1000) * 1000;
const noClock = (): number | null => null;

const UNITS = ["days", "hours", "minutes", "seconds"] as const;
const UNIT: Record<(typeof UNITS)[number], string> = { days: "day", hours: "hour", minutes: "minute", seconds: "second" };

/** A unit's name in the page's language, for the number shown (`Intl` knows each language's words and plurals). */
function unitWord(locale: string, unit: (typeof UNITS)[number], n: number): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: "unit", unit: UNIT[unit], unitDisplay: "long" }).formatToParts(n);
    return parts.find((part) => part.type === "unit")?.value ?? unit;
  } catch {
    return unit;
  }
}

/**
 * A countdown to a fixed moment (D560, `src/lib/countdown.ts`): days, hours, minutes and seconds left, ticking each second, the same for
 * every visitor. Drawn only in the browser (the time left is the visitor's clock's), and gone at zero, so a past offer is never announced.
 * A screen reader hears the end as a date once, not every second. In the builder (`preview`) an ended or unset timer shows zeros.
 */
export function CountdownView({ endsAt, title, boxes, preview = false }: { endsAt: string | null; title: string; boxes: boolean; preview?: boolean }) {
  // The visitor's clock, read each second; none on the server, so the first render agrees and the timer appears once the page is awake.
  const now = useSyncExternalStore(subscribeSeconds, currentSecond, noClock);
  if (now === null) return null;
  const left: TimeLeft | null = timeLeft(endsAt, now) ?? (preview ? { days: 0, hours: 0, minutes: 0, seconds: 0 } : null);
  if (!left) return null;
  const locale = document.documentElement.lang || "en";
  const end = endsAt ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(new Date(endsAt)) : "";
  return (
    <div className="flex flex-col gap-3" data-countdown="">
      {title && (
        <p className="font-medium">
          {title}
        </p>
      )}
      {end && <p className="sr-only">{end}</p>}
      <div role="timer" aria-hidden className="flex flex-wrap gap-2">
        {UNITS.map((unit) => (
          <span
            key={unit}
            className={`flex min-w-16 flex-col items-center ${boxes ? "rounded-md border border-border bg-surface px-3 py-2" : "px-1"}`}
          >
            <span className="text-3xl font-semibold tabular-nums">
              {String(left[unit]).padStart(unit === "days" ? 1 : 2, "0")}
            </span>
            <span className="text-xs text-muted">
              {unitWord(locale, unit, left[unit])}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
