import { describe, expect, it } from "vitest";

import {
  BACKGROUND_EFFECTS,
  ENTER_IDS,
  GRADIENT_COLORS_MAX,
  GRADIENT_COLORS_MIN,
  HOVER_IDS,
  SCROLL_IDS,
  STAGGER_MAX,
  enterFits,
  hoverFits,
  partMotionSchema,
  scrollFits,
  type PartMotion,
} from "./motion";
import {
  GRADIENT_ANGLE_DEFAULT,
  GRADIENT_PALETTE,
  addGradientColor,
  backgroundMoves,
  defaultGradient,
  drawTarget,
  enterFitsPart,
  enterOffered,
  hoverOffered,
  isTextBlock,
  motionSignature,
  onlyScroll,
  patchEnter,
  removeGradientColor,
  scrollOffered,
  setBackgroundEffect,
  setBackgroundIntensity,
  setEnterEffect,
  setGradientAngle,
  setGradientColor,
  setGradientFlow,
  setGradientGrain,
  setGradientStyle,
  setHoverEffect,
  setHoverIntensity,
  setScrollEffect,
  setScrollIntensity,
  staggerKind,
  switchBackground,
  withoutScroll,
  type MotionPart,
} from "./motion-edit";
import { blockTarget } from "./motion-attrs";
import { pageRowSchema, type GradientBackground, type PageRow } from "./page-content";

const ROW: MotionPart = { kind: "row" };
const COLUMN: MotionPart = { kind: "column" };
const IMAGE: MotionPart = { kind: "block", blockType: "image" };
const HEADING: MotionPart = { kind: "block", blockType: "heading" };
const RICH: MotionPart = { kind: "block", blockType: "richText" };
const BUTTON: MotionPart = { kind: "block", blockType: "button" };

const ids = <T extends string>(groups: { effects: { id: T }[] }[]) => groups.flatMap((g) => g.effects.map((e) => e.id));

describe("which effects a part is offered", () => {
  it("knows the kind of part: text is a heading or rich text", () => {
    expect(isTextBlock("heading")).toBe(true);
    expect(isTextBlock("richText")).toBe(true);
    expect(isTextBlock("image")).toBe(false);
    expect(drawTarget(ROW)).toBe("row");
    expect(drawTarget(COLUMN)).toBe("column");
    expect(drawTarget(IMAGE)).toBe("block");
    expect(drawTarget(HEADING)).toBe("text");
    expect(drawTarget(RICH)).toBe("text");
  });

  it("agrees with the renderer about which kind of part a component is", () => {
    for (const type of [
      "heading",
      "richText",
      "image",
      "button",
      "contentGrid",
      "product",
      "site",
      "menu",
      "faq",
      "video",
    ] as const) {
      expect(drawTarget({ kind: "block", blockType: type }), type).toBe(blockTarget({ type }));
    }
  });

  it("offers entrances by the catalogue's own fits, the text ones only to text", () => {
    for (const [part, targets] of [
      [ROW, ["row"]],
      [COLUMN, ["column"]],
      [IMAGE, ["block"]],
      [BUTTON, ["block"]],
      [HEADING, ["text"]],
      [RICH, ["text"]],
    ] as const) {
      const expected = ENTER_IDS.filter((id) => targets.some((t) => enterFits(id, t)));
      expect(ids(enterOffered(part)), JSON.stringify(part)).toEqual(expected);
    }
    for (const text of ["words", "words-blur", "chars", "lines"] as const) {
      expect(ids(enterOffered(IMAGE))).not.toContain(text);
      expect(ids(enterOffered(ROW))).not.toContain(text);
      expect(ids(enterOffered(HEADING))).toContain(text);
    }
  });

  it("offers hover and scroll effects the part can have, a text component only those the renderer draws on text", () => {
    expect(ids(hoverOffered(ROW))).toEqual(HOVER_IDS.filter((id) => hoverFits(id, "row")));
    expect(ids(hoverOffered(ROW))).not.toContain("tilt");
    expect(ids(hoverOffered(IMAGE))).toContain("image-zoom");
    expect(ids(hoverOffered(IMAGE))).toContain("magnetic");
    expect(ids(hoverOffered(COLUMN))).toContain("dim");
    expect(ids(hoverOffered(IMAGE))).not.toContain("dim");
    expect(ids(hoverOffered(HEADING))).toEqual(HOVER_IDS.filter((id) => hoverFits(id, "text")));
    expect(ids(hoverOffered(HEADING))).not.toContain("tilt");
    expect(ids(hoverOffered(HEADING))).toContain("lift");
    expect(ids(scrollOffered(HEADING))).not.toContain("rotate");
    expect(ids(scrollOffered(ROW))).toEqual(SCROLL_IDS.filter((id) => scrollFits(id, "row")));
    expect(ids(scrollOffered(ROW))).not.toContain("rotate");
    expect(ids(scrollOffered(IMAGE))).toContain("rotate");
  });

  it("groups them as the catalogue does, in its order, without repeating one", () => {
    const groups = enterOffered(HEADING);
    expect(groups.map((g) => g.group)).toEqual([...new Set(groups.map((g) => g.group))]);
    expect(groups.map((g) => g.group)).toContain("Text");
    const all = ids(groups);
    expect(new Set(all).size).toBe(all.length);
  });

  it("says whether an effect fits a part", () => {
    expect(enterFitsPart("words", ROW)).toBe(false);
    expect(enterFitsPart("words", HEADING)).toBe(true);
    expect(enterFitsPart("fade-up", IMAGE)).toBe(true);
  });

  it("says what a stagger is between", () => {
    expect(staggerKind(ROW, "fade")).toBe("columns");
    expect(staggerKind(COLUMN, undefined)).toBe("components");
    expect(staggerKind(IMAGE, "fade")).toBeNull();
    expect(staggerKind(HEADING, "fade")).toBeNull();
    expect(staggerKind(HEADING, "words")).toBe("words");
    expect(staggerKind(HEADING, "words-blur")).toBe("words");
    expect(staggerKind(RICH, "chars")).toBe("letters");
    expect(staggerKind(RICH, "lines")).toBe("lines");
  });
});

