import { activePage, pageOffsets, type ResolvedCarousel, type TrackMetrics } from "./carousel-settings";

/**
 * What a carousel does when a button is pressed or time passes (D155, B): the
 * arrows' ends, going round, the dots' pages and autoplay, without the DOM so
 * it is tested with a fake scroller (`carousel-controller.test.ts`) and drawn
 * by `Carousel`, which only measures the row and listens for what the visitor
 * does.
 *
 * Autoplay is safe by construction:
 * - it never starts under reduced motion, and stops if that turns on;
 * - it stops for good the moment the visitor does anything with the carousel
 *   (`interact()`: scrolling, dragging, focus inside, an arrow or a dot);
 * - it holds while the pointer is over it and while the tab is hidden, and
 *   goes on after;
 * - at the last page it goes round only with `rewind`, otherwise it stops;
 * - with it on, a Pause/Play button is always there (`autoplay` is "playing"
 *   or "paused"), the only way to start it again, and by hand only.
 */

/** The row as the controller sees it: measured and moved in positions counted from the start whichever way the page reads. */
export type Scroller = {
  metrics(): TrackMetrics;
  /** To a position. */
  scrollTo(position: number, smooth: boolean): void;
  /** By a distance, forwards when positive. */
  scrollBy(distance: number, smooth: boolean): void;
};

export type CarouselState = {
  /** The row is at its first tile / at its last. */
  atStart: boolean;
  atEnd: boolean;
  /** What the arrows can do: the next one also at the end when it goes round. */
  canPrev: boolean;
  canNext: boolean;
  /** Pages of tiles (the dots) and the one the row rests at. */
  pages: number;
  page: number;
  /** "off": nothing plays by itself (no autoplay, reduced motion or one page); "playing" and "paused" show the Pause/Play button. */
  autoplay: "off" | "playing" | "paused";
};

/** How far an arrow moves: a screenful, less a little so the next tile shows what came before. */
export const ARROW_STEP = 0.9;

export type CarouselController = {
  state(): CarouselState;
  /** Measure again: after scrolling, resizing or drawing. */
  refresh(): void;
  /** The arrows and dots: the visitor's own moves, which also stop autoplay for good. */
  next(): void;
  prev(): void;
  goTo(page: number): void;
  /** The Pause/Play button. Never starts anything under reduced motion. */
  toggle(): void;
  /** The visitor did something with the carousel (scrolled, dragged, focused inside, pressed): autoplay stops for good. */
  interact(): void;
  /** The pointer is over the carousel, or left it. */
  hover(over: boolean): void;
  /** The tab is hidden, or shown. */
  setHidden(hidden: boolean): void;
  /** The visitor prefers reduced motion, or no longer does. */
  setReducedMotion(reduced: boolean): void;
  destroy(): void;
};

export function createCarouselController(options: {
  scroller: Scroller;
  settings: ResolvedCarousel;
  reducedMotion?: boolean;
  hidden?: boolean;
  onChange?: (state: CarouselState) => void;
}): CarouselController {
  const { scroller, settings, onChange } = options;
  let reduced = options.reducedMotion === true;
  let hidden = options.hidden === true;
  let hovering = false;
  // Stopped by the visitor, by the end of the row, or by reduced motion: autoplay waits for the button.
  let stopped = reduced;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  let last = "";

  const smooth = () => !reduced;

  const compute = (): CarouselState => {
    const m = scroller.metrics();
    const offsets = pageOffsets(m);
    const atStart = m.scroll <= 1;
    const atEnd = m.scroll >= m.max - 1;
    const scrolls = m.max > 1;
    return {
      atStart,
      atEnd,
      canPrev: !atStart,
      canNext: scrolls && (!atEnd || settings.rewind),
      pages: offsets.length,
      page: activePage(offsets, m.scroll),
      autoplay: !settings.autoplay || reduced || offsets.length <= 1 ? "off" : stopped ? "paused" : "playing",
    };
  };

  const emit = () => {
    const state = compute();
    const key = JSON.stringify(state);
    if (key === last) return state;
    last = key;
    onChange?.(state);
    return state;
  };

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  /** One timer at a time, only while playing and not held; a scroll that follows a move does not restart it. */
  const schedule = () => {
    if (destroyed || timer !== undefined) return;
    if (!settings.autoplay || compute().autoplay !== "playing" || hovering || hidden) return;
    timer = setTimeout(tick, settings.autoplay.seconds * 1000);
  };

  const tick = () => {
    timer = undefined;
    if (destroyed) return;
    const m = scroller.metrics();
    const offsets = pageOffsets(m);
    const page = activePage(offsets, m.scroll);
    if (page < offsets.length - 1) scroller.scrollTo(offsets[page + 1], smooth());
    else if (settings.rewind && offsets.length > 1) scroller.scrollTo(offsets[0], smooth());
    else stopped = true;
    emit();
    schedule();
  };

  const stop = () => {
    if (!settings.autoplay) return;
    stopped = true;
    clear();
    emit();
  };

  const interact = () => stop();

  const forward = () => {
    const m = scroller.metrics();
    if (m.max <= 1) return;
    if (m.scroll >= m.max - 1) {
      if (settings.rewind) scroller.scrollTo(0, smooth());
      return;
    }
    scroller.scrollBy(m.width * ARROW_STEP, smooth());
  };

  const controller: CarouselController = {
    state: compute,
    refresh() {
      emit();
      // The row may have grown to hold more than one page, or shrunk to one.
      if (timer !== undefined && compute().autoplay !== "playing") clear();
      schedule();
    },
    next() {
      interact();
      forward();
    },
    prev() {
      interact();
      const m = scroller.metrics();
      if (m.scroll <= 1) return;
      scroller.scrollBy(-m.width * ARROW_STEP, smooth());
    },
    goTo(page) {
      interact();
      const offsets = pageOffsets(scroller.metrics());
      if (page < 0 || page >= offsets.length) return;
      scroller.scrollTo(offsets[page], smooth());
    },
    toggle() {
      if (!settings.autoplay) return;
      const state = compute();
      if (state.autoplay === "playing") {
        stop();
        return;
      }
      if (reduced) return;
      // Playing again from the end begins at the first page, as it would if it went on.
      const m = scroller.metrics();
      if (state.atEnd && m.max > 1) scroller.scrollTo(0, smooth());
      stopped = false;
      emit();
      schedule();
    },
    interact,
    hover(over) {
      hovering = over;
      if (over) clear();
      else schedule();
    },
    setHidden(value) {
      hidden = value;
      if (value) clear();
      else schedule();
    },
    setReducedMotion(value) {
      reduced = value;
      if (value) {
        stopped = true;
        clear();
      }
      emit();
    },
    destroy() {
      destroyed = true;
      clear();
    },
  };

  // Starts as soon as there is something to play.
  emit();
  schedule();
  return controller;
}
