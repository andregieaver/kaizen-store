import { describe, expect, it } from "vitest";

import { DEFAULT_BREAKPOINTS, clampWidth, fitZoom, sizeOfWidth, sizeRange, typicalWidth, type Size } from "./breakpoints";
import { containerCss, scopedCss } from "./custom-css";
import { pageBlockSchema, pageRowSchema, type PageBlock, type PageRow } from "./page-content";
import { canvasHiddenCss, partCss } from "./part-css";
import { clearAt, inheritedAt, setAt, sizeSource, spacingAt, stackAt, stackPatchAt, valueAt, viewAt, visibilityPatch } from "./responsive";

/**
 * Editing at a screen size (D179 phase 2, `docs/responsive-editing.md` 5): the builder's fields write a size's overrides
 * through `setAt()`, show what a size inherits (`viewAt()`, `sizeSource()`), and give an override back (`clearAt()`); the
 * canvas is a container of the size's width, and owner CSS follows it there.
 */

const text = (over: Partial<Extract<PageBlock, { type: "richText" }>> = {}) =>
  ({ id: "b", type: "richText", doc: { type: "doc", content: [] }, ...over }) as Extract<PageBlock, { type: "richText" }>;
const row = (over: Partial<PageRow> = {}): PageRow => ({
  id: "r",
  type: "row",
  layout: "2",
  columns: [
    { id: "c1", blocks: [] },
    { id: "c2", blocks: [] },
  ],
  ...over,
});
const SIZES: Size[] = ["xl", "lg", "md", "sm"];

describe("setAt", () => {
  it("edits the part's own value at Extra large, as before", () => {
    expect(setAt(text(), "xl", { align: "center" })).toEqual({ align: "center" });
    expect(setAt(text({ align: "center" }), "xl", { align: undefined })).toEqual({ align: undefined });
  });

  it("writes a smaller size's own value into at, leaving the part's own and the other sizes alone", () => {
    const block = text({ align: "right", at: { sm: { align: "center" } } });
    const patch = setAt(block, "md", { align: "left" });
    expect(patch).toEqual({ at: { md: { align: "left" }, sm: { align: "center" } } });
    const after = { ...block, ...patch };
    expect(SIZES.map((size) => valueAt(after, "align", size))).toEqual(["right", "right", "left", "center"]);
  });

  it("takes the override away when the value is what the size inherits", () => {
    const block = text({ align: "right", at: { md: { align: "left" } } });
    expect(setAt(block, "md", { align: "right" })).toEqual({ at: undefined });
    // Left is where text starts when nothing is set, so it is no setting under nothing.
    expect(setAt(text(), "md", { align: "left" })).toEqual({ at: undefined });
  });

  it("keeps none at a size under a larger size's border, shadow, colour, blur or width as null", () => {
    const block = text({ border: { width: { top: 1, right: 1, bottom: 1, left: 1 }, color: "#000000", style: "solid" }, shadow: "md" });
    const patch = setAt(block, "sm", { border: undefined, shadow: undefined });
    expect(patch.at).toEqual({ sm: { border: null, shadow: null } });
    expect(pageBlockSchema.parse({ ...block, ...patch }).at).toEqual({ sm: { border: null, shadow: null } });
    // And the stylesheet gives the frame back at Small.
    const css = partCss([{ ...row(), columns: [{ id: "c", blocks: [{ ...block, ...patch } as PageBlock] }], layout: "1" }], "site", DEFAULT_BREAKPOINTS);
    const small = css.slice(css.indexOf("@media (width < 768px)"));
    expect(small).toContain("border-style:revert-layer!important");
    expect(small).toContain("box-shadow:revert-layer!important");
  });

  it("keeps square corners at a size under rounded ones as 0, not as nothing", () => {
    expect(setAt(text({ radius: 12 }), "md", { radius: 0 }).at).toEqual({ md: { radius: 0 } });
    expect(setAt(text(), "md", { radius: 0 }).at).toBeUndefined();
  });

  it("writes margin and padding each on its own, zeros where a larger size had some", () => {
    const block = text({ style: { margin: { top: 10, right: 0, bottom: 10, left: 0 }, padding: { top: 4, right: 4, bottom: 4, left: 4 } } });
    const patch = setAt(block, "sm", { style: { padding: { top: 4, right: 4, bottom: 4, left: 4 } } });
    expect(patch.at).toEqual({ sm: { style: { margin: { top: 0, right: 0, bottom: 0, left: 0 } } } });
    const after = { ...block, ...patch };
    expect(spacingAt(after, "sm")).toEqual({ margin: { top: 0, right: 0, bottom: 0, left: 0 }, padding: { top: 4, right: 4, bottom: 4, left: 4 } });
    expect(spacingAt(after, "md")).toEqual(block.style);
  });

  it("passes settings that never vary by size to the part, at any size", () => {
    expect(setAt(text(), "sm", { font: "Inter" } as Partial<PageBlock>)).toEqual({ font: "Inter", at: undefined });
  });

  it("starts from a patch's own at, as a field that gave an override back sends it", () => {
    const block = text({ at: { md: { align: "center" }, sm: { align: "right" } } });
    expect(setAt(block, "sm", { ...clearAt(block, "md", "align") })).toEqual({ at: { sm: { align: "right" } } });
  });
});

