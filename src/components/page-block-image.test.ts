import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ShownGroup } from "@/lib/custom-fields";
import { bindPage } from "@/lib/field-binding";
import {
  IMAGE_SHAPES,
  IMAGE_SHAPE_RATIO,
  newPageContent,
  type ImageBlock,
  type ImageShape,
  type PageBlock,
  type PageContent,
  type PageRow,
} from "@/lib/page-content";

import { PageArticle } from "./page-article";
import { SHAPES } from "./page-block";
import { blockBox } from "./page-parts";

// The page's server-only sections are imported but not drawn here.
vi.mock("server-only", () => ({}));

/**
 * A picture block keeps its own size (D151), read from the markup the site really draws (`PageArticle`):
 * `blockBox()`'s wrapper is the picture-sized box (it holds the frame, the effects and the placement), the figure is its
 * only child, and the picture inside takes its size from its width and height attributes, never from the column.
 */

const PICTURE = { url: "https://cdn.example.com/oak.webp", width: 800, height: 600, alt: "An oak table" };
const image = (over: Partial<ImageBlock> = {}): ImageBlock => ({ id: "i1", type: "image", image: PICTURE, caption: "", ...over });

const rowOf = (id: string, ...blocks: PageBlock[]): PageRow => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}c`, blocks }],
});
const page = (...rows: PageRow[]): PageContent => ({ ...newPageContent(), title: "Page", rows });
const draw = (content: PageContent) => renderToString(createElement(PageArticle, { content }));
/** One picture block, alone on the page's first row. */
const drawOne = (block: PageBlock) => draw(page(rowOf("r1", block)));

// ---------------------------------------------------------------------------
// Reading the markup
// ---------------------------------------------------------------------------

type Tag = { attrs: Record<string, string>; classes: string[]; style: Record<string, string> };

/** A tag's attributes (the text between `<name` and `>`), its classes by token and its inline style by property. */
function tag(attributes: string): Tag {
  const attrs: Record<string, string> = {};
  for (const m of attributes.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[m[1]] = m[2] ?? "";
  const style: Record<string, string> = {};
  for (const declaration of (attrs.style ?? "").split(";")) {
    const at = declaration.indexOf(":");
    if (at > 0) style[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
  }
  return { attrs, classes: (attrs.class ?? "").split(/\s+/).filter(Boolean), style };
}

type Drawn = { wrapper: Tag; figure: Tag; img: Tag; caption: Tag | null; captionText: string | null; figureHtml: string };

/**
 * The picture as drawn: the block's wrapper `<div>`, the `<figure>` that must be its direct and only child, the `<img>` and
 * the caption that must be inside the figure. Throws when the markup is any other shape, which is itself the failure.
 */
function drawnPicture(html: string): Drawn {
  const found = /<div((?: [^>]*)?)><figure([^>]*)>([\s\S]*?)<\/figure><\/div>/.exec(html);
  if (!found) throw new Error(`No <figure> that is the only child of its block wrapper in:\n${html}`);
  const [, wrapper, figure, inner] = found;
  const img = /<img ([^>]*?)\/?>/.exec(inner);
  if (!img) throw new Error(`No <img> inside the figure: ${inner}`);
  const caption = /<figcaption([^>]*)>([\s\S]*?)<\/figcaption>/.exec(inner);
  return {
    wrapper: tag(wrapper),
    figure: tag(figure),
    img: tag(img[1]),
    caption: caption ? tag(caption[1]) : null,
    captionText: caption ? caption[2] : null,
    figureHtml: inner,
  };
}

const numberOf = (value: string | undefined) => Number(value);
/** The wrapper's alignment-by-margin classes (`mx-auto`, `lg:ml-auto`, `md:mr-0`, ...), in the order they are written. */
const marginClasses = (classes: string[]) => classes.filter((c) => /^(?:md:|lg:)?m[xlr]-/.test(c));

// ---------------------------------------------------------------------------
// The box and the picture
// ---------------------------------------------------------------------------

describe("a picture block on the site: its own size", () => {
  let out: Drawn;
  beforeAll(() => {
    out = drawnPicture(drawOne(image({ caption: "A table in oak" })));
  });

  it("is a box as wide as the picture, limited by a class and a custom property", () => {
    expect(out.wrapper.classes).toContain("box-content");
    expect(out.wrapper.classes).toContain("max-w-(--picture-width)");
    expect(out.wrapper.style["--picture-width"]).toBe("800px");
  });

  it("never sets the width as an inline width or max-width, so owner CSS and the replicator's rules can override it", () => {
    const widths = Object.keys(out.wrapper.style).filter((property) => /width|height/.test(property) && property !== "--picture-width");
    expect(widths).toEqual([]);
    expect(out.wrapper.classes.filter((c) => /^(?:md:|lg:)?(?:w|min-w|h)-/.test(c))).toEqual([]);
  });

  it("gives the picture its size as attributes and lets the column shrink it, without stretching it", () => {
    expect(out.img.attrs.src).toBe(PICTURE.url);
    expect(out.img.attrs.alt).toBe("An oak table");
    expect(numberOf(out.img.attrs.width)).toBe(800);
    expect(numberOf(out.img.attrs.height)).toBe(600);
    expect(out.img.classes).toEqual(expect.arrayContaining(["h-auto", "max-w-full", "bg-surface", "rounded-lg"]));
    // `w-full` would stretch a small picture to the column, and is a cyclic percentage in a shrink-wrapped box.
    expect(out.img.classes).not.toContain("w-full");
    expect(out.img.classes.filter((c) => /(^|:)w-/.test(c))).toEqual([]);
  });

  it("has no width, max-width or height in the picture's style attribute", () => {
    // Next only adds `color:transparent`; the replicator's `#id img` rule must be able to set a width of its own.
    expect(Object.keys(out.img.style).filter((property) => /width|height/.test(property))).toEqual([]);
  });

  it("is a plain figure that is the wrapper's direct and only child", () => {
    // `drawnPicture` already needs `<div wrapper><figure>…</figure></div>`; pin the nesting once, in the words of the markup.
    expect(drawOne(image())).toMatch(/<div[^>]*><figure><img [^>]*\/><\/figure><\/div>/);
    expect(out.figure.attrs.class).toBeUndefined();
    // A column-flex figure would stretch an auto-width picture; a shrink-to-fit or inline one would collapse a `width: 100%`.
    expect(out.figure.classes.filter((c) => /^(?:flex|inline|grid|float-|w-)/.test(c))).toEqual([]);
  });

  it("keeps the caption inside the figure, under the picture, with its own room above", () => {
    expect(out.caption).not.toBeNull();
    expect(out.captionText).toBe("A table in oak");
    expect(out.caption!.classes).toEqual(expect.arrayContaining(["mt-2", "text-sm", "text-muted"]));
    expect(out.figureHtml.indexOf("<img")).toBeLessThan(out.figureHtml.indexOf("<figcaption"));
    expect(out.figureHtml).toMatch(/<\/figcaption>$/);
  });

  it("draws no caption element without a caption", () => {
    const bare = drawnPicture(drawOne(image({ caption: "" })));
    expect(bare.caption).toBeNull();
    expect(bare.figureHtml).not.toContain("figcaption");
  });

  it("puts no placement class on a picture that was never placed", () => {
    expect(marginClasses(out.wrapper.classes)).toEqual([]);
    expect(out.wrapper.classes.filter((c) => /(^|:)text-(left|center|right)$/.test(c))).toEqual([]);
  });

  it("keeps the block's own id and classes on the picture-sized box", () => {
    const own = drawnPicture(drawOne(image({ htmlId: "hero-picture", className: "my-picture" })));
    expect(own.wrapper.attrs.id).toBe("hero-picture");
    expect(own.wrapper.classes).toContain("my-picture");
    expect(own.wrapper.classes).toContain("max-w-(--picture-width)");
  });
});

