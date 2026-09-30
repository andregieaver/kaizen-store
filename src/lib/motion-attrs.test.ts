import { describe, expect, it } from "vitest";

import {
  BACKGROUND_EFFECTS,
  BACKGROUND_IDS,
  ENTER_EFFECTS,
  ENTER_IDS,
  HOVER_EFFECTS,
  HOVER_IDS,
  SCROLL_EFFECTS,
  SCROLL_IDS,
  type EnterMotion,
  type MotionTarget,
  type PartMotion,
} from "./motion";
import {
  DISTANCE_PX,
  EASE_CURVES,
  SPEED_MS,
  TEXT_EFFECT_IDS,
  backgroundFx,
  blockTarget,
  motionNeeds,
  pageUsesMotion,
  partFx,
  rowsUseJsMotion,
} from "./motion-attrs";
import type { PageBlock, PageColumn, PageRow } from "./page-content";

const targetOf = (targets: readonly MotionTarget[]): MotionTarget => targets[targets.length - 1];
const enter = (effect: EnterMotion["effect"], extra: Partial<EnterMotion> = {}): PartMotion => ({
  enter: { effect, ...extra },
});

describe("an entrance", () => {
  it.each(ENTER_IDS)(
    "%s is named on a part it fits, waiting for its waypoint, with no variables by default",
    (effect) => {
      const target: MotionTarget = (ENTER_EFFECTS[effect].targets as readonly MotionTarget[]).includes("block")
        ? "block"
        : "text";
      const fx = partFx(enter(effect), target);
      expect(fx.attrs["data-fx-enter"]).toBe(effect);
      expect(fx.attrs["data-fx-trigger"]).toBe("view");
      expect(fx.style).toEqual({});
      // Every text effect is split into pieces by the runtime; nothing else is.
      expect("data-fx-text" in fx.attrs).toBe((TEXT_EFFECT_IDS as string[]).includes(effect));
    },
  );

  it("is left out on a part it does not fit", () => {
    expect(partFx(enter("words"), "block")).toEqual({ attrs: {}, style: {} });
    expect(partFx(enter("words"), "row")).toEqual({ attrs: {}, style: {} });
    expect(partFx(enter("chars"), "column").attrs).toEqual({});
  });

  it("is nothing without motion", () => {
    expect(partFx(undefined, "block")).toEqual({ attrs: {}, style: {} });
    expect(partFx({}, "block")).toEqual({ attrs: {}, style: {} });
  });

  it("sends only what differs from the stylesheet's defaults", () => {
    expect(
      partFx(enter("fade-up", { speed: "normal", ease: "smooth", distance: "medium", delay: 0 }), "block").style,
    ).toEqual({});
    const fx = partFx(enter("fade-up", { speed: "slow", ease: "bounce", distance: "large", delay: 250 }), "block");
    expect(fx.style).toEqual({
      "--fx-delay": "250ms",
      "--fx-dur": `${SPEED_MS.slow}ms`,
      "--fx-ease": EASE_CURVES.bounce,
      "--fx-dist": `${DISTANCE_PX.large}px`,
      "--fx-amt": 2,
    });
    expect(partFx(enter("fade-up", { speed: "fast" }), "block").style).toEqual({ "--fx-dur": "400ms" });
    expect(partFx(enter("fade-up", { distance: "small" }), "block").style).toMatchObject({
      "--fx-dist": "16px",
      "--fx-amt": 0.4,
    });
  });

  it("has the speeds, distances and curves the design names", () => {
    expect(SPEED_MS).toEqual({ fast: 400, normal: 700, slow: 1100 });
    expect(DISTANCE_PX).toEqual({ small: 16, medium: 40, large: 80 });
    expect(Object.keys(EASE_CURVES).sort()).toEqual(["bounce", "smooth", "snappy", "soft"]);
    expect(EASE_CURVES.smooth).toBe("cubic-bezier(.22,1,.36,1)");
  });

  it("plays again each time when `once` is off, and starts where `start` says", () => {
    expect(partFx(enter("fade"), "block").attrs).not.toHaveProperty("data-fx-repeat");
    expect(partFx(enter("fade", { once: true }), "block").attrs).not.toHaveProperty("data-fx-repeat");
    expect(partFx(enter("fade", { once: false }), "block").attrs).toHaveProperty("data-fx-repeat");
    expect(partFx(enter("fade"), "block").attrs).not.toHaveProperty("data-fx-start");
    expect(partFx(enter("fade", { start: "late" }), "block").attrs["data-fx-start"]).toBe("late");
    expect(partFx(enter("fade", { start: "middle" }), "block").attrs["data-fx-start"]).toBe("middle");
  });

  it("plays at the page's load when it says so, with no waypoint", () => {
    const fx = partFx(enter("fade", { trigger: "load", once: false, start: "late" }), "block");
    expect(fx.attrs).toEqual({ "data-fx-enter": "fade", "data-fx-trigger": "load" });
  });

  it("acts as a load entrance in the page's first flow row, so nothing above the fold waits for scripts", () => {
    const fx = partFx(enter("fade-up", { once: false, start: "late" }), "row", { firstRow: true });
    expect(fx.attrs).toEqual({ "data-fx-enter": "fade-up", "data-fx-trigger": "load" });
  });

  it("stands a whole-block entrance in for split text above the fold (splitting needs scripts)", () => {
    expect(partFx(enter("words"), "text", { firstRow: true }).attrs).toEqual({
      "data-fx-enter": "fade-up",
      "data-fx-trigger": "load",
    });
    expect(partFx(enter("words-blur"), "text", { firstRow: true }).attrs["data-fx-enter"]).toBe("blur-up");
    expect(partFx(enter("chars"), "text", { firstRow: true }).attrs["data-fx-enter"]).toBe("fade");
    expect(partFx(enter("lines"), "text", { firstRow: true }).attrs["data-fx-enter"]).toBe("fade-up");
    expect(partFx(enter("words", { trigger: "load" }), "text").attrs).not.toHaveProperty("data-fx-text");
  });

  it("never starts a picture in the first row fully transparent", () => {
    expect(partFx(enter("fade"), "block", { firstRow: true, image: true }).attrs).toHaveProperty("data-fx-nofade");
    expect(partFx(enter("iris"), "block", { firstRow: true, image: true }).attrs).toHaveProperty("data-fx-nofade");
    // Only a picture, and only in the first row.
    expect(partFx(enter("fade"), "block", { firstRow: true }).attrs).not.toHaveProperty("data-fx-nofade");
    expect(partFx(enter("fade"), "block", { image: true }).attrs).not.toHaveProperty("data-fx-nofade");
  });

  it("plays at once in the builder's preview, and splits text there", () => {
    const fx = partFx(enter("fade-up", { start: "late", once: false }), "block", { preview: true });
    expect(fx.attrs["data-fx-trigger"]).toBe("load");
    const text = partFx(enter("words"), "text", { preview: true, firstRow: true });
    expect(text.attrs).toMatchObject({
      "data-fx-enter": "words",
      "data-fx-trigger": "view",
      "data-fx-now": "",
      "data-fx-text": "",
    });
  });

  it("gives split text its own step between pieces only when it differs from the effect's", () => {
    expect(partFx(enter("words"), "text").style).toEqual({});
    expect(partFx(enter("words", { stagger: 60 }), "text").style).toEqual({});
    expect(partFx(enter("words", { stagger: 120 }), "text").style).toEqual({ "--fx-stagger": "120ms" });
    expect(partFx(enter("chars", { stagger: 0 }), "text").style).toEqual({ "--fx-stagger": "0ms" });
  });
});

