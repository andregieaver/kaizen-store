import { describe, expect, it } from "vitest";

import { DEFAULT_BREAKPOINTS, breakpointQueries, breakpointsOf, breakpointsProblem, sizeRuns, sizesQuery, type Size } from "./breakpoints";
import { pageBlockSchema, pageInput, pageRowSchema, newPageContent, ROW_LAYOUTS, type ContentGridBlock, type ImageBlock, type PageBlock, type PageRow, type RowLayout, type TextAlign, type TextAlignments } from "./page-content";
import { blockStyle, gridListStyle, partCss, renderPartCss, rowGridStyle, rowStyle, type PartRule } from "./part-css";
import { partStyleAt, WIDTHS } from "./part-css.testing";
import {
  alignPatch,
  alignView,
  carouselAt,
  columnsPatch,
  columnsView,
  hiddenAt,
  hideOnPhonesPatch,
  reversePatch,
  rowReversedOnPhones,
  rowSideBySide,
  sideBySidePatch,
  spacingAt,
  stackAt,
  upgradeBlock,
  upgradeResponsive,
  upgradeRow,
  valueAt,
  withAt,
} from "./responsive";
import { parseStoreTheme, templateSettings, themeSettingsSchema } from "./theme";
import { typographyValueAt } from "./typography";

/**
 * Responsive editing, phase 1 (D179, `docs/responsive-editing.md` 3): the per-size model, the upgrade of what pages were
 * saved with before it, and the part stylesheet. The property tests take every shape of every old switch and hold that
 * the value it has at 375, 800, 1100 and 1400 px is the same read the old way and read from the upgraded settings.
 */

const SIZE_OF_WIDTH = (width: number): Size => (width < 768 ? "sm" : width < 1024 ? "md" : width < 1280 ? "lg" : "xl");
const TEST_WIDTHS = Object.values(WIDTHS);
const ALIGNS: (TextAlign | undefined)[] = [undefined, "left", "center", "right"];

/** Every alignment by screen as pages had them (4 × 4 × 4). */
const everyAlignment = (): TextAlignments[] =>
  ALIGNS.flatMap((mobile) => ALIGNS.flatMap((tablet) => ALIGNS.map((desktop) => ({ ...(mobile && { mobile }), ...(tablet && { tablet }), ...(desktop && { desktop }) }))));

/** What an alignment by screen did at a width, the old way (classes smaller to larger, each unset following the smaller); undefined: no class. */
function oldAlignAt(view: TextAlignments, width: number): TextAlign | undefined {
  let value = view.mobile;
  if (width >= 768 && view.tablet) value = view.tablet;
  if (width >= 1024 && view.desktop) value = view.desktop;
  return value;
}

