"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { t } from "@/lib/i18n";

import { usePageLanguage } from "./page-language";

/** The most logos seen at once (`GRID_COLUMNS_MAX.desktop`): a keeps-moving strip repeats the logos until one copy is this many. */
const MOST_AT_ONCE = 8;

/**
 * Brands as a carousel (D204): a strip that keeps moving (CSS only, so it runs without a script; `speed` is the seconds each logo
 * takes to pass) or one that steps a logo at a time every `interval` seconds. Both stop for a visitor who prefers less motion (the
 * strip is then a row to scroll) and pause under the pointer or focus. The logos in view are `--brand-cols`,
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
  movement: "continuous" | "snap" | "none";
  speed: number;
  interval: number;
  gap: number;
  label: string;
}) {
  const m = t(usePageLanguage());
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

  const still = held || calm;
  // Moved by the visitor only (D205): arrows on a computer, a swipe on a phone; an arrow is off at its end.
  const [ends, setEnds] = useState({ start: true, end: false });
  useEffect(() => {
    const el = track.current;
    if (movement !== "none" || !el) return;
    const read = () =>
      setEnds({
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
    read();
    el.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      el.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [movement]);
  const step = (direction: 1 | -1) => {
    const el = track.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollBy({
      left: direction * (first.getBoundingClientRect().width + gap),
      behavior: calm ? "auto" : "smooth",
    });
  };
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
  const copies = moving
    ? Math.max(1, Math.ceil(MOST_AT_ONCE / Math.max(1, cells.length)))
    : 1;
  const set = (suffix: string, hidden: boolean) =>
    Array.from({ length: copies }, (_, copy) =>
      cells.map((cell, i) => (
        <li
          key={`${suffix}${copy}-${i}`}
          className="kz-brand"
          aria-hidden={hidden || undefined}
          // The copy only continues the strip: its links are not reached by the keyboard either.
          inert={hidden || undefined}
        >
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
      data-moved-by={movement === "none" ? "visitor" : undefined}
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
            style={
              {
                animationDuration: `${speed * cells.length * copies}s`,
              } as CSSProperties
            }
          >
            {set("a", false)}
            {/* The second copy only continues the first at its end; screen readers read the first. */}
            {set("b", true)}
          </ul>
        </div>
      ) : movement === "none" ? (
        <div className="kz-brands-stepper">
          <button
            type="button"
            className="kz-brands-arrow"
            aria-label={m.carouselPrevious}
            disabled={ends.start}
            onClick={() => step(-1)}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <ul
            ref={track}
            data-brands=""
            className="kz-brands-track kz-brands-snap"
          >
            {set("a", false)}
          </ul>
          <button
            type="button"
            className="kz-brands-arrow"
            aria-label={m.carouselNext}
            disabled={ends.end}
            onClick={() => step(1)}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      ) : (
        <ul
          ref={track}
          data-brands=""
          className="kz-brands-track kz-brands-snap"
        >
          {set("a", false)}
        </ul>
      )}
    </div>
  );
}