describe("a staggered row or column", () => {
  it("holds still itself and marks its children as a group", () => {
    const row = partFx(enter("fade-up", { stagger: 100, once: false, start: "middle" }), "row");
    expect(row.attrs).toEqual({
      "data-fx-each": "",
      "data-fx-trigger": "view",
      "data-fx-start": "middle",
      "data-fx-repeat": "",
    });
    expect(row.style).toEqual({});
    const column = partFx(enter("zoom-in", { stagger: 80 }), "column");
    expect(column.attrs).toHaveProperty("data-fx-each");
    expect(column.attrs).not.toHaveProperty("data-fx-enter");
  });

  it("is an ordinary entrance with no stagger, or at 0", () => {
    expect(partFx(enter("fade-up", { stagger: 0 }), "row").attrs).toHaveProperty("data-fx-enter");
    expect(partFx(enter("fade-up"), "row").attrs).not.toHaveProperty("data-fx-each");
  });

  it("gives each child the parent's entrance, its number and the step, until it has an entrance of its own", () => {
    const parent = {
      effect: "fade-up",
      speed: "slow",
      distance: "large",
      delay: 200,
      stagger: 90,
    } as const satisfies EnterMotion;
    const second = partFx(undefined, "column", { index: 2, parentStagger: 90, parentEnter: parent });
    expect(second.attrs).toEqual({ "data-fx-enter": "fade-up", "data-fx-trigger": "view", "data-fx-c": "" });
    expect(second.style).toEqual({
      "--fx-delay": "200ms",
      "--fx-dur": "1100ms",
      "--fx-dist": "80px",
      "--fx-amt": 2,
      "--fx-i": 2,
      "--fx-stagger": "90ms",
    });
    const own = partFx(enter("zoom-in"), "column", { index: 2, parentStagger: 90, parentEnter: parent });
    expect(own.attrs["data-fx-enter"]).toBe("zoom-in");
    expect(own.attrs).not.toHaveProperty("data-fx-c");
    expect(own.style).not.toHaveProperty("--fx-i");
  });

  it("does not hand a text effect down, and does nothing for a parent without a step", () => {
    expect(
      partFx(undefined, "block", { index: 0, parentStagger: 50, parentEnter: { effect: "words", stagger: 50 } }),
    ).toEqual({ attrs: {}, style: {} });
    expect(partFx(undefined, "block", { index: 1, parentStagger: 0, parentEnter: { effect: "fade" } })).toEqual({
      attrs: {},
      style: {},
    });
    expect(partFx(undefined, "block", { index: 1, parentEnter: { effect: "fade" } })).toEqual({ attrs: {}, style: {} });
  });

  it("starts its children at load in the first row, and without a group mark", () => {
    const child = partFx(undefined, "column", {
      firstRow: true,
      index: 1,
      parentStagger: 60,
      parentEnter: { effect: "fade", stagger: 60 },
    });
    expect(child.attrs).toMatchObject({ "data-fx-enter": "fade", "data-fx-trigger": "load", "data-fx-c": "" });
    expect(child.style).toMatchObject({ "--fx-i": 1, "--fx-stagger": "60ms" });
  });
});

