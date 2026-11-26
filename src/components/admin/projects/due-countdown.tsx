"use client";

import { useEffect, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import { countdown } from "@/lib/projects-views";

/**
 * How long is left until a list is due (D903 P4.8, Life's `due-countdown.tsx`): "3d, 4h left", or "2h, 10m late" in the danger colour,
 * drawn first from the page's own time and kept true every half minute while the page is open. The units are the person's language's own.
 */
export function DueCountdown({ target, now: first, locale, words }: { target: number; now: number; locale: string; words: { left: string; late: string } }) {
  const [now, setNow] = useState(first);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  const c = countdown(target, now);
  const unit = (n: number, name: "day" | "hour" | "minute") => new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "narrow" }).format(n);
  const parts = c.days > 0 ? [unit(c.days, "day"), unit(c.hours, "hour")] : c.hours > 0 ? [unit(c.hours, "hour"), unit(c.minutes, "minute")] : [unit(c.minutes, "minute")];
  const time = new Intl.ListFormat(locale, { type: "unit", style: "narrow" }).format(parts);
  return <span className={c.late ? "text-danger-text" : undefined}>{fillWords(c.late ? words.late : words.left, { time })}</span>;
}
