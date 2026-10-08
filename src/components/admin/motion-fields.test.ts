import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The builder imports its owners' actions only as types, but its neighbours read the database; nothing here calls them.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
// The renderer's and the runtime's own tests are theirs; here only what the builder asks of them.
vi.mock("@/lib/motion-attrs", () => ({
  partFx: vi.fn(() => ({ attrs: { "data-fx": "mock" }, style: { "--fx": "1" } })),
  backgroundFx: vi.fn(() => ({ attrs: {}, style: {} })),
  pageUsesMotion: vi.fn(() => false),
}));
vi.mock("@/lib/motion-runtime", () => ({ initMotion: vi.fn(() => () => {}) }));

import { partFx } from "@/lib/motion-attrs";
import {
  BACKGROUND_EFFECTS,
  ENTER_EFFECTS,
  ENTER_IDS,
  GRADIENT_COLORS_MAX,
  HOVER_EFFECTS,
  HOVER_IDS,
  SCROLL_IDS,
  enterFits,
  hoverFits,
  scrollFits,
} from "@/lib/motion";
import { enterOffered, type MotionPart } from "@/lib/motion-edit";
import type { PageRow } from "@/lib/page-content";
import { defaultGradient, setGradientStyle, addGradientColor } from "@/lib/motion-edit";

import { BackgroundMotionFields, GradientFields } from "./gradient-fields";
import { GLYPH_GROUPS, MotionFields, MotionPreview } from "./motion-fields";
import { MotionMark, MotionPreviewToggle, canvasBackground, canvasFx } from "./motion-canvas";
import { PageBuilder } from "./page-builder";

/** Drawn on the server as the other admin components' tests do: what a person sees before any script runs. */
const text = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'");

const ROW: MotionPart = { kind: "row" };
const COLUMN: MotionPart = { kind: "column" };
const HEADING: MotionPart = { kind: "block", blockType: "heading" };
const IMAGE: MotionPart = { kind: "block", blockType: "image" };

const tab = (part: MotionPart, motion?: ComponentProps<typeof MotionFields>["motion"]) =>
  text(createElement(MotionFields, { part, motion, onChange: () => {} }));

/** The radio cards of one section (Entrance, Hover or While scrolling), by their label. */
const cards = (html: string, legend: string) => {
  const start = html.indexOf(`>${legend}</p>`);
  expect(start, legend).toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return [...html.slice(start, end).matchAll(/<button[^>]*role="radio"[^>]*>[\s\S]*?<\/button>/g)].map((m) => ({
    html: m[0],
    label: /class="font-medium">([^<]*)<\/span>/.exec(m[0])?.[1] ?? "",
    checked: /aria-checked="true"/.test(m[0]),
    tabbable: /tabindex="0"/.test(m[0]),
  }));
};

beforeEach(() => vi.mocked(partFx).mockClear());

