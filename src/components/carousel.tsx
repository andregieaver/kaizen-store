"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createCarouselController, type CarouselController, type CarouselState, type Scroller } from "@/lib/carousel-controller";
import { resolveCarousel, type CarouselSettings } from "@/lib/carousel-settings";
import { t } from "@/lib/i18n";

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
 * round, and an optional autoplay. What they do is `createCarouselController`'s
 * (tested without a browser); this only measures the row and passes on what
 * the visitor does. The dots and the Pause/Play button are drawn once the
 * script runs, as without it they would do nothing. Nothing moves by itself
 * unless the owner switched autoplay on, and then never under reduced motion.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const INITIAL: CarouselState = { atStart: true, atEnd: false, canPrev: false, canNext: true, pages: 0, page: 0, autoplay: "off" };

/** The row as the controller moves it: positions from the start, whichever way the page reads. */
function trackScroller(track: HTMLElement): Scroller {
  const sign = () => (getComputedStyle(track).direction === "rtl" ? -1 : 1);
  return {
    metrics() {
      const tiles = track.children;
      const first = tiles[0] as HTMLElement | undefined;
      const second = tiles[1] as HTMLElement | undefined;
      const tileWidth = first?.getBoundingClientRect().width ?? 0;
      return {
        // Right-to-left pages scroll to negative positions.
        scroll: Math.abs(track.scrollLeft),
        max: track.scrollWidth - track.clientWidth,
        width: track.clientWidth,
        tiles: tiles.length,
        tileWidth,
        pitch: first && second ? Math.abs(second.offsetLeft - first.offsetLeft) : tileWidth,
      };
    },
    scrollTo: (position, smooth) => track.scrollTo({ left: sign() * position, behavior: smooth ? "smooth" : "auto" }),
    scrollBy: (distance, smooth) => track.scrollBy({ left: sign() * distance, behavior: smooth ? "smooth" : "auto" }),
  };
}

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

/**
 * A row nobody can tab into is a row a keyboard cannot scroll (Safari does not make scrollers focusable): tiles with no link
 * (custom items may have none, testimonials never do), with the arrows and dots off. Then the row itself takes a tab stop and a
 * name, so the arrow keys scroll it (WCAG 2.1.1); with anything else to tab to, it keeps none.
 */
function keepRowReachable(root: HTMLElement, track: HTMLElement, name: string) {
  const reachable = (element: Element) => element !== track && element.getAttribute("tabindex") !== "-1" && !element.hasAttribute("disabled");
  const needed = track.scrollWidth > track.clientWidth + 1 && !Array.from(root.querySelectorAll(FOCUSABLE)).some(reachable);
  if (needed) {
    track.tabIndex = 0;
    track.setAttribute("aria-label", name);
    track.dataset.carouselFocus = "";
  } else if (track.dataset.carouselFocus !== undefined) {
    // Only what this put there is taken away again.
    track.removeAttribute("tabindex");
    track.removeAttribute("aria-label");
    delete track.dataset.carouselFocus;
  }
}

