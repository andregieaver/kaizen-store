"use client";

import { useRef, useSyncExternalStore, type ReactNode } from "react";

import type { CarouselSettings } from "@/lib/carousel-settings";
import { browserText as t } from "@/lib/browser-text";

import { CarouselArrows } from "./carousel-arrows";
import { CarouselControls } from "./lazy/blocks";
import { usePageLanguage } from "./page-language";

/**
 * Tiles in a row that scrolls sideways (D91): a content grid's or
 * testimonials' shown as a carousel. The row is the browser's own
 * scrolling, snapping to a tile, so it follows touch, trackpads and the
 * keyboard (tabbing to a tile's link brings it into view) and works without
 * JavaScript: the track scrolls and every link in it works. Its list is drawn
 * by the server, `data-carousel-track` marking it.
 *
 * On top of that (D155, `CarouselSettings`): arrows (the default), dots, going
 * round, and an optional autoplay, which are `CarouselControls`'
 * (`carousel-controls.tsx`). This frame is all a page's first scripts carry
 * (bloat review step 0.16): the group, the server's row and the arrows as the
 * server draws them. Once in the browser it draws the controls, loaded where a
 * carousel is drawn (`lazy/blocks.tsx`), never as a stand-in's fallback around
 * the row, so a page read without JavaScript holds its tiles once. A press on
 * an arrow before the controls are here is kept and made when they arrive. The dots
 * and the Pause/Play button are drawn once the controls' script runs, as
 * without it they would do nothing.
 */
export function Carousel({ children, settings }: { children: ReactNode; settings?: CarouselSettings }) {
  const m = t(usePageLanguage());
  const box = useRef<HTMLDivElement>(null);
  // A press on an arrow before the controls are here: kept, and made by the controls as they arrive.
  const pressedRef = useRef<"prev" | "next" | null>(null);
  // False on the server and while the page wakes up, so the first render is the server's; true after.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  // Before the controls' script: the arrows (on unless switched off, as `resolveCarousel()` reads them), Previous off and Next on;
  // a press is kept for the controls.
  const still =
    settings?.arrows !== false ? (
      // Hidden where the grid is not a carousel (D179: its list's rules, `gridListStyle()`).
      <div data-carousel-controls="" className="mt-4 flex items-center gap-3">
        <CarouselArrows
          previous={m.carouselPrevious}
          next={m.carouselNext}
          onPrev={() => (pressedRef.current = "prev")}
          onNext={() => (pressedRef.current = "next")}
        />
      </div>
    ) : null;
  return (
    <div ref={box} role="group" aria-roledescription={m.carousel} className="relative">
      {children}
      {inBrowser ? <CarouselControls box={box} pressedRef={pressedRef} settings={settings} still={still} /> : still}
    </div>
  );
}

const noSubscribe = () => () => {};