describe("a part's Motion tab", () => {
  it("has three sections, each a group of radio cards with None chosen when there is no effect", () => {
    const out = tab(COLUMN);
    for (const title of ["Preview", "Entrance", "Hover", "While scrolling"]) expect(out).toContain(`>${title}</h3>`);
    expect(out.match(/role="radiogroup"/g)).toHaveLength(3);
    for (const legend of ["Entrance effect", "Hover effect", "Scroll effect"]) {
      const list = cards(out, legend);
      expect(list[0]).toMatchObject({ label: "None", checked: true, tabbable: true });
      expect(list.filter((c) => c.checked)).toHaveLength(1);
      // One tab stop for the whole group; the arrow keys go between the cards.
      expect(list.filter((c) => c.tabbable)).toHaveLength(1);
    }
    // No settings for an effect that is not chosen, and the effect is not a native select.
    expect(out).not.toContain("Delay");
    expect(out).not.toContain("Speed");
    expect(out).not.toContain('<option value="fade-up"');
  });

  it("explains how effects reach visitors: reduced motion sees none, and the first section is best quiet", () => {
    const out = tab(ROW);
    expect(out).toContain("ask their device for less motion see none of these effects");
    expect(out).toContain("Keep the first section of a page quiet");
  });

  it("offers a row and a column each the entrances and hovers the catalogue says, and no text effects", () => {
    for (const [part, target] of [
      [ROW, "row"],
      [COLUMN, "column"],
    ] as const) {
      const out = tab(part);
      const enter = cards(out, "Entrance effect").map((c) => c.label);
      expect(enter).toEqual([
        "None",
        ...ENTER_IDS.filter((id) => enterFits(id, target)).map((id) => ENTER_EFFECTS[id].label),
      ]);
      expect(enter).not.toContain("Words, one by one");
      const hover = cards(out, "Hover effect").map((c) => c.label);
      expect(hover).toEqual([
        "None",
        ...HOVER_IDS.filter((id) => hoverFits(id, target)).map((id) => HOVER_EFFECTS[id].label),
      ]);
      const scroll = cards(out, "Scroll effect").length - 1;
      expect(scroll).toBe(SCROLL_IDS.filter((id) => scrollFits(id, target)).length);
    }
    // A row cannot tilt, glow or dim; a column can.
    expect(tab(ROW)).not.toContain(">Tilt<");
    expect(tab(COLUMN)).toContain(">Tilt<");
    expect(tab(COLUMN)).toContain(">Dim the rest<");
  });

  it("offers a heading the text effects as well, in a group of their own", () => {
    const out = tab(HEADING);
    for (const label of [
      "Words, one by one",
      "Words, out of focus",
      "Letters, one by one",
      "Lines, one by one",
      "Fade up",
      "Iris",
    ]) {
      expect(out).toContain(`>${label}</span>`);
    }
    expect(out).toContain('aria-label="Text"');
    expect(out).toContain('aria-label="Fade"');
    const groups = enterOffered(HEADING).map((g) => g.group);
    expect(groups).toContain("Text");
  });

  it("offers a heading only the hover and scroll effects that suit text, as the site draws no others on it", () => {
    const out = tab(HEADING);
    const hover = cards(out, "Hover effect").map((c) => c.label);
    expect(hover).toEqual([
      "None",
      ...HOVER_IDS.filter((id) => hoverFits(id, "text")).map((id) => HOVER_EFFECTS[id].label),
    ]);
    expect(hover).toContain("Lift");
    expect(hover).not.toContain("Tilt");
    expect(cards(out, "Scroll effect").map((c) => c.label)).not.toContain("Turn with scroll");
  });

  it("offers an image the effects of a component, its picture zoom, and not the text effects", () => {
    const out = tab(IMAGE);
    expect(out).toContain(">Picture zoom<");
    expect(out).toContain(">Fade up<");
    expect(out).not.toContain(">Words, one by one<");
    expect(out).not.toContain(">Dim the rest<");
    expect(out).not.toContain('aria-label="Text"');
  });

  it("gives every card its hint and a name and description for screen readers", () => {
    const out = tab(COLUMN);
    expect(out).toContain("Rises into place.");
    const first = cards(out, "Entrance effect")[1].html;
    expect(first).toMatch(/aria-labelledby="[^"]+"/);
    expect(first).toMatch(/aria-describedby="[^"]+"/);
  });

  it("shows the chosen effects, with their settings", () => {
    const out = tab(COLUMN, {
      enter: {
        effect: "fade-up",
        speed: "slow",
        delay: 300,
        stagger: 100,
        trigger: "view",
        start: "late",
        once: false,
      },
      hover: { effect: "lift", intensity: "strong" },
      scroll: { effect: "parallax" },
    });
    expect(cards(out, "Entrance effect").find((c) => c.checked)?.label).toBe("Fade up");
    expect(cards(out, "Hover effect").find((c) => c.checked)?.label).toBe("Lift");
    expect(cards(out, "Scroll effect").find((c) => c.checked)?.label).toBe("Parallax");
    for (const text of [
      "When it comes into view",
      "When the page opens",
      "Starts",
      "Well into view",
      "Speed",
      "Distance",
      "Easing",
      // The delay and duration are under Advanced, Animation (D179 phase 3), in seconds.
      "under Advanced, Animation",
      "Time between components",
      "100 ms",
      "Play it again each time it comes into view",
      "Intensity",
    ]) {
      expect(out, text).toContain(text);
    }
    expect(out).toMatch(/<option value="slow" selected="">Slow<\/option>/);
    expect(out).toMatch(/<option value="strong" selected="">Strong<\/option>/);
    expect(out).not.toMatch(/type="range" min="0" max="2000"/);
  });

  it("leaves out what does not apply: no start or repeat when it plays as the page opens, no stagger for a component", () => {
    const load = tab(IMAGE, { enter: { effect: "fade", trigger: "load" } });
    expect(load).not.toContain("Play it again");
    expect(load).not.toMatch(/<label[^>]*>Starts<\/label>/);
    expect(load).not.toContain("Time between");
    expect(tab(IMAGE, { enter: { effect: "fade" } })).toMatch(/<label[^>]*>Starts<\/label>/);
  });

  it("says what a stagger is between, by the part and its effect", () => {
    expect(tab(ROW, { enter: { effect: "fade" } })).toContain("Time between columns");
    expect(tab(HEADING, { enter: { effect: "words" } })).toContain("Time between words");
    expect(tab(HEADING, { enter: { effect: "chars" } })).toContain("Time between letters");
    expect(tab(HEADING, { enter: { effect: "lines" } })).toContain("Time between lines");
    expect(tab(HEADING, { enter: { effect: "fade" } })).not.toContain("Time between");
  });

  it("says so, and still lets the effect be cleared, when the chosen one does not fit the part", () => {
    const out = tab(ROW, { hover: { effect: "tilt" } });
    expect(out).toContain("The chosen effect is not one this part can have");
    const list = cards(out, "Hover effect");
    expect(list.find((c) => c.checked)).toBeUndefined();
    // "None" still holds the tab stop, so the keyboard can reach the cards.
    expect(list[0].tabbable).toBe(true);
  });

  it("has a picture for every group of every catalogue", () => {
    const groups = new Set([
      ...Object.values(ENTER_EFFECTS).map((e) => e.group),
      ...Object.values(HOVER_EFFECTS).map((e) => e.group),
      ...Object.values(BACKGROUND_EFFECTS).map((e) => e.group),
    ]);
    for (const group of groups) expect(GLYPH_GROUPS, group).toContain(group);
    expect(GLYPH_GROUPS).toContain("None");
  });
});