describe("clearAt and sizeSource", () => {
  const block = text({ align: "right", at: { md: { align: "center" } }, style: { padding: { top: 8, right: 8, bottom: 8, left: 8 } } });

  it("says where each size's value comes from", () => {
    expect(sizeSource(block, "xl", "align")).toEqual({ own: true, from: "xl" });
    expect(sizeSource(block, "lg", "align")).toEqual({ own: false, from: "xl" });
    expect(sizeSource(block, "md", "align")).toEqual({ own: true, from: "md" });
    expect(sizeSource(block, "sm", "align")).toEqual({ own: false, from: "md" });
    expect(sizeSource(block, "sm", "padding")).toEqual({ own: false, from: "xl" });
    expect(sizeSource(block, "sm", "margin")).toEqual({ own: false, from: null });
  });

  it("gives an override back, so the size inherits again", () => {
    const after = { ...block, ...clearAt(block, "md", "align") };
    expect(after.at).toBeUndefined();
    expect(valueAt(after, "align", "sm")).toBe("right");
    const spaced = text({ at: { sm: { style: { margin: { top: 1, right: 1, bottom: 1, left: 1 }, padding: { top: 2, right: 2, bottom: 2, left: 2 } } } } });
    expect(clearAt(spaced, "sm", "margin").at).toEqual({ sm: { style: { padding: { top: 2, right: 2, bottom: 2, left: 2 } } } });
  });

  it("reads what a size inherits without its own", () => {
    expect(inheritedAt(block, "align", "md")).toBe("right");
    expect(inheritedAt(block, "align", "sm")).toBe("center");
  });
});

describe("viewAt", () => {
  it("shows every setting at the size, keeping at so where it comes from can still be read", () => {
    const block = text({ align: "right", radius: 8, at: { md: { align: "center", radius: 0 }, sm: { border: null } } });
    const view = viewAt(block, "sm");
    expect(view.align).toBe("center");
    expect(view.radius).toBe(0);
    expect("border" in view).toBe(false);
    expect(view.at).toBe(block.at);
    expect(sizeSource(view, "sm", "align")).toEqual(sizeSource(block, "sm", "align"));
    expect(viewAt(block, "xl")).toBe(block);
  });
});

describe("a row's columns at a size", () => {
  it("stacks on Small unless set, and an override says otherwise there only", () => {
    const plain = row();
    expect(stackPatchAt(plain, "sm", true)).toEqual({ at: undefined });
    const side = { ...plain, ...stackPatchAt(plain, "sm", false) };
    expect(side.at).toEqual({ sm: { stack: false } });
    expect(SIZES.map((size) => stackAt(side, size))).toEqual([false, false, false, false]);
    const medium = { ...plain, ...stackPatchAt(plain, "md", true) };
    expect(SIZES.map((size) => stackAt(medium, size))).toEqual([false, false, true, true]);
  });

  it("keeps a row kept side by side everywhere so at Extra large", () => {
    expect(stackPatchAt(row({ stack: false }), "xl", false)).toEqual({});
    expect(stackPatchAt(row({ stack: true }), "xl", false)).toEqual({ stack: undefined });
    expect(stackPatchAt(row(), "xl", true)).toEqual({ stack: true });
  });

  it("is saved and read back through the row's schema", () => {
    const saved = pageRowSchema.parse({ ...row(), ...stackPatchAt(row(), "sm", false) });
    expect(saved.at).toEqual({ sm: { stack: false } });
  });
});

describe("visibility by size", () => {
  it("switches a size off and on, in the sizes' order", () => {
    const off = visibilityPatch({}, "sm", false);
    expect(off).toEqual({ visibility: { hideAt: ["sm"] } });
    expect(visibilityPatch({ visibility: { hideAt: ["sm"] } }, "xl", false)).toEqual({ visibility: { hideAt: ["xl", "sm"] } });
    expect(visibilityPatch({ visibility: { hideAt: ["sm"] } }, "sm", true)).toEqual({ visibility: undefined });
  });

  it("leaves a row or column out at its sizes on the site, and only there", () => {
    const hidden = row({ visibility: { hideAt: ["md"] }, columns: [{ id: "c1", blocks: [], visibility: { hideAt: ["sm"] } }, { id: "c2", blocks: [] }] });
    const css = partCss([hidden], "site", DEFAULT_BREAKPOINTS);
    expect(css).toMatch(/@media \(768px <= width < 1024px\)\{\n:where\(\.kzr-[^)]+\)\{display:none\}/);
    expect(css).toMatch(/@media \(width < 768px\)\{\n:where\(\.kzr-[^)]+\)\{display:none\}/);
    expect(partCss([hidden], "canvas", DEFAULT_BREAKPOINTS)).not.toContain("display:none");
  });

  it("keeps a hidden part on the canvas, faded with its eye at those sizes, or left out when asked", () => {
    const hidden = row({ columns: [{ id: "c1", blocks: [text({ id: "b1", visibility: { hideAt: ["sm", "md"] } })] }, { id: "c2", blocks: [] }] });
    const faded = canvasHiddenCss([hidden], DEFAULT_BREAKPOINTS, false);
    expect(faded).toContain('@container kz-page (width < 1024px){');
    expect(faded).toContain('[data-builder-id="b1"] > [class~="kz-b1"]{opacity:.4}');
    expect(faded).toContain('[data-builder-id="b1"] > [data-builder-hidden]{display:inline-flex}');
    expect(canvasHiddenCss([hidden], DEFAULT_BREAKPOINTS, true)).toContain('[data-builder-id="b1"]{display:none}');
    expect(canvasHiddenCss([row()], DEFAULT_BREAKPOINTS, false)).toBe("");
  });
});