describe("hover and scroll effects", () => {
  it.each(HOVER_IDS)("hover %s is named on every part it fits, and only those", (effect) => {
    for (const target of ["row", "column", "block", "text"] as MotionTarget[]) {
      const fx = partFx({ hover: { effect } }, target);
      if ((HOVER_EFFECTS[effect].targets as readonly MotionTarget[]).includes(target))
        expect(fx.attrs).toEqual({ "data-fx-hover": effect });
      else expect(fx.attrs).toEqual({});
    }
  });

  it.each(SCROLL_IDS)("scroll %s is named on every part it fits, and only those", (effect) => {
    for (const target of ["row", "column", "block", "text"] as MotionTarget[]) {
      const fx = partFx({ scroll: { effect } }, target);
      if ((SCROLL_EFFECTS[effect].targets as readonly MotionTarget[]).includes(target))
        expect(fx.attrs).toEqual({ "data-fx-scroll": effect });
      else expect(fx.attrs).toEqual({});
    }
  });

  it("scales by intensity", () => {
    expect(partFx({ hover: { effect: "lift", intensity: "medium" } }, "block").style).toEqual({});
    expect(partFx({ hover: { effect: "lift", intensity: "strong" } }, "block").style).toEqual({ "--fx-hk": 1.6 });
    expect(partFx({ scroll: { effect: "parallax", intensity: "subtle" } }, "block").style).toEqual({ "--fx-sk": 0.6 });
  });

  it("lets an entrance keep opacity and focus when a fade or focus with scroll would fight it", () => {
    const both = (effect: "fade-scroll" | "blur-scroll" | "parallax") =>
      partFx({ enter: { effect: "fade-up" }, scroll: { effect } }, "block").attrs;
    expect(both("fade-scroll")).not.toHaveProperty("data-fx-scroll");
    expect(both("blur-scroll")).not.toHaveProperty("data-fx-scroll");
    expect(both("parallax")).toHaveProperty("data-fx-scroll", "parallax");
  });

  it("puts an entrance, a hover and a scroll effect on one part together", () => {
    const fx = partFx({ enter: { effect: "fade" }, hover: { effect: "grow" }, scroll: { effect: "rotate" } }, "column");
    expect(fx.attrs).toEqual({
      "data-fx-enter": "fade",
      "data-fx-trigger": "view",
      "data-fx-hover": "grow",
      "data-fx-scroll": "rotate",
    });
  });
});