describe("screen sizes (D179)", () => {
  it("keep pages as they were by default: Small below 768, Medium to 1023, Large to 1279, Extra large from 1280", () => {
    expect(DEFAULT_BREAKPOINTS).toEqual({ md: 768, lg: 1024, xl: 1280 });
    const q = breakpointQueries(DEFAULT_BREAKPOINTS);
    expect(q.upTo).toEqual({ lg: "@media (width < 1280px)", md: "@media (width < 1024px)", sm: "@media (width < 768px)" });
    expect(q.only.md).toBe("@media (768px <= width < 1024px)");
    expect(breakpointQueries(DEFAULT_BREAKPOINTS, "container").upTo.sm).toBe("@container kz-page (width < 768px)");
  });

  it("are checked: whole pixels within 480–2560, rising, far enough apart", () => {
    expect(breakpointsProblem(DEFAULT_BREAKPOINTS)).toBeNull();
    expect(breakpointsProblem({ md: 600, lg: 900, xl: 1400 })).toBeNull();
    expect(breakpointsProblem({ md: 400, lg: 900, xl: 1400 })).toMatch(/480 and 2560/);
    expect(breakpointsProblem({ md: 768, lg: 800, xl: 1400 })).toMatch(/after the one before/);
    expect(breakpointsProblem({ md: 900, lg: 768, xl: 1400 })).toMatch(/after the one before/);
    expect(breakpointsProblem({ md: 768.5, lg: 1024, xl: 1280 })).toMatch(/whole pixels/);
    expect(breakpointsOf({ breakpoints: { md: 900, lg: 768, xl: 1400 } })).toEqual(DEFAULT_BREAKPOINTS);
    expect(breakpointsOf(undefined)).toEqual(DEFAULT_BREAKPOINTS);
  });

  it("are part of the theme: every template has the defaults, a stored theme keeps its own, and bad ones fall back alone", () => {
    for (const key of ["minimal", "warm", "bold"] as const) expect(templateSettings(key).breakpoints).toEqual(DEFAULT_BREAKPOINTS);
    expect(parseStoreTheme({ settings: { breakpoints: { md: 700, lg: 1000, xl: 1400 } } }).settings.breakpoints).toEqual({ md: 700, lg: 1000, xl: 1400 });
    const damaged = parseStoreTheme({ base: "warm", settings: { light: { accent: "#123456" }, breakpoints: { md: 2, lg: 3, xl: 4 } } });
    // The rest of the theme is kept.
    expect(damaged.settings.light.accent).toBe("#123456");
    expect(damaged.settings.breakpoints).toEqual(DEFAULT_BREAKPOINTS);
    expect(themeSettingsSchema.safeParse({ ...templateSettings("minimal"), breakpoints: { md: 900, lg: 768, xl: 1400 } }).success).toBe(false);
  });

  it("join neighbouring sizes into one condition", () => {
    expect(sizeRuns(["xl", "md", "sm"])).toEqual([["xl"], ["md", "sm"]]);
    expect(sizesQuery(DEFAULT_BREAKPOINTS, ["xl", "lg", "md"])).toBe("@media (width >= 768px)");
    expect(sizesQuery(DEFAULT_BREAKPOINTS, ["md", "sm"])).toBe("@media (width < 1024px)");
    expect(sizesQuery(DEFAULT_BREAKPOINTS, ["lg"])).toBe("@media (1024px <= width < 1280px)");
    expect(sizesQuery(DEFAULT_BREAKPOINTS, SIZES_ALL)).toBe("always");
    expect(sizesQuery(DEFAULT_BREAKPOINTS, [])).toBeNull();
  });
});
const SIZES_ALL: Size[] = ["xl", "lg", "md", "sm"];

describe("values by size", () => {
  const part = { align: "right" as TextAlign, at: { md: { align: "center" as TextAlign }, sm: { maxWidth: 80 } } };

  it("walk from a size up to the part's own value", () => {
    expect(valueAt(part, "align", "xl")).toBe("right");
    expect(valueAt(part, "align", "lg")).toBe("right");
    expect(valueAt(part, "align", "md")).toBe("center");
    expect(valueAt(part, "align", "sm")).toBe("center");
    expect(valueAt(part, "maxWidth", "sm")).toBe(80);
    expect(valueAt(part, "maxWidth", "md")).toBeUndefined();
  });

  it("walk margin and padding each on their own", () => {
    const spaced = { style: { margin: { top: 1, right: 1, bottom: 1, left: 1 }, padding: { top: 2, right: 2, bottom: 2, left: 2 } }, at: { sm: { style: { padding: { top: 0, right: 0, bottom: 0, left: 0 } } } } };
    expect(spacingAt(spaced, "sm")).toEqual({ margin: spaced.style.margin, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(spacingAt(spaced, "md")).toEqual(spaced.style);
  });

  it("are set and taken away one size and key at a time, leaving nothing empty", () => {
    const at = withAt(undefined, "md", "align", "center");
    expect(at).toEqual({ md: { align: "center" } });
    expect(withAt(at, "md", "align", undefined)).toBeUndefined();
    expect(withAt({ md: { align: "center", columns: 2 } }, "md", "align", undefined)).toEqual({ md: { columns: 2 } });
  });

  it("are kept by the schema, which refuses what a size cannot take and drops sizes that say nothing", () => {
    const parsed = pageBlockSchema.parse({ id: "h", type: "heading", text: "x", level: 2, align: "left", at: { md: { align: "center" }, sm: {} }, visibility: { hideAt: ["sm", "xl", "sm"] } });
    // A heading's alignment is its text's typography since phase 3, by size as before.
    expect(parsed).toMatchObject({ at: { md: { typography: { text: { align: "center" } } } }, visibility: { hideAt: ["xl", "sm"] } });
    expect(parsed.at).not.toHaveProperty("sm");
    expect(pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, at: { md: { align: "justify" } } }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, at: { xs: { align: "left" } } }).data).not.toHaveProperty("at.xs");
    expect(pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, visibility: { hideAt: ["tiny"] } }).success).toBe(false);
  });
});