export function Carousel({ children, settings, phonesOnly = false }: { children: ReactNode; settings?: CarouselSettings; phonesOnly?: boolean }) {
  const m = t(usePageLanguage());
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CarouselState>(INITIAL);
  const controller = useRef<CarouselController | null>(null);
  // A key of the settings, so a new object with the same settings does not start everything again.
  const key = JSON.stringify(resolveCarousel(settings));
  const resolved = useMemo(() => JSON.parse(key) as ReturnType<typeof resolveCarousel>, [key]);

  useEffect(() => {
    const root = box.current;
    const track = root?.querySelector<HTMLElement>("[data-carousel-track]");
    if (!root || !track) return;
    const media = window.matchMedia(REDUCED_MOTION);
    // A page drawn in the admin (the builder's canvas, a template's preview) is being edited, not read: it does not play by itself.
    const editing = root.closest("[data-theme-canvas], [data-theme-preview]") !== null;
    const ctl = createCarouselController({
      scroller: trackScroller(track),
      settings: editing ? { ...resolved, autoplay: null } : resolved,
      reducedMotion: media.matches,
      hidden: document.hidden,
      onChange: setState,
    });
    controller.current = ctl;
    const name = m.carousel;
    const reachable = () => keepRowReachable(root, track, name);
    const follow = () => ctl.refresh();
    const changed = () => {
      ctl.refresh();
      reachable();
    };
    track.addEventListener("scroll", follow, { passive: true });
    const resized = new ResizeObserver(changed);
    resized.observe(track);
    // Tiles added or taken away (the builder's canvas while an owner edits the items) change what the row scrolls through but not
    // its own box, which the observer above watches: the dots, arrows and the Pause button follow them too.
    const tiles = new MutationObserver(changed);
    tiles.observe(track, { childList: true });
    reachable();

    // What the visitor does with the carousel. Its own Pause/Play button is not one of these: it is the way to stop.
    const own = (event: Event) => !(event.target instanceof Element && event.target.closest("[data-carousel-toggle]"));
    const interacted = (event: Event) => {
      if (own(event)) ctl.interact();
    };
    const over = () => ctl.hover(true);
    const left = () => ctl.hover(false);
    const hide = () => ctl.setHidden(document.hidden);
    const motion = () => ctl.setReducedMotion(media.matches);
    const touched = ["pointerdown", "keydown", "focusin"] as const;
    for (const type of touched) root.addEventListener(type, interacted);
    // Scrolling by wheel or finger: `touchstart` and `wheel` are the visitor's, a smooth scroll of its own is not.
    root.addEventListener("wheel", interacted, { passive: true });
    root.addEventListener("touchstart", interacted, { passive: true });
    root.addEventListener("pointerenter", over);
    root.addEventListener("pointerleave", left);
    document.addEventListener("visibilitychange", hide);
    media.addEventListener("change", motion);
    return () => {
      ctl.destroy();
      controller.current = null;
      track.removeEventListener("scroll", follow);
      resized.disconnect();
      tiles.disconnect();
      for (const type of touched) root.removeEventListener(type, interacted);
      root.removeEventListener("wheel", interacted);
      root.removeEventListener("touchstart", interacted);
      root.removeEventListener("pointerenter", over);
      root.removeEventListener("pointerleave", left);
      document.removeEventListener("visibilitychange", hide);
      media.removeEventListener("change", motion);
    };
  }, [resolved, m.carousel]);

  // The dots and the arrows come and go with the page count: the row may need a tab stop of its own, or no longer.
  useEffect(() => {
    const root = box.current;
    const track = root?.querySelector<HTMLElement>("[data-carousel-track]");
    if (root && track) keepRowReachable(root, track, m.carousel);
  }, [state.pages, state.canNext, state.canPrev, resolved, m.carousel]);

  // Nothing is announced while it plays by itself; after a stop by hand, what shows is told politely.
  useEffect(() => {
    const track = box.current?.querySelector<HTMLElement>("[data-carousel-track]");
    if (!track) return;
    if (state.autoplay === "off") track.removeAttribute("aria-live");
    else track.setAttribute("aria-live", state.autoplay === "playing" ? "off" : "polite");
  }, [state.autoplay]);

  const arrow =
    "flex size-10 items-center justify-center rounded-full border border-border bg-background shadow-sm transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-0";
  const icon = { "aria-hidden": true, viewBox: "0 0 24 24", className: "size-5", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const dots = resolved.dots && state.pages > 1;
  const toggle = state.autoplay !== "off";
  return (
    <div ref={box} role="group" aria-roledescription={m.carousel} className="relative">
      {children}
      {(resolved.arrows || dots || toggle) && (
        <div className={`mt-4 flex items-center gap-3 ${phonesOnly ? "md:hidden" : ""}`}>
          {toggle && (
            <button
              type="button"
              data-carousel-toggle=""
              onClick={() => controller.current?.toggle()}
              aria-label={state.autoplay === "playing" ? m.carouselPause : m.carouselPlay}
              className={arrow}
            >
              {state.autoplay === "playing" ? (
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
          {dots && (
            <div role="group" aria-label={m.carouselPages} className="flex flex-1 flex-wrap items-center justify-center">
              {Array.from({ length: state.pages }, (_, page) => (
                <button
                  key={page}
                  type="button"
                  data-carousel-dot=""
                  onClick={() => controller.current?.goTo(page)}
                  aria-label={m.carouselGoTo(page + 1, state.pages)}
                  aria-current={page === state.page ? "true" : undefined}
                  className="group flex size-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-0"
                >
                  <span
                    aria-hidden
                    className={`block size-2.5 rounded-full border border-foreground transition ${page === state.page ? "bg-foreground" : "bg-transparent group-hover:bg-foreground/40"}`}
                  />
                </button>
              ))}
            </div>
          )}
          {resolved.arrows && (
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => controller.current?.prev()} disabled={!state.canPrev} aria-label={m.carouselPrevious} className={arrow}>
                <svg {...icon}>
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button type="button" onClick={() => controller.current?.next()} disabled={!state.canNext} aria-label={m.carouselNext} className={arrow}>
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
