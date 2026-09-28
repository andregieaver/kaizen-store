"use client";

import { t } from "@/lib/i18n";

import { usePageLanguage } from "./page-language";

/** A rating of 1–5 as stars, read out as "4 out of 5 stars" in the page's language. */
export function StarRating({ stars, className = "" }: { stars: number; className?: string }) {
  const m = t(usePageLanguage());
  const whole = Math.round(Math.min(5, Math.max(0, stars)));
  return (
    <span role="img" aria-label={m.ratedOutOf5(Math.round(stars * 10) / 10)} className={`inline-flex gap-0.5 text-amber-500 ${className}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} aria-hidden viewBox="0 0 20 20" className={`size-4 ${n <= whole ? "" : "opacity-25"}`} fill="currentColor">
          <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" />
        </svg>
      ))}
    </span>
  );
}