describe("a background's motion", () => {
  it.each(BACKGROUND_IDS)("%s is named on the layer", (effect) => {
    const fx = backgroundFx({ effect });
    expect(fx.attrs["data-fx-bgm"]).toBe(effect);
    const scrolls = ["parallax", "zoom-scroll", "blur-scroll", "fade-scroll"].includes(effect);
    expect(fx.attrs["data-fx-scroll"]).toBe(scrolls ? `bg-${effect}` : undefined);
    // Scroll is measured on the frame, not on the layer that moves.
    expect(fx.attrs["data-fx-tl"]).toBe(scrolls ? "parent" : undefined);
    expect(BACKGROUND_EFFECTS[effect].targets).toContain("row");
  });

  it("is nothing without motion, scales by intensity, and never fades in the first row", () => {
    expect(backgroundFx(undefined)).toEqual({ attrs: {}, style: {} });
    expect(backgroundFx({ effect: "ken-burns", intensity: "strong" }).style).toEqual({ "--fx-sk": 1.6 });
    expect(backgroundFx({ effect: "ken-burns", intensity: "medium" }).style).toEqual({});
    expect(backgroundFx({ effect: "fade-scroll" }, { firstRow: true })).toEqual({ attrs: {}, style: {} });
    expect(backgroundFx({ effect: "parallax" }, { firstRow: true }).attrs["data-fx-bgm"]).toBe("parallax");
  });
});

describe("the kind of part a block is", () => {
  it("is text for a heading and rich text, and a block for the rest", () => {
    expect(blockTarget({ type: "heading" } as PageBlock)).toBe("text");
    expect(blockTarget({ type: "richText" } as PageBlock)).toBe("text");
    expect(blockTarget({ type: "image" } as PageBlock)).toBe("block");
    expect(blockTarget({ type: "button" } as PageBlock)).toBe("block");
    expect(targetOf(ENTER_EFFECTS.words.targets)).toBe("text");
  });
});

// ---------------------------------------------------------------------------

let n = 0;
const id = () => `x${++n}`;
const block = (motion?: PartMotion): PageBlock =>
  ({ id: id(), type: "heading", text: "Hi", level: 2, ...(motion ? { motion } : {}) }) as PageBlock;
const column = (blocks: PageBlock[], extra: Partial<PageColumn> = {}): PageColumn => ({ id: id(), blocks, ...extra });
const row = (columns: PageColumn[], extra: Partial<PageRow> = {}): PageRow =>
  ({ id: id(), type: "row", layout: "1", columns, ...extra }) as PageRow;
const button = (motion?: PartMotion): PageBlock =>
  ({ id: id(), type: "button", label: "Go", href: "/x", ...(motion ? { motion } : {}) }) as PageBlock;
const plain = () => row([column([block()])]);
const image = {
  type: "image" as const,
  image: { url: "https://cdn.example/a.webp", width: 10, height: 10 },
  overlay: null,
};
const gradient = { type: "gradient" as const, style: "aurora" as const, colors: ["#112233", "#445566"] };