describe("the upgrade of saved shapes, against what they did (property)", () => {
  it("gives every alignment by screen the same value at every width, and the editor's three screens back unchanged", () => {
    for (const view of everyAlignment()) {
      // Text's alignment is its typography since phase 3 (`foldTypography()`); a button's is its Position, `align` by size.
      const text = pageBlockSchema.parse({ id: "t", type: "richText", doc: { type: "doc", content: [] }, align: view });
      const block = pageBlockSchema.parse({ id: "b", type: "button", label: "Go", href: "/", align: view });
      for (const width of TEST_WIDTHS) {
        const old = oldAlignAt(view, width);
        const now = valueAt(block, "align", SIZE_OF_WIDTH(width));
        expect([view, width, typographyValueAt(text, "text", "align", SIZE_OF_WIDTH(width)) ?? "none"]).toEqual([view, width, now ?? "none"]);
        // A screen with no class inherits, which on a left-to-right page is left: the upgrade writes that left where a larger size is set.
        expect([view, width, now ?? "none"]).toEqual([view, width, old ?? (Object.keys(view).length > 0 ? "left" : "none")]);
      }
      // The editor's own way of storing it ("left" on phones is no setting) reads back as it was.
      const editorView = { ...view };
      if (editorView.mobile === "left") delete editorView.mobile;
      expect(alignView(block)).toEqual(normalized(editorView));
      // Saving it through the editor again gives the same alignment at every size (left and none are the same there).
      const again = alignPatch({}, alignView(block));
      for (const size of SIZES_ALL) expect(valueAt(again, "align", size) ?? "left").toBe(valueAt(block, "align", size) ?? "left");
    }
  });

  it("places a picture by the same margins at every width", () => {
    // The old classes per screen (`PICTURE_SIDE`), each screen's own replacing the smaller's: the margins they gave.
    const OLD = {
      mobile: { left: {}, center: { l: "auto", r: "auto" }, right: { l: "auto" } },
      tablet: { left: { l: "0", r: "0" }, center: { l: "auto", r: "auto" }, right: { l: "auto", r: "0" } },
      desktop: { left: { l: "0", r: "0" }, center: { l: "auto", r: "auto" }, right: { l: "auto", r: "0" } },
    } as const;
    const picture = { url: "https://cdn.example.com/a.webp", width: 800, height: 600, alt: "" };
    for (const view of everyAlignment()) {
      const block = pageBlockSchema.parse({ id: "i", type: "image", image: picture, caption: "", align: view }) as ImageBlock;
      const css = partCss([{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [block] }] }], "site", DEFAULT_BREAKPOINTS);
      const classes = blockStyle(block, "site").className.split(" ");
      for (const width of TEST_WIDTHS) {
        const margins: { l?: string; r?: string } = {};
        for (const screen of ["mobile", "tablet", "desktop"] as const) {
          const from = { mobile: 0, tablet: 768, desktop: 1024 }[screen];
          const side = view[screen];
          if (width >= from && side) Object.assign(margins, OLD[screen][side]);
        }
        const style = partStyleAt(css, classes, width);
        // An explicit 0 and no margin at all are the same margin.
        const zero = (v: string | undefined) => (v === undefined || v === "0" ? "0" : v);
        expect([view, width, zero(style["margin-left"]), zero(style["margin-right"])]).toEqual([view, width, zero(margins.l), zero(margins.r)]);
      }
    }
  });

  it("gives every grid's columns by screen the same count at every width, and back to the editor unchanged", () => {
    for (let mobile = 1; mobile <= 2; mobile++)
      for (let tablet = 1; tablet <= 4; tablet++)
        for (let desktop = 1; desktop <= 8; desktop++) {
          const old = { mobile, tablet, desktop };
          const block = upgradeBlock({ id: "g", type: "contentGrid", columns: old }) as ContentGridBlock;
          for (const width of TEST_WIDTHS) {
            const want = width < 768 ? mobile : width < 1024 ? tablet : desktop;
            expect([old, width, valueAt(block, "columns", SIZE_OF_WIDTH(width)) ?? block.columns]).toEqual([old, width, want]);
            // And as the list's custom property the grid reads.
            const style = partStyleAt(partCss([], "site", DEFAULT_BREAKPOINTS, "media", [block as PageBlock]), gridListStyle(block).className.split(" "), width);
            expect(style["--grid-cols"]).toBe(String(want));
          }
          expect(columnsView(block, { mobile: 0, tablet: 0, desktop: 0 })).toEqual(old);
          expect(columnsPatch({}, old)).toEqual({ columns: block.columns, at: block.at });
        }
  });

  it("lays out every row's columns as they were, at every width, whatever its layout and switches", () => {
    for (const layout of Object.keys(ROW_LAYOUTS) as RowLayout[])
      for (const sideBySide of [undefined, false, true])
        for (const reverseOnMobile of [undefined, false, true])
          for (const equalHeight of [undefined, true])
            for (const align of [undefined, "top", "middle", "bottom"] as const) {
              const raw = {
                id: "r",
                type: "row",
                layout,
                columns: ROW_LAYOUTS[layout].widths.map((_, i) => ({ id: `c${i}`, blocks: [] })),
                ...(sideBySide !== undefined && { sideBySide }),
                ...(reverseOnMobile !== undefined && { reverseOnMobile }),
                ...(equalHeight && { equalHeight }),
                ...(align && { align }),
              };
              const row = pageRowSchema.parse(raw) as PageRow;
              const css = partCss([row], "site", DEFAULT_BREAKPOINTS);
              const grid = rowGridStyle(row).className.split(" ");
              const tracks = ROW_LAYOUTS[layout].widths.map((w: number) => (w === 0 ? "minmax(0, max-content)" : `minmax(0, ${w}fr)`)).join(" ");
              const at = align ?? "top";
              for (const width of TEST_WIDTHS) {
                const style = partStyleAt(css, grid, width);
                const phone = width < 768;
                // The old classes: kept side by side, `grid gap-2 md:gap-8` and the items; else `flex flex-col(-reverse) gap-8`, a grid from 768.
                const old = sideBySide
                  ? { display: "grid", gap: phone ? "8px" : "2rem", "grid-template-columns": tracks, "align-items": equalHeight ? "stretch" : { top: "flex-start", middle: "center", bottom: "flex-end" }[at] }
                  : phone
                    ? { display: "flex", gap: "2rem", "flex-direction": reverseOnMobile ? "column-reverse" : "column", "justify-content": { top: "start", middle: "center", bottom: "end" }[at] }
                    : { display: "grid", gap: "2rem", "grid-template-columns": tracks, "align-items": equalHeight ? "stretch" : { top: "flex-start", middle: "center", bottom: "flex-end" }[at] };
                expect([raw, width, style]).toEqual([raw, width, old]);
                expect(stackAt(row, SIZE_OF_WIDTH(width))).toBe(!sideBySide && phone);
              }
              expect(rowSideBySide(row)).toBe(Boolean(sideBySide));
              expect(rowReversedOnPhones(row)).toBe(Boolean(reverseOnMobile) && !sideBySide);
            }
  });

  it("hides on phones, stacks a dual button on phones and makes a carousel of phones only, as they did", () => {
    const menu = upgradeBlock({ id: "m", type: "menu", hideOnPhones: true }) as PageBlock;
    const dual = upgradeBlock({ id: "d", type: "dualButton", stackOnPhones: true }) as PageBlock;
    const grid = upgradeBlock({ id: "g", type: "contentGrid", display: "carousel", carouselOn: "phones", columns: 3 }) as ContentGridBlock;
    const everywhere = upgradeBlock({ id: "g2", type: "contentGrid", display: "carousel", columns: 3 }) as ContentGridBlock;
    const notCarousel = upgradeBlock({ id: "g3", type: "contentGrid", carouselOn: "phones", columns: 3 }) as ContentGridBlock;
    for (const width of TEST_WIDTHS) {
      const size = SIZE_OF_WIDTH(width);
      const phone = width < 768;
      expect(hiddenAt(menu, size)).toBe(phone);
      expect(valueAt(dual, "stack", size) === true).toBe(phone);
      expect(carouselAt(grid, size)).toBe(phone);
      expect(carouselAt(everywhere, size)).toBe(true);
      expect(carouselAt(notCarousel, size)).toBe(false);
    }
    for (const block of [menu, dual, grid, everywhere, notCarousel]) {
      for (const old of ["hideOnPhones", "stackOnPhones", "carouselOn"]) expect(block).not.toHaveProperty(old);
    }
    // Switches set off are dropped without a trace.
    expect(upgradeBlock({ id: "m", type: "menu", hideOnPhones: false })).toEqual({ id: "m", type: "menu" });
    expect(upgradeRow({ id: "r", type: "row", sideBySide: false, reverseOnMobile: false })).toEqual({ id: "r", type: "row" });
  });

  it("leaves a part in the new shape as it is, and the same object", () => {
    const block = { id: "h", type: "heading", text: "x", level: 2, align: "center", at: { sm: { align: "left" } } };
    expect(upgradeBlock(block)).toBe(block);
    const row = { id: "r", type: "row", layout: "1", columns: [], stack: false };
    expect(upgradeRow(row)).toBe(row);
  });

  it("leaves a value the old shape could not hold for the schema to refuse, as it did", () => {
    expect(pageBlockSchema.safeParse({ id: "t", type: "richText", doc: { type: "doc", content: [] }, align: { tablet: "justify" } }).success).toBe(false);
    const grid = { id: "g", type: "contentGrid", source: { type: "pages" }, categories: [], tags: [], sort: "newest", limit: 3, show: { image: true, heading: true, excerpt: true, price: true, button: true }, headingLevel: 3, excerptLines: 3, gap: 8 };
    expect(pageBlockSchema.safeParse({ ...grid, columns: { mobile: 3, tablet: 2, desktop: 3 } }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...grid, columns: { mobile: 1, tablet: 2, desktop: 3 } }).success).toBe(true);
  });

  it("reads a whole page saved the old way, which is saved the new way (and reads the same again)", () => {
    const rows = [
      {
        id: "r",
        type: "row",
        layout: "2",
        reverseOnMobile: true,
        columns: [
          { id: "c1", blocks: [{ id: "t", type: "richText", doc: { type: "doc", content: [{ type: "paragraph" }] }, align: { tablet: "center" } }] },
          { id: "c2", blocks: [{ id: "m", type: "menu", hideOnPhones: true }] },
        ],
      },
    ];
    const page = pageInput.parse({ ...newPageContent(), title: "T", slug: "t", rows });
    const stored = JSON.parse(JSON.stringify(page));
    expect(JSON.stringify(stored)).not.toMatch(/reverseOnMobile|hideOnPhones|"mobile"|"tablet"|"desktop"/);
    expect(pageInput.parse(stored)).toEqual(page);
    expect(upgradeResponsive(rows)).toEqual(JSON.parse(JSON.stringify(page.rows)));
  });
});