describe("the preview in the tab", () => {
  it("draws the sample with the page's own attributes and styles, every entrance playing at once", () => {
    const out = text(createElement(MotionPreview, { part: HEADING, motion: { enter: { effect: "words" } } }));
    expect(out).toContain('data-fx="mock"');
    expect(out).toContain(">Replay<");
    expect(partFx).toHaveBeenCalledWith({ enter: { effect: "words" } }, "text", { preview: true });
  });

  it("has a Replay button that waits for an entrance, and says when there is nothing to see yet", () => {
    const out = text(createElement(MotionPreview, { part: ROW, motion: undefined }));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Replay<\/button>/);
    expect(out).toContain("Choose an effect below to see it here.");
    expect(partFx).not.toHaveBeenCalled();
  });

  it("plays a row's columns and a column's components in turn when the entrance has a stagger", () => {
    const enter = { effect: "fade-up" as const, stagger: 150 };
    text(createElement(MotionPreview, { part: ROW, motion: { enter } }));
    expect(partFx).toHaveBeenCalledWith({ enter }, "row", { preview: true });
    expect(partFx).toHaveBeenCalledWith(undefined, "column", {
      preview: true,
      index: 2,
      parentStagger: 150,
      parentEnter: enter,
    });
    vi.mocked(partFx).mockClear();
    text(createElement(MotionPreview, { part: COLUMN, motion: { enter } }));
    expect(partFx).toHaveBeenCalledWith(undefined, "block", {
      preview: true,
      index: 1,
      parentStagger: 150,
      parentEnter: enter,
    });
    vi.mocked(partFx).mockClear();
    // With no stagger, or for a component, nothing plays in turn.
    text(createElement(MotionPreview, { part: ROW, motion: { enter: { effect: "fade" } } }));
    text(createElement(MotionPreview, { part: IMAGE, motion: { enter } }));
    expect(vi.mocked(partFx).mock.calls.filter(([m]) => m === undefined)).toHaveLength(0);
  });

  it("tells people to point at it for a hover effect, and gives a scroll effect its own box to scroll", () => {
    const hover = text(createElement(MotionPreview, { part: IMAGE, motion: { hover: { effect: "tilt" } } }));
    expect(hover).toContain("Point at the sample to see the hover effect.");
    expect(hover).not.toContain("Scroll inside this box");
    const scroll = text(
      createElement(MotionPreview, {
        part: COLUMN,
        motion: { enter: { effect: "fade" }, scroll: { effect: "parallax" } },
      }),
    );
    expect(scroll).toContain("Scroll inside this box");
    expect(scroll).toMatch(/class="[^"]*h-32 overflow-y-auto[^"]*"/);
    expect(scroll).toContain('aria-label="Scroll this box to see the scroll effect"');
    // The entrance and hover sample and the scroll sample each get their own part of the motion.
    expect(partFx).toHaveBeenCalledWith({ enter: { effect: "fade" } }, "column", { preview: true });
    expect(partFx).toHaveBeenCalledWith({ scroll: { effect: "parallax" } }, "column", { preview: true });
  });
});

