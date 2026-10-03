import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCarouselController, type CarouselController, type CarouselState, type Scroller } from "./carousel-controller";
import { resolveCarousel, type CarouselSettings, type TrackMetrics } from "./carousel-settings";

/**
 * A row that scrolls, without a browser: 9 tiles of 100 pixels seen through 300, so three pages (0, 300, 600). A scroll
 * moves at once, as the browser's does when it is not smooth, and keeps what was asked for.
 */
class FakeRow implements Scroller {
  scroll = 0;
  moves: { to: number; smooth: boolean }[] = [];
  /** The browser's scroll event. */
  onScroll: () => void = () => {};
  constructor(
    public tiles = 9,
    public width = 300,
    public tile = 100,
  ) {}
  get max() {
    return Math.max(0, this.tiles * this.tile - this.width);
  }
  metrics(): TrackMetrics {
    return { scroll: this.scroll, max: this.max, width: this.width, tiles: this.tiles, tileWidth: this.tile, pitch: this.tile };
  }
  scrollTo(position: number, smooth: boolean) {
    this.scroll = Math.min(this.max, Math.max(0, position));
    this.moves.push({ to: this.scroll, smooth });
    this.onScroll();
  }
  scrollBy(distance: number, smooth: boolean) {
    // A snapping row comes to rest on a tile.
    const target = this.scroll + distance;
    this.scrollTo(Math.round(target / this.tile) * this.tile, smooth);
  }
}

const make = (settings: CarouselSettings = {}, options: { row?: FakeRow; reducedMotion?: boolean; hidden?: boolean } = {}) => {
  const row = options.row ?? new FakeRow();
  const seen: CarouselState[] = [];
  const controller = createCarouselController({
    scroller: row,
    settings: resolveCarousel(settings),
    reducedMotion: options.reducedMotion,
    hidden: options.hidden,
    onChange: (state) => seen.push(state),
  });
  row.onScroll = () => controller.refresh();
  return { row, controller, seen };
};
const SECONDS = 1000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the arrows", () => {
  it("are off at either end: previous at the start, next at the last tile", () => {
    const { row, controller } = make();
    expect(controller.state()).toMatchObject({ atStart: true, atEnd: false, canPrev: false, canNext: true });
    controller.next();
    expect(row.scroll).toBe(300);
    expect(controller.state()).toMatchObject({ canPrev: true, canNext: true });
    controller.next();
    controller.next();
    expect(row.scroll).toBe(row.max);
    expect(controller.state()).toMatchObject({ atEnd: true, canPrev: true, canNext: false });
    // At the end next does nothing.
    const moves = row.moves.length;
    controller.next();
    expect(row.moves.length).toBe(moves);
    controller.prev();
    expect(controller.state()).toMatchObject({ atEnd: false, canNext: true });
  });

  it("move a screenful less a tenth, snapping to a tile, and do not move at the start going back", () => {
    const { row, controller } = make();
    controller.prev();
    expect(row.moves).toEqual([]);
    controller.next();
    expect(row.moves).toEqual([{ to: 300, smooth: true }]);
  });

  it("are both off when everything fits", () => {
    const { controller } = make({}, { row: new FakeRow(2, 300, 100) });
    expect(controller.state()).toMatchObject({ atStart: true, atEnd: true, canPrev: false, canNext: false, pages: 1 });
  });

  it("scroll without smoothness under reduced motion", () => {
    const { row, controller } = make({}, { reducedMotion: true });
    controller.next();
    expect(row.moves).toEqual([{ to: 300, smooth: false }]);
  });

  it("follow the row when it is scrolled by hand", () => {
    const { row, controller, seen } = make();
    row.scroll = row.max;
    controller.refresh();
    expect(seen.at(-1)).toMatchObject({ atEnd: true, canNext: false, page: 2 });
  });
});

describe("rewind", () => {
  it("sends the next arrow from the end back to the first tile, with the real tiles only", () => {
    const { row, controller } = make({ rewind: true });
    controller.next();
    controller.next();
    expect(row.scroll).toBe(row.max);
    // Next stays on at the end.
    expect(controller.state()).toMatchObject({ atEnd: true, canNext: true });
    controller.next();
    expect(row.scroll).toBe(0);
    expect(controller.state()).toMatchObject({ atStart: true, canPrev: false, canNext: true });
    // Nothing was added to the row: the tiles are as many as before.
    expect(row.tiles).toBe(9);
  });

  it("does not go round without it", () => {
    const { row, controller } = make();
    row.scroll = row.max;
    controller.refresh();
    controller.next();
    expect(row.scroll).toBe(row.max);
  });

  it("does not offer next when there is nothing to scroll to", () => {
    const { controller } = make({ rewind: true }, { row: new FakeRow(2, 300, 100) });
    expect(controller.state().canNext).toBe(false);
  });
});

describe("the dots", () => {
  it("are one for each page and follow the scrolling", () => {
    const { row, controller, seen } = make({ dots: true });
    expect(controller.state()).toMatchObject({ pages: 3, page: 0 });
    controller.goTo(1);
    expect(row.scroll).toBe(300);
    expect(seen.at(-1)).toMatchObject({ page: 1 });
    controller.goTo(2);
    expect(row.scroll).toBe(600);
    expect(controller.state().page).toBe(2);
    row.scroll = 0;
    controller.refresh();
    expect(seen.at(-1)).toMatchObject({ page: 0 });
  });

  it("rest the last page at the end when it holds fewer tiles", () => {
    const row = new FakeRow(10);
    const { controller } = make({ dots: true }, { row });
    expect(controller.state().pages).toBe(4);
    controller.goTo(3);
    expect(row.scroll).toBe(row.max);
    expect(controller.state()).toMatchObject({ page: 3, atEnd: true });
  });

  it("are one page, so none to draw, when everything fits, and follow a resize", () => {
    const row = new FakeRow(4, 400, 100);
    const { controller, seen } = make({ dots: true }, { row });
    expect(controller.state().pages).toBe(1);
    row.width = 200;
    controller.refresh();
    expect(seen.at(-1)).toMatchObject({ pages: 2 });
  });

  it("ignore a page that is not there", () => {
    const { row, controller } = make({ dots: true });
    controller.goTo(7);
    controller.goTo(-1);
    expect(row.moves).toEqual([]);
  });
});