describe("the editor's switches, written in the new shape", () => {
  it("keep a row side by side on phones, and reverse one, as the old switches did", () => {
    const row = { stack: undefined, at: undefined, gap: undefined };
    const on = sideBySidePatch(row, true);
    expect(on).toEqual({ stack: false, at: { sm: { gap: 8 } } });
    expect(sideBySidePatch({ ...row, ...on }, false)).toEqual({ stack: undefined, at: undefined });
    expect(reversePatch({}, true)).toEqual({ at: { sm: { reverse: true } } });
    expect(reversePatch({ at: { sm: { reverse: true } } }, false)).toEqual({ at: undefined });
  });

  it("hide a part on phones, keeping any other size it is hidden at", () => {
    expect(hideOnPhonesPatch({}, true)).toEqual({ visibility: { hideAt: ["sm"] } });
    expect(hideOnPhonesPatch({ visibility: { hideAt: ["xl"] } }, true)).toEqual({ visibility: { hideAt: ["xl", "sm"] } });
    expect(hideOnPhonesPatch({ visibility: { hideAt: ["sm"] } }, false)).toEqual({ visibility: undefined });
  });
});

describe("the part stylesheet", () => {
  const rule = (sizes: Partial<Record<Size, Record<string, string>>>, important = false): PartRule => ({
    selector: ".x",
    important,
    where: true,
    sizes: { xl: sizes.xl ?? {}, lg: sizes.lg ?? sizes.xl ?? {}, md: sizes.md ?? sizes.lg ?? sizes.xl ?? {}, sm: sizes.sm ?? sizes.md ?? sizes.lg ?? sizes.xl ?? {} },
  });

  it("writes the base and, for each smaller size, only what changes, giving back what a smaller size does not set", () => {
    const css = renderPartCss([rule({ xl: { "padding-top": "20px" }, md: { "padding-top": "10px", "margin-left": "4px" }, sm: {} }, true)], DEFAULT_BREAKPOINTS);
    expect(css).toBe(
      ":where(.x){padding-top:20px!important}\n@media (width < 1024px){\n:where(.x){padding-top:10px!important;margin-left:4px!important}\n}\n@media (width < 768px){\n:where(.x){padding-top:revert-layer!important;margin-left:revert-layer!important}\n}",
    );
  });

  it("writes a rule that holds at some sizes only once per run of neighbouring sizes, and each rule once", () => {
    const only: PartRule = { selector: ".x", important: false, where: true, only: ["xl", "md", "sm"], decl: { display: "none" } };
    const css = renderPartCss([only, only], DEFAULT_BREAKPOINTS, "container");
    expect(css).toBe("\n@container kz-page (width >= 1280px){\n:where(.x){display:none}\n}\n@container kz-page (width < 1024px){\n:where(.x){display:none}\n}".slice(1));
  });

  it("names a part's rules by what they say: the same settings share a class, the same id with other settings never does", () => {
    const a: PageRow = { id: "r1", type: "row", layout: "1", columns: [], radius: 4 };
    const b: PageRow = { ...a, radius: 8 };
    expect(rowStyle(a).className).toMatch(/^kzr-[0-9a-z]+$/);
    expect(rowStyle({ ...a, id: "other" }).className).toBe(rowStyle(a).className);
    expect(rowStyle(b).className).not.toBe(rowStyle(a).className);
    // A part that says nothing gets no class.
    expect(blockStyle({ id: "t", type: "richText", doc: { type: "doc", content: [] } }, "site").className).toBe("");
  });

  it("measures the canvas by its container and the site by the window, with the store's own sizes", () => {
    const row = pageRowSchema.parse({ id: "r", type: "row", layout: "2", columns: [{ id: "a", blocks: [] }, { id: "b", blocks: [] }] }) as PageRow;
    expect(partCss([row], "canvas", DEFAULT_BREAKPOINTS)).toContain("@container kz-page (width < 768px)");
    expect(partCss([row], "site", { md: 600, lg: 900, xl: 1400 })).toContain("@media (width < 600px)");
  });

  it("lays testimonials out in one column on Small, at most two on Medium and all from Large, on the store's sizes", () => {
    const block = pageBlockSchema.parse({ id: "t", type: "testimonials", items: [], columns: 4 }) as PageBlock;
    const style = blockStyle(block, "site");
    const css = partCss([], "site", DEFAULT_BREAKPOINTS, "media", [block]);
    const at = (width: number) => partStyleAt(css, [], width, (s) => s === `:where(.${style.className} [data-testimonial-list])`)["--grid-cols"];
    expect(TEST_WIDTHS.map(at)).toEqual(["1", "2", "4", "4"]);
    expect(partCss([], "canvas", { md: 600, lg: 900, xl: 1400 }, "container", [block])).toContain("@container kz-page (width < 900px)");
  });

  it("draws hidden parts and the phone's menu button only on the site, never on the canvas", () => {
    const hidden = upgradeBlock({ id: "m", type: "menu", hideOnPhones: true }) as PageBlock;
    expect(blockStyle(hidden, "canvas").className).toBe("");
    expect(partCss([], "site", DEFAULT_BREAKPOINTS, "media", [hidden])).toContain("@media (width < 768px){\n:where(.kzr-");
    const button: PageBlock = { id: "b", type: "site", part: "menuButton" };
    expect(partCss([], "site", DEFAULT_BREAKPOINTS, "media", [button])).toMatch(/@media \(width >= 768px\)\{\n:where\(\.kzr-[0-9a-z]+\)\{display:none\}/);
  });
});

/** An alignment view with nothing left of it as undefined, as the editor keeps it. */
function normalized(view: TextAlignments): TextAlignments | undefined {
  // Each screen that says what the smaller one already says says nothing.
  const out: TextAlignments = {};
  const m = view.mobile;
  const t = view.tablet ?? m;
  const d = view.desktop ?? t;
  if (m && m !== "left") out.mobile = m;
  if (t && t !== (m ?? "left")) out.tablet = t;
  if (d && d !== (t ?? m ?? "left")) out.desktop = d;
  return Object.keys(out).length > 0 ? out : undefined;
}