describe("the gradient controls", () => {
  const gradient = (over: Partial<ReturnType<typeof defaultGradient>> = {}) =>
    text(createElement(GradientFields, { value: { ...defaultGradient(), ...over }, onChange: () => {} }));

  it("offer each style, colours to change, add and remove, an angle, a flow and a grain", () => {
    const out = gradient();
    for (const label of [
      "Shifting",
      "Aurora",
      "Mesh",
      "Sweep",
      "Colour 1",
      "Colour 2",
      "Add a colour",
      "Angle",
      "How it moves",
      "Grain",
    ]) {
      expect(out, label).toContain(label);
    }
    expect(out).toContain("135°");
    expect(out).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*value="shift"/);
  });

  it("keep to two to four colours: nothing to remove at two, nothing to add at four", () => {
    const two = gradient();
    expect(two).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remove colour 1"/);
    expect(two).not.toMatch(/<button[^>]*disabled=""[^>]*>Add a colour/);
    let full = defaultGradient();
    while (full.colors.length < GRADIENT_COLORS_MAX) full = addGradientColor(full);
    const four = text(createElement(GradientFields, { value: full, onChange: () => {} }));
    expect(four).toContain("Colour 4");
    expect(four).toMatch(/<button[^>]*disabled=""[^>]*>Add a colour/);
    expect(four).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remove colour 1"/);
  });

  it("show an angle for the shifting style only, and a flow for all but the mesh", () => {
    const styled = (style: "shift" | "aurora" | "mesh" | "conic") =>
      text(createElement(GradientFields, { value: setGradientStyle(defaultGradient(), style), onChange: () => {} }));
    expect(styled("shift")).toContain("Angle");
    for (const style of ["aurora", "mesh", "conic"] as const) expect(styled(style), style).not.toContain(">Angle<");
    expect(styled("aurora")).toContain("How it moves");
    expect(styled("mesh")).not.toContain("How it moves");
  });

  it("show the grain as chosen", () => {
    expect(gradient({ grain: true })).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(gradient()).not.toMatch(/type="checkbox"[^>]*checked=""/);
  });
});

