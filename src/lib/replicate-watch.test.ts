import { describe, expect, it } from "vitest";

import type { CaptureNode, PageCapture } from "./replicate-capture";
import { NO_ANSWER, WATCH, applyWatch, clampSeconds, movesAllTheTime, movesOf, trackPaths, watchLine, watchOf, watchTracks, within, type WatchDeps } from "./replicate-watch";

/**
 * Watching a track for autoplay (D155, C2): what the samples say, and that the time it takes is bounded, hard, whatever the page does:
 * the replicator's tick has a limit of its own, so the watch is one window, at most one retry, and never more than `WATCH.totalMs`.
 */

const node = (p: string, extra: Partial<CaptureNode> = {}, children: CaptureNode[] = []): CaptureNode => ({ p, tag: "div", box: [0, 0, 100, 100], s: { display: "block" }, children, ...extra });
const capture = (root: CaptureNode): PageCapture => ({ viewport: { w: 1440, h: 900 }, url: "https://source.test/", title: "", lang: "", description: "", docWidth: 1440, docHeight: 900, background: "rgb(255, 255, 255)", root, fonts: [], left: { fixed: [], hidden: 0, capped: false } });

/** A clock the test owns: time passes only when something sleeps or reads, so the bound is the loop's own and not the machine's. */
function fake(options: { track: (at: number) => string; readCost?: number; stretch?: number; cut?: number; abortAt?: number }) {
  let now = 1_000_000;
  const start = now;
  const log = { prepares: 0, reads: 0, sleeps: 0 };
  const deps: WatchDeps = {
    read: async () => {
      log.reads += 1;
      now += options.readCost ?? 40;
      if (options.cut !== undefined && log.reads > options.cut) return null;
      return { a: options.track(now - start) };
    },
    sleep: async (ms) => {
      log.sleeps += 1;
      now += ms * (options.stretch ?? 1);
    },
    now: () => now,
    prepare: async () => {
      log.prepares += 1;
    },
    aborted: () => options.abortAt !== undefined && now - start >= options.abortAt,
  };
  return { deps, log, spent: () => now - start };
}

describe("what samples say", () => {
  const at = (...values: [number, string][]) => values.map(([time, value]) => ({ at: time, value }));

  it("counts a change in what a sample says as a move, and a run of changes close together as one", () => {
    expect(movesOf(at([0, "a"], [350, "a"], [700, "a"]))).toEqual([]);
    expect(movesOf(at([0, "a"], [350, "b"], [700, "b"]))).toEqual([{ at: 350, last: 350 }]);
    // A slide animated by script changes at every frame: one move.
    expect(movesOf(at([0, "a"], [350, "b"], [700, "c"], [1050, "d"], [1400, "d"]))).toEqual([{ at: 350, last: 1050 }]);
    // Two moves five seconds apart are two.
    expect(movesOf(at([0, "a"], [350, "b"], [3000, "b"], [5350, "c"]))).toEqual([{ at: 350, last: 350 }, { at: 5350, last: 5350 }]);
  });

  it("says nothing moved, or the period from the gap between two moves, or a lower bound from one", () => {
    expect(watchOf([], 6500)).toEqual({ observed: false, watchedMs: 6500 });
    expect(watchOf([{ at: 400, last: 400 }, { at: 5400, last: 5400 }], 6500)).toEqual({ observed: true, watchedMs: 6500, seconds: 5, moves: 2, basis: "interval" });
    // The median of the gaps when there are more than two moves.
    expect(watchOf([{ at: 0, last: 0 }, { at: 4000, last: 4000 }, { at: 8000, last: 8000 }, { at: 13_000, last: 13_000 }], 14_000)).toMatchObject({ seconds: 4, moves: 4 });
    // One move at 2.4 s of 6.5 s: a second would have come within 4.1 s more, so at least 4.1, which is 5 whole seconds.
    expect(watchOf([{ at: 2400, last: 2400 }], 6500)).toEqual({ observed: true, watchedMs: 6500, seconds: 5, moves: 1, basis: "once" });
    // One move at the very start of the window says at least the rest of the window.
    expect(watchOf([{ at: 300, last: 300 }], 6500)).toMatchObject({ seconds: 7, basis: "once" });
  });

  it("clamps the period to a carousel's 3 to 15 seconds", () => {
    expect(clampSeconds(0.8)).toBe(3);
    expect(clampSeconds(2.4)).toBe(3);
    expect(clampSeconds(7.4)).toBe(7);
    expect(clampSeconds(40)).toBe(15);
    expect(watchOf([{ at: 100, last: 100 }, { at: 1100, last: 1100 }], 6500)).toMatchObject({ seconds: 3 });
    expect(watchOf([{ at: 100, last: 100 }, { at: 41_100, last: 41_100 }], 50_000)).toMatchObject({ seconds: 15 });
  });
});