describe("a picture made narrower", () => {
  it("is limited to the width given, with the height in the same shape", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 300 })));
    expect(out.wrapper.style["--picture-width"]).toBe("300px");
    expect(numberOf(out.img.attrs.width)).toBe(300);
    expect(numberOf(out.img.attrs.height)).toBe(225);
  });

  it("is never enlarged past its own size", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 2000 })));
    expect(out.wrapper.style["--picture-width"]).toBe("800px");
    expect(numberOf(out.img.attrs.width)).toBe(800);
    expect(numberOf(out.img.attrs.height)).toBe(600);
  });

  it("is as wide as its own size when the width given is exactly that", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 800 })));
    expect(out.wrapper.style["--picture-width"]).toBe("800px");
    expect(numberOf(out.img.attrs.width)).toBe(800);
  });
});

describe("a cropped picture", () => {
  const big = { url: "https://cdn.example.com/wide.webp", width: 1600, height: 900, alt: "Wide" };
  const shapes = Object.keys(IMAGE_SHAPES) as ImageShape[];

  it("draws the crop's own size inside the picture, never enlarged", () => {
    const expected: Record<ImageShape, [number, number]> = {
      landscape: [1200, 900],
      portrait: [675, 900],
      panorama: [1600, 533],
      square: [900, 900],
      circle: [900, 900],
    };
    for (const shape of shapes) {
      const out = drawnPicture(drawOne(image({ image: big, shape })));
      expect([shape, numberOf(out.img.attrs.width), numberOf(out.img.attrs.height)]).toEqual([shape, ...expected[shape]]);
      expect(out.wrapper.style["--picture-width"]).toBe(`${expected[shape][0]}px`);
    }
  });

  it("has width and height attributes in the shape of its aspect class, so nothing jumps when it loads", () => {
    for (const shape of shapes) {
      const out = drawnPicture(drawOne(image({ image: big, shape, maxWidth: 400 })));
      const aspect = out.img.classes.find((c) => c.startsWith("aspect-"));
      expect(aspect, `${shape} has an aspect class`).toBeDefined();
      const ratio = numberOf(out.img.attrs.width) / numberOf(out.img.attrs.height);
      expect(ratio).toBeCloseTo(aspectRatioOf(aspect!), 1);
      expect(numberOf(out.img.attrs.width)).toBe(400);
      expect(out.img.classes).toContain("h-auto");
      expect(out.img.classes).toContain("max-w-full");
      expect(out.img.classes).not.toContain("w-full");
    }
  });

  it("draws a circle as round and a landscape as rounded", () => {
    expect(drawnPicture(drawOne(image({ image: big, shape: "circle" }))).img.classes).toContain("rounded-full");
    expect(drawnPicture(drawOne(image({ image: big, shape: "landscape" }))).img.classes).toContain("rounded-lg");
  });
});

