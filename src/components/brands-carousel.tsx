"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { t } from "@/lib/i18n";

import { usePageLanguage } from "./page-language";

/** The most logos seen at once (`GRID_COLUMNS_MAX.desktop`): a keeps-moving strip repeats the logos until one copy is this many. */
const MOST_AT_ONCE = 8;

/**
 * Brands as a carousel (D204): a strip that keeps moving (CSS only, so it runs without a script; `speed` is the seconds each logo
 * takes to pass) or one that steps a logo at a time every `interval` seconds. Both stop for a visitor who prefers less motion (the
 * strip is then a row to scroll), pause under the pointer or focus, and have a Pause button. The logos in view are `--brand-cols`,
 * set per screen size by the block's rules (`blockStyle()`).
 */
export function BrandsCarousel({
  cells,
  movement,
  speed,
  interval,
  gap,
  label,
}: {
  cells: ReactNode[];
  movement: "continuous" | "snap";
  speed: number;
  interval: number;
  gap: number;
  label: string;
}) {
  const m = t(usePageLanguage());
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [calm, setCalm] = useState(false);
  const track = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setCalm(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  const still = paused || held || calm;
  useEffect(() => {
    if (movement !== "snap" || still) return;
    const timer = window.setInterval(() => {
      const el = track.current;
      const first = el?.children[0] as HTMLElement | undefined;
      if (!el || !first) return;
      const step = first.getBoundingClientRect().width + gap;
      const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      el.scrollTo({ left: end ? 0 : el.scrollLeft + step, behavior: "smooth" });
    }, interval * 1000);
    return () => window.clearInterval(timer);
  }, [movement, still, interval, gap]);

  const moving = movement === "continuous";
  const copies = moving ? Math.max(1, Math.ceil(MOST_AT_ONCE / Math.max(1, cells.length))) : 1;
  const set = (suffix: string, hidden: boolean) =>
    Array.from({ length: copies }, (_, copy) =>
      cells.map((cell, i) => (
        <li key={`${suffix}${copy}-${i}`} className="kz-brand" aria-hidden={hidden || undefined}>
          {cell}
        </li>
      )),
    );

  return (
    <div
      role="group"
      aria-roledescription={m.carousel}
      aria-label={label}
      className="kz-brands-carousel"
      data-movement={movement}
      data-still={still ? "" : undefined}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {moving ? (
        <div className="kz-brands-window">
          <ul
            data-brands=""
            className="kz-brands-track kz-brands-marquee"
            style={{ animationDuration: `${speed * cells.length * copies}s` } as CSSProperties}
          >
            {set("a", false)}
            {/* The second copy only continues the first at its end; screen readers read the first. */}
            {set("b", true)}
          </ul>
        </div>
      ) : (
        <ul ref={track} data-brands="" className="kz-brands-track kz-brands-snap">
          {set("a", false)}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-label={paused ? m.carouselPlay : m.carouselPause}
        aria-pressed={paused}
        className="kz-brands-toggle"
        hidden={calm}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          {paused ? <path d="m8 5 11 7-11 7z" /> : <path d="M9 5v14M15 5v14" />}
        </svg>
      </button>
    </div>
  );
}
