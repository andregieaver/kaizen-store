"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { resolveCarousel, type CarouselSettings } from "@/lib/carousel-settings";
import { stepSlide } from "@/lib/slide-step";
import { t } from "@/lib/i18n";

import { usePageLanguage } from "./page-language";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** How far a finger moves across before it is a swipe. */
const SWIPE_PX = 40;

/**
 * A gallery's carousel of one tile at a time that fades from tile to tile (D210). The tiles lie on top of one another and only the
 * one shown can be reached (the others are `inert`); it follows the carousel's own settings (D155): the arrows, the dots, going
 * back to the first, and autoplay, which never runs for visitors who prefer less motion, stops for good at any interaction, waits
 * under the pointer or while the tab is hidden, and always has a Pause button. A swipe across the tile goes to the next or the
 * previous, as a sliding carousel's does (the tile does not open the lightbox at the end of a swipe), while a swipe up or down
 * still scrolls the page (`touch-action: pan-y`). Under reduced motion a change is instant. Without a
 * script the tiles are a row to scroll (`@media (scripting: none)` in `globals.css`), so every one is still there.
 */
export function GalleryFade({
  tiles,
  settings,
  fadeMs,
  gap,
}: {
  tiles: { key: string; node: ReactNode }[];
  settings?: CarouselSettings;
  fadeMs: number;
  gap: number;
}) {
  const m = t(usePageLanguage());
  const resolved = resolveCarousel(settings);
  const count = tiles.length;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [held, setHeld] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const timerRef = useRef(0);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const seconds = resolved.autoplay?.seconds ?? null;

  // Autoplay starts only for visitors who do not prefer less motion, and never in the builder's canvas or a preview.
  useEffect(() => {
    if (seconds === null || count < 2) return;
    const editing = box.current?.closest("[data-theme-canvas], [data-theme-preview]") !== null;
    const media = window.matchMedia(REDUCED_MOTION);
    const follow = () => setPlaying(!editing && !media.matches);
    follow();
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [seconds, count]);

  // Without going round it has nowhere to go from the last tile: it stops there.
  const atEnd = !resolved.rewind && index >= count - 1;
  const running = playing && !stopped && !atEnd;
  useEffect(() => {
    if (!running || held || seconds === null) return;
    const timer = window.setTimeout(function advance() {
      if (document.hidden) return void (timerRef.current = window.setTimeout(advance, 1000));
      setIndex((current) => stepSlide(current, 1, count));
    }, seconds * 1000);
    timerRef.current = timer;
    return () => window.clearTimeout(timerRef.current);
  }, [running, held, seconds, count, index]);

  const go = (to: number) => {
    setStopped(true);
    setIndex(to);
  };
  const canPrev = resolved.rewind || index > 0;
  const canNext = resolved.rewind || index < count - 1;
  const step = (by: 1 | -1) => {
    if (by === 1 ? canNext : canPrev) go(stepSlide(index, by, count));
  };
  const arrow =
    "flex size-10 items-center justify-center rounded-full border border-border bg-background shadow-sm transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-0";
  const icon = { "aria-hidden": true, viewBox: "0 0 24 24", className: "size-5", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const autoplay = seconds !== null && count > 1 && (playing || stopped);

  return (
    <div
      ref={box}
      role="group"
      aria-roledescription={m.carousel}
      className="kz-fade-box relative"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onPointerDown={(event) => {
        if (!(event.target instanceof Element && event.target.closest("[data-carousel-toggle]"))) setStopped(true);
      }}
      onFocus={(event) => {
        if (!(event.target instanceof Element && event.target.closest("[data-carousel-toggle]"))) setStopped(true);
      }}
    >
      <ul
        data-gallery=""
        data-fade=""
        className="kz-fade"
        style={{ "--fade-ms": `${fadeMs}ms`, "--gap": `${gap}px` } as CSSProperties}
        aria-live={stopped && seconds !== null ? "polite" : "off"}
        onPointerDown={(event) => {
          swiped.current = false;
          swipe.current = event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
        }}
        onPointerUp={(event) => {
          const from = swipe.current;
          swipe.current = null;
          if (!from || from.id !== event.pointerId || count < 2) return;
          const dx = event.clientX - from.x;
          const dy = event.clientY - from.y;
          // Across, and more across than down: a swipe, not a press or a scroll.
          if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          swiped.current = true;
          step(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => (swipe.current = null)}
        onClickCapture={(event) => {
          // The press that ends a swipe opens nothing.
          if (!swiped.current) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {tiles.map((tile, i) => (
          <li
            key={tile.key}
            className="kz-gallery-tile kz-fade-slide"
            data-on={i === index ? "" : undefined}
            aria-hidden={i === index ? undefined : true}
            inert={i === index ? undefined : true}
          >
            {tile.node}
          </li>
        ))}
      </ul>
      {count > 1 && (resolved.arrows || resolved.dots || autoplay) && (
        <div data-carousel-controls="" className="mt-4 flex items-center gap-3">
          {autoplay && (
            <button
              type="button"
              data-carousel-toggle=""
              onClick={() => {
                if (running) setStopped(true);
                else {
                  setStopped(false);
                  setPlaying(true);
                }
              }}
              aria-label={running ? m.carouselPause : m.carouselPlay}
              className={arrow}
            >
              {running ? (
                <svg {...icon}>
                  <path d="M9 5v14M15 5v14" />
                </svg>
              ) : (
                <svg {...icon}>
                  <path d="m8 5 11 7-11 7z" />
                </svg>
              )}
            </button>
          )}
          {resolved.dots && (
            <div role="group" aria-label={m.carouselPages} className="flex flex-1 flex-wrap items-center justify-center">
              {tiles.map((tile, i) => (
                <button
                  key={tile.key}
                  type="button"
                  data-carousel-dot=""
                  onClick={() => go(i)}
                  aria-label={m.carouselGoTo(i + 1, count)}
                  aria-current={i === index ? "true" : undefined}
                  className="group flex size-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-0"
                >
                  <span aria-hidden className={`block size-2.5 rounded-full border border-foreground transition ${i === index ? "bg-foreground" : "bg-transparent group-hover:bg-foreground/40"}`} />
                </button>
              ))}
            </div>
          )}
          {resolved.arrows && (
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => step(-1)} disabled={!canPrev} aria-label={m.carouselPrevious} className={arrow}>
                <svg {...icon}>
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button type="button" onClick={() => step(1)} disabled={!canNext} aria-label={m.carouselNext} className={arrow}>
                <svg {...icon}>
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