describe("watching tracks", () => {
  it("sees a track that moves every five seconds and stops at once when it knows the period", async () => {
    const world = fake({ track: (t) => `slide ${Math.floor((t + 4000) / 5000)}` });
    const result = await watchTracks(["a"], world.deps);
    expect(result.watches.a).toMatchObject({ observed: true, moves: 2, basis: "interval", seconds: 5 });
    expect(result.windows).toBe(1);
    expect(world.log.prepares).toBe(1);
    // It did not use the whole window: two moves tell the period.
    expect(result.spentMs).toBeLessThan(WATCH.windowMs);
  });

  it("says a track that never moves did not, after one window and one retry, no more", async () => {
    const world = fake({ track: () => "still" });
    const result = await watchTracks(["a"], world.deps);
    expect(result.watches.a).toMatchObject({ observed: false });
    expect(result.windows).toBe(2);
    expect(world.log.prepares).toBe(2);
    expect(result.spentMs).toBeLessThanOrEqual(WATCH.totalMs + WATCH.sampleMs + 100);
  });

  it("is bounded however the page behaves: a slow page, a slow read, a track that changes at every sample", async () => {
    const cases = [
      fake({ track: () => "still", stretch: 6 }),
      fake({ track: () => "still", readCost: 900 }),
      fake({ track: () => "still", readCost: 900, stretch: 4 }),
      fake({ track: (t) => `frame ${t}` }),
      fake({ track: (t) => `frame ${Math.floor(t / 100)}`, readCost: 300 }),
    ];
    for (const world of cases) {
      const result = await watchTracks(["a"], world.deps);
      // One more sleep and one more read past the cap at the very most: never a second window past it.
      expect(result.spentMs).toBeLessThanOrEqual(WATCH.totalMs + 4 * WATCH.sampleMs + 2 * 900 + 100);
      expect(result.windows).toBeLessThanOrEqual(2);
      expect(world.log.prepares).toBeLessThanOrEqual(2);
    }
  });

  it("does not retry for a plain scroller, which has no reason to wait to be looked at", async () => {
    const world = fake({ track: () => "still" });
    const result = await watchTracks(["a"], { ...world.deps, retry: false });
    expect(result.windows).toBe(1);
    expect(world.log.prepares).toBe(1);
    expect(result.spentMs).toBeLessThanOrEqual(WATCH.windowMs + WATCH.sampleMs + 100);
  });

  it("retries once when nothing moved, and takes what the retry saw", async () => {
    // Still for the first window, moving after it (a slider that waited to be looked at).
    const world = fake({ track: (t) => (t < WATCH.windowMs + 500 ? "still" : `slide ${Math.floor((t - WATCH.windowMs) / 1500)}`) });
    const result = await watchTracks(["a"], world.deps);
    expect(result.windows).toBe(2);
    expect(result.watches.a).toMatchObject({ observed: true });
    expect(world.log.prepares).toBe(2);
  });

  it("does not retry when something moved", async () => {
    const world = fake({ track: (t) => (t < 3000 ? "one" : "two") });
    const result = await watchTracks(["a"], world.deps);
    expect(result.windows).toBe(1);
    expect(result.watches.a).toMatchObject({ observed: true, basis: "once" });
  });

  it("carries on past the window while a track has moved once, to learn its period, but never past the total", async () => {
    // Moves at 3.0 s and 9.0 s: the window (6.5 s) ends between them, the second is seen all the same.
    const slow = fake({ track: (t) => `slide ${Math.floor((t + 3000) / 6000)}` });
    const seen = await watchTracks(["a"], slow.deps);
    expect(seen.watches.a).toMatchObject({ observed: true, moves: 2, basis: "interval", seconds: 6 });
    expect(seen.spentMs).toBeGreaterThan(WATCH.windowMs);
    // Moves at 3 s and 20 s: the second is not waited for, and one move says only a lower bound.
    const slower = fake({ track: (t) => (t < 3000 ? "a" : t < 20_000 ? "b" : "c") });
    const once = await watchTracks(["a"], slower.deps);
    expect(once.watches.a).toMatchObject({ observed: true, moves: 1, basis: "once" });
    expect(once.spentMs).toBeLessThanOrEqual(WATCH.totalMs + WATCH.sampleMs + 100);
  });

  it("watches nothing when there is nothing to watch, and stops when asked or when the page cannot be read", async () => {
    expect(await watchTracks([], fake({ track: () => "x" }).deps)).toEqual({ watches: {}, windows: 0, spentMs: 0 });
    const aborted = fake({ track: () => "still", abortAt: 1000 });
    const a = await watchTracks(["a"], aborted.deps);
    expect(a.spentMs).toBeLessThan(2500);
    const gone = fake({ track: () => "still", cut: 2 });
    const b = await watchTracks(["a"], gone.deps);
    // What it saw before the page went is all it says: not observed, in the time it watched.
    expect(b.watches.a).toMatchObject({ observed: false });
    expect(b.windows).toBe(1);
    expect(gone.log.reads).toBeLessThanOrEqual(4);
  });

  it("says each track on its own: one moving, one still", async () => {
    let now = 0;
    const deps: WatchDeps = {
      read: async () => {
        now += 40;
        return { a: `slide ${Math.floor(now / 2000)}`, b: "still" };
      },
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    };
    const result = await watchTracks(["a", "b"], deps);
    expect(result.watches.a).toMatchObject({ observed: true, seconds: 3 });
    expect(result.watches.b).toMatchObject({ observed: false });
  });

  it("keeps the whole watch within what the tick can spare", () => {
    // The tick route may run 300 s; opening the page twice and photographing it comes first. The watch never takes more than this of it.
    expect(WATCH.windowMs + WATCH.retryMs).toBeLessThanOrEqual(WATCH.totalMs);
    expect(WATCH.totalMs).toBeLessThanOrEqual(15_000);
    expect(WATCH.skipAfterMs).toBeLessThan(120_000);
    // Moves are told apart from one move drawn over many frames.
    expect(WATCH.mergeMs).toBeGreaterThan(WATCH.sampleMs * 2);
  });
});