describe("changing an entrance", () => {
  it("chooses one, keeps its settings when the effect changes, and takes it away with none", () => {
    let motion = setEnterEffect(undefined, "fade-up", COLUMN);
    expect(motion).toEqual({ enter: { effect: "fade-up" } });
    motion = patchEnter(motion, { speed: "slow", delay: 300, stagger: 100 }, COLUMN);
    expect(motion?.enter).toEqual({ effect: "fade-up", speed: "slow", delay: 300, stagger: 100 });
    motion = setEnterEffect(motion, "zoom-in", COLUMN);
    expect(motion?.enter).toEqual({ effect: "zoom-in", speed: "slow", delay: 300, stagger: 100 });
    expect(setEnterEffect(motion, null, COLUMN)).toBeUndefined();
  });

  it("leaves no key for an empty motion, and keeps the other effects", () => {
    const both: PartMotion = { enter: { effect: "fade" }, hover: { effect: "lift" } };
    expect(setEnterEffect(both, null, ROW)).toEqual({ hover: { effect: "lift" } });
    expect(setHoverEffect({ hover: { effect: "lift" } }, null)).toBeUndefined();
    expect(setScrollEffect({ scroll: { effect: "parallax" } }, null)).toBeUndefined();
    expect(setEnterEffect(undefined, null, ROW)).toBeUndefined();
  });

  it("drops a stagger where the new effect has nothing to play in turn", () => {
    const words = patchEnter(setEnterEffect(undefined, "words", HEADING), { stagger: 100 }, HEADING);
    expect(words?.enter?.stagger).toBe(100);
    expect(setEnterEffect(words, "fade", HEADING)?.enter).toEqual({ effect: "fade" });
    // A block has none at all.
    expect(patchEnter(setEnterEffect(undefined, "fade", IMAGE), { stagger: 200 }, IMAGE)?.enter).toEqual({
      effect: "fade",
    });
  });

  it("steps and limits the delay and stagger, and leaves a zero out", () => {
    const base = setEnterEffect(undefined, "fade", ROW);
    expect(patchEnter(base, { delay: 130 }, ROW)?.enter?.delay).toBe(150);
    expect(patchEnter(base, { delay: 99999 }, ROW)?.enter?.delay).toBe(2000);
    expect(patchEnter(base, { delay: -50 }, ROW)?.enter).toEqual({ effect: "fade" });
    expect(patchEnter(base, { stagger: 99999 }, ROW)?.enter?.stagger).toBe(STAGGER_MAX);
    const delayed = patchEnter(base, { delay: 200 }, ROW);
    expect(patchEnter(delayed, { delay: 0 }, ROW)?.enter).toEqual({ effect: "fade" });
    expect(patchEnter(delayed, { speed: undefined }, ROW)?.enter).toEqual({ effect: "fade", delay: 200 });
  });

  it("drops a waypoint's settings when it plays as the page opens", () => {
    const view = patchEnter(setEnterEffect(undefined, "fade", ROW), { start: "late", once: false }, ROW);
    expect(view?.enter).toEqual({ effect: "fade", start: "late", once: false });
    expect(patchEnter(view, { trigger: "load" }, ROW)?.enter).toEqual({ effect: "fade", trigger: "load" });
  });

  it("changes nothing where there is no entrance", () => {
    const hover: PartMotion = { hover: { effect: "lift" } };
    expect(patchEnter(hover, { speed: "fast" }, ROW)).toBe(hover);
    expect(patchEnter(undefined, { speed: "fast" }, ROW)).toBeUndefined();
  });

  it("always gives what the schema accepts", () => {
    let motion = setEnterEffect(undefined, "words-blur", HEADING);
    motion = patchEnter(
      motion,
      {
        speed: "fast",
        ease: "bounce",
        distance: "large",
        delay: 250,
        stagger: 150,
        trigger: "view",
        start: "early",
        once: false,
      },
      HEADING,
    );
    motion = setHoverEffect(motion, "lift");
    motion = setHoverIntensity(motion, "strong");
    motion = setScrollEffect(motion, "fade-scroll");
    motion = setScrollIntensity(motion, "subtle");
    expect(partMotionSchema.parse(motion)).toEqual(motion);
  });
});