describe("the canvas at a size", () => {
  it("offers each size's range and a typical width within it", () => {
    expect(sizeRange(DEFAULT_BREAKPOINTS, "sm")).toEqual({ min: 320, max: 767 });
    expect(sizeRange(DEFAULT_BREAKPOINTS, "md")).toEqual({ min: 768, max: 1023 });
    expect(sizeRange(DEFAULT_BREAKPOINTS, "lg")).toEqual({ min: 1024, max: 1279 });
    expect(SIZES.map((size) => typicalWidth(DEFAULT_BREAKPOINTS, size))).toEqual([1440, 1100, 820, 390]);
    for (const size of SIZES) expect(sizeOfWidth(DEFAULT_BREAKPOINTS, typicalWidth(DEFAULT_BREAKPOINTS, size))).toBe(size);
  });

  it("follows a store's own widths, taking the middle where the typical screen is another size", () => {
    const own = { md: 900, lg: 1200, xl: 1600 };
    expect(typicalWidth(own, "md")).toBe(1050);
    expect(typicalWidth(own, "lg")).toBe(1400);
    expect(typicalWidth(own, "xl")).toBe(1760);
    for (const size of SIZES) expect(sizeOfWidth(own, typicalWidth(own, size))).toBe(size);
  });

  it("keeps a typed width within the size and zooms to fit", () => {
    expect(clampWidth(DEFAULT_BREAKPOINTS, "md", 2000)).toBe(1023);
    expect(clampWidth(DEFAULT_BREAKPOINTS, "sm", 10)).toBe(320);
    expect(clampWidth(DEFAULT_BREAKPOINTS, "sm", Number.NaN)).toBe(320);
    expect(fitZoom(900, 440)).toBe(100);
    expect(fitZoom(900, 1150)).toBe(75);
    expect(fitZoom(600, 1490)).toBe(50);
    expect(fitZoom(0, 1490)).toBe(100);
  });
});

describe("owner CSS on the canvas", () => {
  it("turns width media queries into container queries on the canvas", () => {
    expect(containerCss("@media (max-width: 767px) { .a { color: red } }")).toBe("@container kz-page (max-width: 767px) { .a { color: red } }");
    expect(containerCss("@media screen and (min-width:768px) and (max-width:1023px){.a{b:c}}")).toBe(
      "@container kz-page (min-width:768px) and (max-width:1023px) {.a{b:c}}",
    );
    expect(containerCss("@media only screen and (width < 40em){x{y:z}}")).toBe("@container kz-page (width < 40em) {x{y:z}}");
    expect(containerCss("@MEDIA (768px <= width < 1024px){x{y:z}}")).toBe("@container kz-page (768px <= width < 1024px) {x{y:z}}");
    expect(containerCss(".a{b:c}\n@media (max-width: 600px){.d{e:f}}\n.g{h:i}")).toBe(".a{b:c}\n@container kz-page (max-width: 600px) {.d{e:f}}\n.g{h:i}");
  });

  it("leaves queries about anything but the width, lists, comments and strings as they are", () => {
    for (const css of [
      "@media print { .a { display: none } }",
      "@media (prefers-color-scheme: dark) { .a { color: white } }",
      "@media (hover: hover) and (min-width: 600px) { .a { b: c } }",
      "@media (max-width: 600px), print { .a { b: c } }",
      "@media screen { .a { b: c } }",
      "/* @media (max-width: 600px) { */ .a { b: c }",
      '.a::before { content: "@media (max-width: 600px) {" }',
      "@media not all and (max-width: 600px) { .a { b: c } }",
    ]) {
      expect(containerCss(css), css).toBe(css);
    }
  });

  it("is done in the canvas only: a scoped stylesheet with the container, never the site's", () => {
    const css = "@media (max-width: 600px) { .a { color: red } }";
    expect(scopedCss(css, "[data-custom-css]", "kz-page")).toBe("@scope ([data-custom-css]) {\n@container kz-page (max-width: 600px) { .a { color: red } }\n}");
    expect(scopedCss(css, "[data-site-css]")).toBe(`@scope ([data-site-css]) {\n${css}\n}`);
  });
});