describe("what is put on a capture", () => {
  const tree = () =>
    node("", {}, [
      node("0", { scroll: true, slider: { kind: "transform", clip: [0, 0, 100, 100], tiles: 3, hints: [], arrows: [], dots: null } }, [node("0/0"), node("0/1"), node("0/2")]),
      node("1", { scroll: true }, [node("1/0"), node("1/1")]),
      // One tile is not a track to watch; nor is a box that does not scroll.
      node("2", { scroll: true }, [node("2/0")]),
      node("3", {}, [node("3/0"), node("3/1")]),
    ]);

  it("names the tracks worth watching: script sliders and sideways scrollers with two tiles at least", () => {
    const paths = trackPaths(capture(tree()));
    expect([...paths]).toEqual(["0", "1"]);
    expect(paths.sliders).toEqual(["0"]);
  });

  it("puts what was seen on the nodes, by path", () => {
    const c = capture(tree());
    expect(applyWatch(c, { "0": { observed: true, watchedMs: 6500, seconds: 5, moves: 2, basis: "interval" }, "1": { observed: false, watchedMs: 11_500 }, nowhere: { observed: false, watchedMs: 0 } })).toBe(2);
    expect(c.root.children[0].watch).toMatchObject({ observed: true, seconds: 5 });
    expect(c.root.children[1].watch).toEqual({ observed: false, watchedMs: 11_500 });
    expect(c.root.children[3].watch).toBeUndefined();
  });

  it("says in a line for the job's log what was watched and what moved, and nothing when nothing was watched", () => {
    const c = capture(tree());
    expect(watchLine(c)).toBeNull();
    applyWatch(c, { "0": { observed: true, watchedMs: 6500, seconds: 5, moves: 2, basis: "interval" }, "1": { observed: false, watchedMs: 11_500 } });
    expect(watchLine(c)).toBe("Watched 2 carousels for up to 11.5 s with nobody touching the page: one moves by itself.");
    const none = capture(tree());
    applyWatch(none, { "0": { observed: false, watchedMs: 11_500 } });
    expect(watchLine(none)).toBe("Watched one carousel for up to 11.5 s with nobody touching the page: none moved by itself.");
    const skipped = capture(tree());
    applyWatch(skipped, { "0": { observed: false, watchedMs: 0, why: "the page took too long to open to spare the time" } });
    expect(watchLine(skipped)).toContain("Did not watch");
  });
});