describe("what a page needs", () => {
  it("needs nothing when nothing moves", () => {
    expect(pageUsesMotion([])).toBe(false);
    expect(pageUsesMotion([plain(), plain()])).toBe(false);
    expect(motionNeeds([plain()])).toEqual({ js: false, view: false, any: false });
  });

  it("needs the runtime for a waypoint entrance below the first row, at any depth", () => {
    const waits = block(enter("fade-up"));
    expect(pageUsesMotion([plain(), row([column([waits])])])).toBe(true);
    expect(pageUsesMotion([plain(), row([column([block()])], { motion: enter("fade") })])).toBe(true);
    expect(pageUsesMotion([plain(), row([column([block()], { motion: enter("fade") })])])).toBe(true);
    expect(motionNeeds([plain(), row([column([waits])])])).toEqual({ js: true, view: true, any: true });
    expect(rowsUseJsMotion([plain(), row([column([waits])])])).toBe(true);
  });

  it("does not need it for entrances in the first row (a `view` acts as `load` there) or that play at load", () => {
    expect(pageUsesMotion([row([column([block(enter("fade-up"))])])])).toBe(false);
    expect(pageUsesMotion([row([column([block()])], { motion: enter("fade") })])).toBe(false);
    expect(pageUsesMotion([plain(), row([column([block(enter("fade-up", { trigger: "load" }))])])])).toBe(false);
    expect(motionNeeds([row([column([block(enter("fade-up"))])])])).toEqual({ js: false, view: false, any: true });
    // Split text in the first row is a whole-block entrance, so it needs nothing either; below it, it does.
    expect(pageUsesMotion([row([column([block(enter("words"))])])])).toBe(false);
    expect(pageUsesMotion([plain(), row([column([block(enter("words"))])])])).toBe(true);
  });

  it("takes a row in a modal for not being in the flow: its entrances wait for the dialog", () => {
    const modal = { key: "m", triggers: { button: true }, frequency: "always", size: "md" } as never;
    const inModal = row([column([block(enter("fade-up"))])], { modal });
    expect(pageUsesMotion([inModal])).toBe(true);
    // The row after it is the first one in the flow.
    expect(pageUsesMotion([inModal, row([column([block(enter("fade-up"))])])])).toBe(true);
    expect(pageUsesMotion([plain(), row([column([block(enter("fade-up"))])])])).toBe(true);
    expect(pageUsesMotion([{ ...plain(), modal }, row([column([block(enter("fade-up"))])])])).toBe(false);
  });

  it("needs it for pointer hover effects and for scroll effects (a fallback where CSS has none), not for the other hovers", () => {
    for (const effect of ["tilt", "magnetic", "spotlight"] as const)
      expect(pageUsesMotion([row([column([button({ hover: { effect } })])])])).toBe(true);
    for (const effect of ["lift", "grow", "float", "glow", "shine", "image-zoom"] as const)
      expect(motionNeeds([row([column([button({ hover: { effect } })])])])).toEqual({
        js: false,
        view: false,
        any: true,
      });
    expect(pageUsesMotion([row([column([block({ scroll: { effect: "parallax" } })])])])).toBe(true);
  });

  it("counts backgrounds: a scroll effect on one, but not a slow one, and not a gradient", () => {
    expect(
      pageUsesMotion([row([column([block()])], { background: image, backgroundMotion: { effect: "parallax" } })]),
    ).toBe(true);
    expect(
      pageUsesMotion([row([column([block()], { background: image, backgroundMotion: { effect: "zoom-scroll" } })])]),
    ).toBe(true);
    expect(
      pageUsesMotion([row([column([block()])], { background: image, backgroundMotion: { effect: "ken-burns" } })]),
    ).toBe(false);
    expect(pageUsesMotion([row([column([block()])], { background: gradient })])).toBe(false);
    expect(
      pageUsesMotion([row([column([block()])], { background: gradient, backgroundMotion: { effect: "drift" } })]),
    ).toBe(false);
    // A motion with nothing behind it is nothing.
    expect(pageUsesMotion([row([column([block()])], { backgroundMotion: { effect: "parallax" } })])).toBe(false);
  });
});