/** An `aspect-*` class as width over height. */
function aspectRatioOf(className: string): number {
  if (className === "aspect-square") return 1;
  if (className === "aspect-video") return 16 / 9;
  const m = /^aspect-\[(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]$/.exec(className);
  if (!m) throw new Error(`Cannot read ${className} as a ratio`);
  return Number(m[1]) / Number(m[2]);
}

describe("the crops' ratios", () => {
  it("are the same in SHAPES' aspect classes and in IMAGE_SHAPE_RATIO, for every shape", () => {
    expect(Object.keys(SHAPES).sort()).toEqual(Object.keys(IMAGE_SHAPES).sort());
    expect(Object.keys(IMAGE_SHAPE_RATIO).sort()).toEqual(Object.keys(IMAGE_SHAPES).sort());
    for (const shape of Object.keys(IMAGE_SHAPES) as ImageShape[]) {
      const aspect = SHAPES[shape].split(/\s+/).filter((c) => c.startsWith("aspect-"));
      expect(aspect, `${shape} has exactly one aspect class`).toHaveLength(1);
      expect(aspectRatioOf(aspect[0]), shape).toBeCloseTo(IMAGE_SHAPE_RATIO[shape], 10);
    }
  });
});

// ---------------------------------------------------------------------------
// Where it sits
// ---------------------------------------------------------------------------

describe("a picture placed by screen", () => {
  it("is centred on phones and right on computers by auto margins, and its caption follows by text alignment", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 300, align: { mobile: "center", desktop: "right" } })));
    expect(out.wrapper.classes).toEqual(expect.arrayContaining(["mx-auto", "lg:ml-auto", "lg:mr-0"]));
    expect(out.wrapper.classes).toEqual(expect.arrayContaining(["text-center", "lg:text-right"]));
    expect(marginClasses(out.wrapper.classes).sort()).toEqual(["lg:ml-auto", "lg:mr-0", "mx-auto"]);
    // The caption sits in the figure, which sits in the placed box.
    expect(out.wrapper.style["--picture-width"]).toBe("300px");
  });

  it("takes the left again on tablets after the middle on phones", () => {
    const out = drawnPicture(drawOne(image({ align: { mobile: "center", tablet: "left" } })));
    expect(marginClasses(out.wrapper.classes).sort()).toEqual(["md:ml-0", "md:mr-0", "mx-auto"]);
    expect(out.wrapper.classes).toEqual(expect.arrayContaining(["text-center", "md:text-left"]));
  });

  it("writes every screen's every side as whole classes", () => {
    const expected = {
      mobile: { left: [], center: ["mx-auto"], right: ["ml-auto"] },
      tablet: { left: ["md:ml-0", "md:mr-0"], center: ["md:mx-auto"], right: ["md:ml-auto", "md:mr-0"] },
      desktop: { left: ["lg:ml-0", "lg:mr-0"], center: ["lg:mx-auto"], right: ["lg:ml-auto", "lg:mr-0"] },
    } as const;
    for (const screen of ["mobile", "tablet", "desktop"] as const) {
      for (const side of ["left", "center", "right"] as const) {
        const out = drawnPicture(drawOne(image({ align: { [screen]: side } })));
        expect([screen, side, marginClasses(out.wrapper.classes).sort()]).toEqual([screen, side, [...expected[screen][side]].sort()]);
      }
    }
  });

  it("leaves a picture placed left on phones with no auto margin", () => {
    const out = drawnPicture(drawOne(image({ align: { mobile: "left" } })));
    expect(marginClasses(out.wrapper.classes)).toEqual([]);
    expect(out.wrapper.classes).toContain("text-left");
  });

  it("puts no margin class on a picture with no placement, even when it is narrower", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 200 })));
    expect(marginClasses(out.wrapper.classes)).toEqual([]);
    expect(out.wrapper.classes.filter((c) => /(^|:)m[xlr]-/.test(c))).toEqual([]);
  });

  it("is placed by a margin that is not !important, so the owner's own margin and CSS can still win", () => {
    const out = drawnPicture(drawOne(image({ align: { mobile: "center", tablet: "right", desktop: "left" } })));
    expect(out.wrapper.classes.filter((c) => c.includes("!"))).toEqual([]);
  });

  it("keeps an inline margin from the block's spacing beside the placement classes (the inline margin wins)", () => {
    const out = drawnPicture(
      drawOne(
        image({
          maxWidth: 300,
          align: { mobile: "center" },
          style: { margin: { top: 4, right: 0, bottom: 4, left: 12 }, padding: { top: 8, right: 8, bottom: 8, left: 8 } },
        }),
      ),
    );
    // A style attribute beats `mx-auto`: a left margin set under Spacing takes the place of Position on that side.
    expect(out.wrapper.style["margin-left"]).toBe("12px");
    expect(out.wrapper.style["margin-top"]).toBe("4px");
    expect(out.wrapper.style["margin-bottom"]).toBe("4px");
    expect(out.wrapper.style).not.toHaveProperty("margin-right");
    expect(out.wrapper.classes).toContain("mx-auto");
    expect(out.wrapper.style["padding-top"]).toBe("8px");
    expect(out.wrapper.style["--picture-width"]).toBe("300px");
    // The padding is outside the picture's width, so the picture still gets all of it.
    expect(out.wrapper.classes).toContain("box-content");
  });

  it("never gives a heading or a button the picture's auto margins, though they align by text", () => {
    const blocks: PageBlock[] = [
      { id: "h", type: "heading", text: "Hello", level: 2, align: { mobile: "center", desktop: "right" } },
      { id: "t", type: "button", label: "Go", href: "/go", align: { mobile: "center" } },
    ];
    for (const block of blocks) {
      const classes = (blockBox(block, "site").className ?? "").split(/\s+/);
      expect(classes, block.type).toContain("text-center");
      expect(marginClasses(classes), block.type).toEqual([]);
    }
    // And a picture with the very same alignment does get them.
    expect(marginClasses((blockBox(image({ align: { mobile: "center", desktop: "right" } }), "site").className ?? "").split(/\s+/)).sort()).toEqual([
      "lg:ml-auto",
      "lg:mr-0",
      "mx-auto",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The frame hugs the picture
// ---------------------------------------------------------------------------

describe("a picture's frame", () => {
  const border = { style: "solid" as const, color: "#112233", width: { top: 2, right: 2, bottom: 2, left: 2 } };

  it("is on the same box as the picture's width: border, corners and shadow hug the picture", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 300, border, radius: 12, shadow: "md" })));
    expect(out.wrapper.style["--picture-width"]).toBe("300px");
    expect(out.wrapper.style["border-style"]).toBe("solid");
    expect(out.wrapper.style["border-color"]).toBe("#112233");
    for (const side of ["top", "right", "bottom", "left"]) expect(out.wrapper.style[`border-${side}-width`]).toBe("2px");
    expect(out.wrapper.style["border-radius"]).toBe("12px");
    expect(out.wrapper.style["box-shadow"]).toBe("0 4px 12px rgb(0 0 0 / 0.12)");
    // Rounded corners clip the picture as before.
    expect(out.wrapper.classes).toContain("overflow-hidden");
    expect(out.wrapper.classes).toContain("box-content");
  });

  it("puts none of it on the picture itself", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 300, border, radius: 12, shadow: "md" })));
    expect(Object.keys(out.img.style).filter((property) => /border|shadow|radius/.test(property))).toEqual([]);
    expect(out.figure.attrs.style).toBeUndefined();
  });

  it("clips only when it has a radius", () => {
    expect(drawnPicture(drawOne(image({ border }))).wrapper.classes).not.toContain("overflow-hidden");
    expect(drawnPicture(drawOne(image({ radius: 8 }))).wrapper.classes).toContain("overflow-hidden");
    expect(drawnPicture(drawOne(image())).wrapper.style["border-radius"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Where there is no picture, and other kinds of block
// ---------------------------------------------------------------------------

describe("blocks that are not a drawn picture", () => {
  it("gives a picture block without a picture no width limit, on the canvas or the site, whatever width it holds", () => {
    for (const block of [image({ image: null }), image({ image: null, maxWidth: 300, align: { mobile: "center" } })]) {
      for (const mode of ["site", "canvas"] as const) {
        const box = blockBox(block, mode);
        expect(box.className ?? "", `${mode}`).not.toContain("max-w-(--picture-width)");
        expect(box.className ?? "", `${mode}`).not.toContain("box-content");
        expect(Object.keys(box.style ?? {}), `${mode}`).not.toContain("--picture-width");
        // The empty block's placeholder keeps the whole column: no auto margin either.
        expect(marginClasses((box.className ?? "").split(/\s+/)), `${mode}`).toEqual([]);
      }
      expect(drawOne(block)).not.toContain("--picture-width");
    }
  });

  it("gives a picture block with a picture the limit in both modes", () => {
    for (const mode of ["site", "canvas"] as const) {
      const box = blockBox(image({ maxWidth: 300 }), mode);
      expect(box.className).toContain("max-w-(--picture-width)");
      expect((box.style as Record<string, string>)["--picture-width"]).toBe("300px");
    }
  });

  it("gives no other kind of block a picture's limit", () => {
    const others: PageBlock[] = [
      { id: "h", type: "heading", text: "Hello", level: 2 },
      { id: "b", type: "button", label: "Go", href: "/go" },
      {
        id: "t",
        type: "richText",
        doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Words" }] }] },
      },
    ];
    for (const block of others) {
      for (const mode of ["site", "canvas"] as const) {
        const box = blockBox(block, mode);
        expect(box.className ?? "", block.type).not.toContain("max-w-(--picture-width)");
        expect(box.className ?? "", block.type).not.toContain("box-content");
        expect(Object.keys(box.style ?? {}), block.type).not.toContain("--picture-width");
      }
    }
    const html = draw(page(rowOf("r1", ...others)));
    expect(html).toContain("Hello");
    expect(html).not.toContain("--picture-width");
    expect(html).not.toContain("max-w-(--picture-width)");
  });
});

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

describe("a picture with motion", () => {
  it("keeps a first-row picture from starting transparent, on the box that is as wide as the picture", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 300, motion: { enter: { effect: "fade", delay: 300 } } })));
    expect(out.wrapper.attrs["data-fx-nofade"]).toBe("");
    expect(out.wrapper.attrs["data-fx-enter"]).toBe("fade");
    expect(out.wrapper.attrs["data-fx-trigger"]).toBe("load");
    // The effect's own properties come after the picture's width in the same style attribute, and do not take it away.
    expect(out.wrapper.style["--fx-delay"]).toBe("300ms");
    expect(out.wrapper.style["--picture-width"]).toBe("300px");
    expect(out.wrapper.classes).toContain("max-w-(--picture-width)");
  });

  it("does not mark a picture below the first row as needing to stay visible, and makes it wait for its place", () => {
    const html = draw(
      page(rowOf("r1", { id: "h", type: "heading", text: "First row", level: 2 }), rowOf("r2", image({ motion: { enter: { effect: "fade" } } }))),
    );
    const out = drawnPicture(html);
    expect(out.wrapper.attrs["data-fx-enter"]).toBe("fade");
    expect(out.wrapper.attrs["data-fx-trigger"]).toBe("view");
    expect(out.wrapper.attrs).not.toHaveProperty("data-fx-nofade");
  });

  it("puts its hover effect on the box that hugs the picture", () => {
    const out = drawnPicture(drawOne(image({ maxWidth: 300, motion: { hover: { effect: "glow" } } })));
    expect(out.wrapper.attrs["data-fx-hover"]).toBe("glow");
    expect(out.wrapper.style["--picture-width"]).toBe("300px");
  });
});