describe("motion that is not autoplay", () => {
  const at = (...values: [number, string][]) => values.map(([time, value]) => ({ at: time, value }));

  it("tells a track that changes at nearly every sample (a ticker moved by script) from one that rests on a slide between moves", () => {
    const ticker = Array.from({ length: 12 }, (_, i) => ({ at: i * 350, value: `translateX(${-i * 7}px)` }));
    expect(movesAllTheTime(ticker)).toBe(true);
    // A slide animated by script for a second and then still for five: a move, not motion all the time.
    const slide = Array.from({ length: 18 }, (_, i) => ({ at: i * 350, value: i < 3 ? `frame ${i}` : "rest" }));
    expect(movesAllTheTime(slide)).toBe(false);
    // Too few samples to say.
    expect(movesAllTheTime(at([0, "a"], [350, "b"], [700, "c"]))).toBe(false);
  });

  it("does not read a ticker as one move, and says so: observed is false, with why, and the log line says it moves all the time", async () => {
    let now = 0;
    const deps: WatchDeps = {
      read: async () => {
        now += 40;
        return { a: `translateX(${-now / 2}px)` };
      },
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    };
    const result = await watchTracks(["a"], deps);
    expect(result.watches.a).toMatchObject({ observed: false, why: expect.stringContaining("all the time") });
    // A ticker is a result, so there is no second window looking for a move.
    expect(result.windows).toBe(1);
    const c = capture(node("", {}, [node("a", { scroll: true }, [node("a/0"), node("a/1")])]));
    applyWatch(c, result.watches);
    expect(watchLine(c)).toContain("moves all the time, like a ticker, which is not autoplay");
  });

  it("is not stopped by a prepare step that never comes back either, and says the page stopped answering for a track it never saw", async () => {
    const deps: WatchDeps = {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      prepare: () => new Promise(() => {}),
      read: () => new Promise(() => {}),
    };
    const small = { windowMs: 200, retryMs: 200, totalMs: 400, sampleMs: 20, mergeMs: 50 };
    const began = Date.now();
    const result = await watchTracks(["a"], deps, small);
    expect(Date.now() - began).toBeLessThan(1500);
    expect(result.watches.a).toMatchObject({ observed: false, why: "the page stopped answering" });
    const c = capture(node("", {}, [node("a", { scroll: true }, [node("a/0"), node("a/1")])]));
    applyWatch(c, result.watches);
    expect(watchLine(c)).toBe("Could not watch the slider for autoplay: the page stopped answering.");
  });

  it("gives up on any one call after the time it may take, and clears its timer", async () => {
    expect(await within(new Promise(() => {}), 20)).toBe(NO_ANSWER);
    expect(await within(Promise.resolve(7), 1000)).toBe(7);
    // Every call to the page has a cap of its own, short of the watch's total.
    expect(WATCH.callMs).toBeLessThan(WATCH.totalMs);
  });
});
