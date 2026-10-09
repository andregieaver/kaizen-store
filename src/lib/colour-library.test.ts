import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PartBackground } from "@/components/page-parts";

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import {
  SAVED_COLOURS_MAX,
  colourLibrarySchema,
  libraryName,
  linearGradient,
  savedFromBackground,
  withSavedColour,
  withSavedGradient,
  withoutSaved,
  EMPTY_LIBRARY,
} from "./colour-library";
import { pageInput, type PageBlock, type PageRow } from "./page-content";
import { partCss } from "./part-css";
import { WIDTHS, partStyleAt } from "./part-css.testing";
import { THEME_TEMPLATES, themeSettingsSchema } from "./theme";
import { typographyDecl, typographyPatch } from "./typography";

/** Saved colours and gradients, text gradients, and a gradient background's opacity and overlay (D183). */

describe("the saved colours and gradients", () => {
  it("are kept on the theme and a theme without them reads as before", () => {
    const base = structuredClone(THEME_TEMPLATES.minimal.settings);
    expect(themeSettingsSchema.safeParse(base).success).toBe(true);
    const library = { colours: [{ id: "a", name: "Brand", color: "#AABBCC" }], gradients: [] };
    const parsed = themeSettingsSchema.safeParse({ ...base, library });
    expect(parsed.success && parsed.data.library?.colours[0].color).toBe("#aabbcc");
  });

  it("refuse what cannot be kept", () => {
    const bad = (library: unknown) => colourLibrarySchema.safeParse(library).success;
    expect(bad({ colours: [{ id: "a", name: "", color: "#000000" }], gradients: [] })).toBe(false);
    expect(bad({ colours: [{ id: "a", name: "x", color: "red" }], gradients: [] })).toBe(false);
    expect(bad({ colours: [], gradients: [{ id: "g", name: "x", style: "shift", colors: ["#000000"] }] })).toBe(false);
    expect(bad({ colours: [], gradients: [{ id: "g", name: "x", style: "nope", colors: ["#000000", "#ffffff"] }] })).toBe(false);
    expect(bad({ colours: [], gradients: [{ id: "g", name: "x", style: "shift", colors: ["#000000", "#ffffff"], angle: 90 }] })).toBe(true);
  });

  it("add, name and remove as copies, never past the limits", () => {
    let lib = EMPTY_LIBRARY;
    lib = withSavedColour(lib, { id: "1", name: "Brand", color: "#112233" }).library;
    // The same colour under the same name is not added twice.
    expect(withSavedColour(lib, { id: "2", name: "Brand", color: "#112233" }).library.colours).toHaveLength(1);
    lib = withSavedGradient(lib, savedFromBackground({ style: "shift", colors: ["#000000", "#ffffff"], angle: 45, grain: true }, "g1", "Dusk")).library;
    expect(lib.gradients[0]).toMatchObject({ name: "Dusk", angle: 45, grain: true });
    expect(withoutSaved(lib, "colour", "1").colours).toHaveLength(0);
    expect(withoutSaved(lib, "gradient", "g1").gradients).toHaveLength(0);
    const full = { colours: Array.from({ length: SAVED_COLOURS_MAX }, (_, i) => ({ id: `c${i}`, name: `n${i}`, color: "#000000" })), gradients: [] };
    expect(withSavedColour(full, { id: "x", name: "more", color: "#ffffff" }).full).toBe(true);
    expect(libraryName("   ", "Colour 3")).toBe("Colour 3");
    expect(libraryName("x".repeat(80), "y")).toHaveLength(40);
    expect(linearGradient(["#000000", "#ffffff"], 45)).toBe("linear-gradient(45deg, #000000, #ffffff)");
  });
});

describe("a text gradient", () => {
  const heading = (typography: object, at?: object): PageBlock => ({ id: "h", type: "heading", text: "Hi", level: 1, typography, ...(at ? { at } : {}) }) as PageBlock;
  const rowOf = (block: PageBlock): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [block] }] });

  it("fills the letters across the words, clipped to the text", () => {
    const decl = typographyDecl({ gradient: { colors: ["#ff0000", "#0000ff"], angle: 90 } });
    expect(decl["background-image"]).toBe("linear-gradient(90deg, #ff0000, #0000ff)");
    expect(decl["background-clip"]).toBe("text");
    expect(decl["-webkit-text-fill-color"]).toBe("transparent");
    // Taken away at a size: the colour comes back.
    expect(typographyDecl({ gradient: null })["-webkit-text-fill-color"]).toBe("currentcolor");
  });

  it("is a rule of the part, fitting the text and placed where the text is aligned", () => {
    const block = heading({ text: { gradient: { colors: ["#ff0000", "#0000ff"], angle: 45 }, align: "center" } });
    const css = partCss([rowOf(block)], "site", DEFAULT_BREAKPOINTS);
    const rule = partStyleAt(css, [], WIDTHS.xl, (s) => s.includes(":is(h1, h2, h3, h4, h5, h6)"));
    expect(rule["background-image"]).toBe("linear-gradient(45deg, #ff0000, #0000ff)");
    expect(rule.width).toBe("fit-content");
    expect(rule["margin-inline"]).toBe("auto");
  });

  it("is checked when a page is saved, and taken away at a smaller size as none", () => {
    const base = { title: "T", slug: "t", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [] };
    const page = (gradient: unknown) =>
      pageInput.safeParse({ ...base, rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "h", type: "heading", text: "x", level: 2, typography: { text: { gradient } } }] }] }] });
    expect(page({ colors: ["#000000", "#ffffff"], angle: 90 }).success).toBe(true);
    expect(page({ colors: ["#000000"], angle: 90 }).success).toBe(false);
    expect(page({ colors: ["#000000", "red"], angle: 90 }).success).toBe(false);
    const part = { typography: { text: { gradient: { colors: ["#000000", "#ffffff"], angle: 90 } } } };
    const patch = typographyPatch(part, "sm", "text", "gradient", undefined);
    expect(patch.at?.sm?.typography?.text?.gradient).toBeNull();
  });
});

describe("a gradient background's opacity and overlay", () => {
  const gradient = { type: "gradient", style: "shift", colors: ["#6366f1", "#ec4899"] } as const;
  const html = (background: object) => renderToString(createElement(PartBackground, { background: background as never }));

  it("draws the gradient as it was, with no overlay and no opacity unless set", () => {
    const out = html(gradient);
    expect(out).not.toContain("opacity");
    expect(out.match(/-z-10/g)).toHaveLength(1);
  });

  it("is see-through by its opacity, and a colour over it above the gradient", () => {
    const out = html({ ...gradient, opacity: 40, overlay: { color: "#000000", opacity: 30 } });
    expect(out).toContain("opacity:0.4");
    expect(out).toContain("background-color:#000000;opacity:0.3");
    expect(out.indexOf("data-fx-gradient")).toBeLessThan(out.indexOf("background-color:#000000"));
  });

  it("is checked when a page is saved", () => {
    const base = { title: "T", slug: "t", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [] };
    const page = (extra: object) =>
      pageInput.safeParse({ ...base, rows: [{ id: "r", type: "row", layout: "1", background: { ...gradient, ...extra }, columns: [{ id: "c", blocks: [] }] }] });
    expect(page({ opacity: 50, overlay: { color: "#112233", opacity: 20 } }).success).toBe(true);
    expect(page({ overlay: null }).success).toBe(true);
    expect(page({ opacity: 150 }).success).toBe(false);
    expect(page({ overlay: { color: "blue", opacity: 20 } }).success).toBe(false);
  });
});
