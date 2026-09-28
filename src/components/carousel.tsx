"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { t } from "@/lib/i18n";

import { usePageLanguage } from "./page-language";

/**
 * Tiles in a row that scrolls sideways (D91): a content grid's or
 * testimonials' shown as a carousel. The row is the browser's own
 * scrolling, snapping to a tile, so it follows touch, trackpads and the
 * keyboard (tabbing to a tile's link brings it into view); the arrows move
 * it a screenful at a time and are off at either end. Nothing moves by
 * itself. Its list is drawn by the server, `data-carousel-track` marking it.
 */
export function Carousel({ children }: { children: ReactNode }) {
  const m = t(usePageLanguage());
  const box = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: false });

  useEffect(() => {
    const track = box.current?.querySelector<HTMLElement>("[data-carousel-track]");
    if (!track) return;
    const follow = () => {
      const max = track.scrollWidth - track.clientWidth;
      // Right-to-left pages scroll to negative positions.
      const at = Math.abs(track.scrollLeft);
      setEnds({ start: at <= 1, end: at >= max - 1 });
    };
    follow();
    track.addEventListener("scroll", follow, { passive: true });
    const resized = new ResizeObserver(follow);
    resized.observe(track);
    return () => {
      track.removeEventListener("scroll", follow);
      resized.disconnect();
    };
  }, []);

  const move = (direction: 1 | -1) => {
    const track = box.current?.querySelector<HTMLElement>("[data-carousel-track]");
    if (!track) return;
    const rtl = getComputedStyle(track).direction === "rtl" ? -1 : 1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: direction * rtl * track.clientWidth * 0.9, behavior: reduce ? "auto" : "smooth" });
  };

  const arrow =
    "flex size-10 items-center justify-center rounded-full border border-border bg-background shadow-sm transition hover:bg-surface disabled:pointer-events-none disabled:opacity-0";
  return (
    <div ref={box} role="group" aria-roledescription={m.carousel} className="relative">
      {children}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => move(-1)} disabled={ends.start} aria-label={m.carouselPrevious} className={arrow}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button type="button" onClick={() => move(1)} disabled={ends.end} aria-label={m.carouselNext} className={arrow}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