describe("autoplay", () => {
  it("is off unless asked for: nothing moves and there is no Pause button", () => {
    const { row, controller } = make();
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toEqual([]);
    expect(controller.state().autoplay).toBe("off");
  });

  it("moves a page every few seconds and shows the Pause button", () => {
    const { row, controller } = make({ autoplay: { seconds: 4 } });
    expect(controller.state().autoplay).toBe("playing");
    vi.advanceTimersByTime(3999);
    expect(row.moves).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(row.scroll).toBe(300);
    vi.advanceTimersByTime(4 * SECONDS);
    expect(row.scroll).toBe(600);
    expect(controller.state().page).toBe(2);
  });

  it("does not drift while the browser's own scroll events come in", () => {
    const { row, controller } = make({ autoplay: { seconds: 4 } });
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(500);
      controller.refresh();
    }
    // 3 s in, refreshed again and again: the first move still comes at 4 s.
    expect(row.moves).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(row.moves).toHaveLength(1);
  });

  it("stops at the last page, as a stop, unless it goes round", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } });
    vi.advanceTimersByTime(30 * SECONDS);
    expect(row.scroll).toBe(row.max);
    expect(controller.state().autoplay).toBe("paused");
    const moves = row.moves.length;
    vi.advanceTimersByTime(30 * SECONDS);
    expect(row.moves.length).toBe(moves);
  });

  it("goes round to the first page with rewind, and goes on", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 }, rewind: true });
    vi.advanceTimersByTime(3 * SECONDS);
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.scroll).toBe(600);
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.scroll).toBe(0);
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.scroll).toBe(300);
    expect(controller.state().autoplay).toBe("playing");
  });

  it("is never started under reduced motion, and has no button", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } }, { reducedMotion: true });
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toEqual([]);
    expect(controller.state().autoplay).toBe("off");
    // Not even by the button.
    controller.toggle();
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toEqual([]);
  });

  it("stops if reduced motion is turned on while it plays", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } });
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.moves).toHaveLength(1);
    controller.setReducedMotion(true);
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toHaveLength(1);
    expect(controller.state().autoplay).toBe("off");
  });

  describe("stops for good when the visitor", () => {
    const stopsFor = (name: string, act: (controller: CarouselController, row: FakeRow) => void) =>
      it(name, () => {
        const { row, controller } = make({ autoplay: { seconds: 3 } });
        vi.advanceTimersByTime(3 * SECONDS);
        expect(controller.state().autoplay).toBe("playing");
        act(controller, row);
        const moves = row.moves.length;
        expect(controller.state().autoplay).toBe("paused");
        vi.advanceTimersByTime(120 * SECONDS);
        expect(row.moves.length).toBe(moves);
        // Leaving and coming back, or the tab being shown again, starts nothing.
        controller.hover(true);
        controller.hover(false);
        controller.setHidden(true);
        controller.setHidden(false);
        vi.advanceTimersByTime(120 * SECONDS);
        expect(row.moves.length).toBe(moves);
        expect(controller.state().autoplay).toBe("paused");
      });
    stopsFor("scrolls, drags or focuses inside (any interaction)", (controller) => controller.interact());
    stopsFor("presses next", (controller) => {
      controller.next();
    });
    stopsFor("presses previous", (controller) => {
      controller.prev();
    });
    stopsFor("presses a dot", (controller) => controller.goTo(0));
  });

  it("holds while the pointer is over it and goes on when it leaves", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } });
    vi.advanceTimersByTime(2 * SECONDS);
    controller.hover(true);
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toEqual([]);
    // Held, not stopped: the button still says Pause.
    expect(controller.state().autoplay).toBe("playing");
    controller.hover(false);
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.moves).toHaveLength(1);
  });

  it("holds while the tab is hidden and goes on when it is shown", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } }, { hidden: true });
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toEqual([]);
    controller.setHidden(false);
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.moves).toHaveLength(1);
    controller.setHidden(true);
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toHaveLength(1);
  });

  it("has a Pause button that stops it and a Play button that starts it, by hand", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } });
    controller.toggle();
    expect(controller.state().autoplay).toBe("paused");
    vi.advanceTimersByTime(30 * SECONDS);
    expect(row.moves).toEqual([]);
    controller.toggle();
    expect(controller.state().autoplay).toBe("playing");
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.scroll).toBe(300);
  });

  it("plays again from the first page when it was stopped at the end", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } });
    vi.advanceTimersByTime(30 * SECONDS);
    expect(controller.state()).toMatchObject({ atEnd: true, autoplay: "paused" });
    controller.toggle();
    expect(row.scroll).toBe(0);
    vi.advanceTimersByTime(3 * SECONDS);
    expect(row.scroll).toBe(300);
  });

  it("has nothing to play, and no button, when everything fits on one page", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } }, { row: new FakeRow(2, 300, 100) });
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toEqual([]);
    expect(controller.state().autoplay).toBe("off");
  });

  it("is not kept running by a destroyed controller", () => {
    const { row, controller } = make({ autoplay: { seconds: 3 } });
    controller.destroy();
    vi.advanceTimersByTime(60 * SECONDS);
    expect(row.moves).toEqual([]);
  });
});