describe("changing hover and scroll effects", () => {
  it("chooses an effect, keeps its intensity when the effect changes, and clears it with none", () => {
    let motion = setHoverEffect(undefined, "grow");
    expect(motion).toEqual({ hover: { effect: "grow" } });
    motion = setHoverIntensity(motion, "strong");
    expect(setHoverEffect(motion, "lift")).toEqual({ hover: { effect: "lift", intensity: "strong" } });
    expect(setHoverIntensity(motion, undefined)).toEqual({ hover: { effect: "grow" } });
    let scroll = setScrollEffect(undefined, "parallax");
    scroll = setScrollIntensity(scroll, "subtle");
    expect(scroll).toEqual({ scroll: { effect: "parallax", intensity: "subtle" } });
  });

  it("changes an intensity only where there is an effect", () => {
    expect(setHoverIntensity(undefined, "strong")).toBeUndefined();
    expect(setScrollIntensity({ hover: { effect: "lift" } }, "strong")).toEqual({ hover: { effect: "lift" } });
  });

  it("splits a motion into what plays by itself and what follows scrolling", () => {
    const motion: PartMotion = { enter: { effect: "fade" }, hover: { effect: "lift" }, scroll: { effect: "parallax" } };
    expect(withoutScroll(motion)).toEqual({ enter: { effect: "fade" }, hover: { effect: "lift" } });
    expect(onlyScroll(motion)).toEqual({ scroll: { effect: "parallax" } });
    expect(onlyScroll({ enter: { effect: "fade" } })).toBeUndefined();
    expect(withoutScroll({ scroll: { effect: "parallax" } })).toBeUndefined();
  });
});

const image = {
  type: "image" as const,
  image: { url: "https://x.test/a.webp", width: 10, height: 10 },
  overlay: { color: "#000000", opacity: 40 },
  blur: 6,
};
const video = { type: "video" as const, video: { url: "https://x.test/a.mp4" }, poster: null, overlay: null } as never;