describe("the background motion controls", () => {
  it("offer the catalogue's effects for the part, with None chosen, and an intensity once one is", () => {
    const none = text(createElement(BackgroundMotionFields, { target: "row", value: undefined, onChange: () => {} }));
    expect(none).toContain("Background motion");
    for (const effect of Object.values(BACKGROUND_EFFECTS)) expect(none).toContain(`>${effect.label}</span>`);
    expect(none).not.toContain("Intensity");
    const chosen = text(
      createElement(BackgroundMotionFields, {
        target: "column",
        value: { effect: "ken-burns", intensity: "strong" },
        onChange: () => {},
      }),
    );
    expect(chosen).toMatch(/aria-checked="true"[^>]*>[\s\S]*?Slow zoom/);
    expect(chosen).toContain("Intensity");
    expect(chosen).toMatch(/<option value="strong" selected="">Strong<\/option>/);
  });
});

describe("the canvas's motion preview", () => {
  it("is a switch, off to start with, and offers Replay only while it is on", () => {
    const off = text(createElement(MotionPreviewToggle, { on: false, onChange: () => {}, onReplay: () => {} }));
    expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(off).toContain("Preview motion");
    expect(off).not.toContain("Replay");
    const on = text(createElement(MotionPreviewToggle, { on: true, onChange: () => {}, onReplay: () => {} }));
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(on).toContain(">Replay<");
    // Said in words, too, for who prefers less motion.
    expect(on).toContain("Visitors who prefer less motion see none");
  });

  it("gives a part the page's attributes only while it is on", () => {
    expect(canvasFx(false, { enter: { effect: "fade" } }, "row")).toEqual({ attrs: {}, style: {} });
    expect(partFx).not.toHaveBeenCalled();
    const fx = canvasFx(true, { enter: { effect: "fade" } }, "column", { index: 1, parentStagger: 100 });
    expect(fx.attrs).toEqual({ "data-fx": "mock" });
    expect(partFx).toHaveBeenCalledWith({ enter: { effect: "fade" } }, "column", {
      index: 1,
      parentStagger: 100,
      preview: true,
    });
    expect(canvasBackground(false, { effect: "drift" })).toEqual({});
    expect(canvasBackground(true, { effect: "drift" }, true)).toEqual({
      motion: { effect: "drift" },
      firstRow: true,
      preview: true,
    });
  });

  it("marks a part that has motion in its tools, in words as well", () => {
    const out = text(createElement(MotionMark));
    expect(out).toContain("Has motion effects");
  });
});

const rows = (): PageRow[] => [
  {
    id: "row-1",
    type: "row",
    layout: "2",
    motion: { enter: { effect: "fade" } },
    columns: [
      {
        id: "c-1",
        blocks: [{ id: "b-1", type: "heading", text: "Hello", level: 2, motion: { hover: { effect: "lift" } } }],
      },
      { id: "c-2", blocks: [{ id: "b-2", type: "richText", doc: { type: "doc", content: [] } as never }] },
    ],
  },
];

const builder = (over: Partial<ComponentProps<typeof PageBuilder>> = {}) =>
  text(
    createElement(PageBuilder, {
      pageType: "page",
      rows: rows(),
      onRows: () => {},
      saved: [],
      onSaved: () => {},
      upload: null,
      aside: createElement("p", null, "Page title"),
      grid: {
        pageId: null,
        owner: null,
        pageTerms: [],
        articleTerms: [],
        stores: [],
        menus: [],
        menusHref: "/menus",
        plans: null,
        actions: {} as never,
      },
      fonts: {
        site: { heading: null, body: null } as never,
        style: undefined,
        install: async () => ({ ok: true as const }),
        theme: null,
      },
      ...over,
    }),
  );

describe("the builder's canvas", () => {
  it("has the motion switch off, draws no motion at all and marks only the parts that have some", () => {
    const out = builder();
    expect(out).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*>[\s\S]*?Preview motion/);
    expect(partFx).not.toHaveBeenCalled();
    expect(out).not.toContain('data-fx="mock"');
    // The row and the heading have motion; the column and the text do not.
    expect(out.match(/>Has motion effects<\/span>/g)).toHaveLength(2);
  });

  it("has no motion switch while a page is translated", () => {
    const out = builder({ translate: { name: "Norsk", mainName: "English", source: [] } });
    expect(out).not.toContain("Preview motion");
  });
});