// ---------------------------------------------------------------------------
// Bound to a custom field
// ---------------------------------------------------------------------------

describe("a picture bound to a custom field", () => {
  const groups: ShownGroup[] = [
    {
      id: "g1",
      name: "Specs",
      slug: "specs",
      position: "normal" as never,
      fields: [
        {
          id: "f_pict000",
          name: "f_pict000",
          label: "Picture",
          type: "image",
          value: { url: "https://cdn.example.com/bound.webp", thumbnailUrl: null, alt: "A bound table" },
          text: "",
        } as ShownGroup["fields"][number],
      ],
    },
  ];
  const bound = (over: Partial<ImageBlock> = {}): ImageBlock =>
    image({ image: null, caption: "From a field", bind: { fieldId: "f_pict000" }, ...over });
  const drawBound = (block: ImageBlock) => drawnPicture(draw(bindPage(page(rowOf("r1", block)), groups)));

  it("draws the field's picture and words, at the size the field stands in with", () => {
    const out = drawBound(bound());
    expect(out.img.attrs.src).toBe("https://cdn.example.com/bound.webp");
    expect(out.img.attrs.alt).toBe("A bound table");
    expect(numberOf(out.img.attrs.width)).toBe(1600);
    expect(numberOf(out.img.attrs.height)).toBe(1200);
    expect(out.wrapper.style["--picture-width"]).toBe("1600px");
    expect(out.captionText).toBe("From a field");
  });

  it("still limits the width and places it, and keeps the block's margin, padding and frame", () => {
    const out = drawBound(
      bound({
        maxWidth: 400,
        align: { desktop: "center" },
        radius: 6,
        style: { margin: { top: 10, right: 0, bottom: 10, left: 0 }, padding: { top: 5, right: 5, bottom: 5, left: 5 } },
      }),
    );
    expect(out.img.attrs.src).toBe("https://cdn.example.com/bound.webp");
    expect(out.wrapper.style["--picture-width"]).toBe("400px");
    expect(numberOf(out.img.attrs.width)).toBe(400);
    expect(numberOf(out.img.attrs.height)).toBe(300);
    expect(out.wrapper.classes).toContain("lg:mx-auto");
    expect(out.wrapper.classes).toContain("overflow-hidden");
    expect(out.wrapper.style["margin-top"]).toBe("10px");
    expect(out.wrapper.style["padding-left"]).toBe("5px");
    expect(out.wrapper.style["border-radius"]).toBe("6px");
  });

  it("draws nothing, and no limit, where the field has no picture", () => {
    const html = draw(bindPage(page(rowOf("r1", bound({ maxWidth: 400 }))), []));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("--picture-width");
  });
});