describe("switching a background's kind", () => {
  it("makes a gradient from nothing but a gradient's own settings", () => {
    const { background, clearMotion, clearBackdropBlur } = switchBackground(image, "gradient");
    expect(background).toEqual(defaultGradient());
    expect(background).not.toHaveProperty("image");
    expect(background).not.toHaveProperty("overlay");
    expect(background).not.toHaveProperty("blur");
    expect(clearMotion).toBe(false);
    expect(clearBackdropBlur).toBe(true);
  });

  it("waits for a picture or video's upload rather than keeping a gradient's keys", () => {
    const gradient = defaultGradient("aurora");
    expect(switchBackground(gradient, "image").background).toBeUndefined();
    expect(switchBackground(gradient, "video").background).toBeUndefined();
    expect(switchBackground(gradient, "image").clearMotion).toBe(true);
    expect(switchBackground(gradient, "image").clearBackdropBlur).toBe(true);
  });

  it("keeps a background that is already of the chosen kind, motion and all", () => {
    expect(switchBackground(image, "image")).toMatchObject({ background: image, clearMotion: false });
    const gradient = { ...defaultGradient("conic"), grain: true };
    expect(switchBackground(gradient, "gradient").background).toBe(gradient);
    expect(switchBackground(video, "video").background).toBe(video);
  });

  it("takes the motion off a colour or nothing, and keeps the colour that was there", () => {
    expect(switchBackground(image, "none")).toEqual({
      background: undefined,
      clearMotion: true,
      clearBackdropBlur: false,
    });
    expect(switchBackground(image, "color")).toMatchObject({
      background: { type: "color" },
      clearMotion: true,
      clearBackdropBlur: false,
    });
    const color = { type: "color" as const, color: "#123456" };
    expect(switchBackground(color, "color").background).toEqual(color);
    expect(switchBackground(defaultGradient(), "color").background).toEqual({ type: "color", color: "#f3f4f6" });
  });

  it("says which backgrounds can move", () => {
    expect(backgroundMoves(undefined)).toBe(false);
    expect(backgroundMoves({ type: "color", color: "#ffffff" })).toBe(false);
    expect(backgroundMoves(image)).toBe(true);
    expect(backgroundMoves(video)).toBe(true);
    expect(backgroundMoves(defaultGradient())).toBe(true);
  });

  it("chooses a background effect and its intensity, and clears them with none", () => {
    const ids = Object.keys(BACKGROUND_EFFECTS) as (keyof typeof BACKGROUND_EFFECTS)[];
    const parallax = setBackgroundEffect(undefined, ids[0]);
    expect(parallax).toEqual({ effect: ids[0] });
    const strong = setBackgroundIntensity(parallax, "strong");
    expect(setBackgroundEffect(strong, ids[1])).toEqual({ effect: ids[1], intensity: "strong" });
    expect(setBackgroundEffect(strong, null)).toBeUndefined();
    expect(setBackgroundIntensity(undefined, "strong")).toBeUndefined();
  });
});

describe("gradients", () => {
  it("start with two pleasant colours, within the limits", () => {
    const gradient = defaultGradient();
    expect(gradient.type).toBe("gradient");
    expect(gradient.colors).toEqual(GRADIENT_PALETTE.slice(0, GRADIENT_COLORS_MIN));
    expect(gradient.colors.length).toBeGreaterThanOrEqual(GRADIENT_COLORS_MIN);
    expect(gradient.colors.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(GRADIENT_PALETTE.length).toBeGreaterThanOrEqual(GRADIENT_COLORS_MAX);
  });

  it("add and remove colours between the fewest and the most", () => {
    let gradient = defaultGradient();
    expect(removeGradientColor(gradient, 0)).toBe(gradient);
    for (let i = 0; i < 10; i++) gradient = addGradientColor(gradient);
    expect(gradient.colors).toHaveLength(GRADIENT_COLORS_MAX);
    expect(new Set(gradient.colors).size).toBe(GRADIENT_COLORS_MAX);
    expect(addGradientColor(gradient)).toBe(gradient);
    gradient = removeGradientColor(gradient, 1);
    expect(gradient.colors).toEqual([GRADIENT_PALETTE[0], GRADIENT_PALETTE[2], GRADIENT_PALETTE[3]]);
    while (gradient.colors.length > GRADIENT_COLORS_MIN) gradient = removeGradientColor(gradient, 0);
    expect(gradient.colors).toHaveLength(GRADIENT_COLORS_MIN);
    expect(removeGradientColor(gradient, 5)).toBe(gradient);
  });

  it("change one colour and leave the others alone", () => {
    const gradient = defaultGradient();
    expect(setGradientColor(gradient, 1, "#000000").colors).toEqual([GRADIENT_PALETTE[0], "#000000"]);
    expect(setGradientColor(gradient, 9, "#000000")).toBe(gradient);
  });

  it("take an angle for the shifting style alone, and leave the default out", () => {
    const shift = setGradientAngle(defaultGradient(), 45);
    expect(shift.angle).toBe(45);
    expect(setGradientAngle(shift, GRADIENT_ANGLE_DEFAULT)).not.toHaveProperty("angle");
    expect(setGradientAngle(shift, 999).angle).toBe(360);
    expect(setGradientStyle(shift, "aurora")).not.toHaveProperty("angle");
    const aurora = defaultGradient("aurora");
    expect(setGradientAngle(aurora, 45)).toBe(aurora);
  });

  it("take a flow, except a mesh, which is still", () => {
    expect(setGradientFlow(defaultGradient(), "fast").flow).toBe("fast");
    const mesh = setGradientStyle({ ...defaultGradient(), flow: "fast" }, "mesh");
    expect(mesh).not.toHaveProperty("flow");
    expect(setGradientFlow(mesh, "fast")).toBe(mesh);
    expect(setGradientStyle(mesh, "conic").flow).toBe("slow");
  });

  it("have a grain that is a switch: off leaves no key", () => {
    const grainy = setGradientGrain(defaultGradient(), true);
    expect(grainy.grain).toBe(true);
    expect(setGradientGrain(grainy, false)).not.toHaveProperty("grain");
  });

  it("are always what a row's schema accepts, with a background motion", () => {
    let gradient: GradientBackground = defaultGradient();
    gradient = addGradientColor(setGradientGrain(setGradientAngle(gradient, 200), true));
    for (const style of ["shift", "aurora", "mesh", "conic"] as const) {
      const row: PageRow = {
        id: "row-1",
        type: "row",
        layout: "1",
        columns: [
          {
            id: "c-1",
            blocks: [],
            background: setGradientStyle(gradient, style),
            backgroundMotion: { effect: "ken-burns", intensity: "subtle" },
          },
        ],
        background: setGradientStyle(gradient, style),
        backgroundMotion: { effect: "drift" },
        motion: { enter: { effect: "fade" } },
      };
      expect(pageRowSchema.safeParse(row).success, style).toBe(true);
    }
  });
});

describe("the page's motion signature", () => {
  const row = (motion?: PartMotion): PageRow => ({
    id: "r",
    type: "row",
    layout: "1",
    columns: [{ id: "c", blocks: [{ id: "b", type: "heading", text: "Hi", level: 2, ...(motion && { motion }) }] }],
  });

  it("is the same until a part's motion changes, and ignores everything else", () => {
    const plain = motionSignature([row()]);
    expect(plain).toBe("[]");
    const a = motionSignature([row({ enter: { effect: "fade" } })]);
    expect(a).not.toBe(plain);
    expect(motionSignature([{ ...row({ enter: { effect: "fade" } }), width: "full" }])).toBe(a);
    expect(motionSignature([row({ enter: { effect: "zoom-in" } })])).not.toBe(a);
  });

  it("counts a background's motion too", () => {
    const rows = [{ ...row(), backgroundMotion: { effect: "drift" as const } }];
    expect(motionSignature(rows)).toContain("drift");
  });
});
