import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import { partFonts, pageInput, type PageBlock, type PageRow } from "./page-content";
import { blockStyle, columnStyle, partCss, rowStyle, rowWidthStyle } from "./part-css";
import { WIDTHS, partStyleAt } from "./part-css.testing";
import { THEME_TEMPLATES, parseStoreTheme, themeCss, themeSettingsSchema, themeTabValue, withThemeTab, type ThemeSettings } from "./theme";
import {
  THEME_ELEMENT_KEYS,
  elementAsPart,
  elementFromPart,
  layerUnder,
  themeElementsSchema,
  themeFontFamilies,
  themedRows,
  type ThemeElements,
  type ThemedBlock,
} from "./theme-elements";
import { typographyAt } from "./typography";

/**
 * The theme's elements (D182): what a store says once for its rows, headings, paragraphs, lists and buttons is laid under the
 * parts of its pages, and a part's own setting wins at the sizes it sets it at; a rich text's paragraphs, headings and lists
 * take the theme's rules, without what the block, its column or its row set themselves.
 */

const heading = (extra: Record<string, unknown> = {}): PageBlock => ({ id: "h", type: "heading", text: "Hello", level: 1, ...extra }) as PageBlock;
const richText = (extra: Record<string, unknown> = {}): PageBlock => ({ id: "t", type: "richText", doc: { type: "doc", content: [] }, ...extra }) as PageBlock;
const rowOf = (blocks: PageBlock[], extra: Partial<PageRow> = {}, column: Record<string, unknown> = {}): PageRow => ({
  id: "r",
  type: "row",
  layout: "1",
  columns: [{ id: "c", blocks, ...column }],
  ...extra,
});
const sheet = (rows: PageRow[]) => partCss(rows, "site", DEFAULT_BREAKPOINTS);
const classesOf = (block: PageBlock) => blockStyle(block, "site").className.split(" ");

describe("laying the theme under a part", () => {
  const element = {
    typography: { text: { size: { value: 3, unit: "rem" }, weight: 800, color: "#112233" } },
    at: { sm: { typography: { text: { size: { value: 2, unit: "rem" } } } } },
    style: { margin: { top: 4, right: 0, bottom: 8, left: 0 } },
    radius: 6,
  } as const;

  it("gives a part the theme's settings where it sets none, at every size", () => {
    const part = layerUnder({ id: "h" } as PageBlock, element as never);
    expect(typographyAt(part as never, "text", "xl").size).toEqual({ value: 3, unit: "rem" });
    expect(typographyAt(part as never, "text", "md").size).toEqual({ value: 3, unit: "rem" });
    expect(typographyAt(part as never, "text", "sm").size).toEqual({ value: 2, unit: "rem" });
    expect(typographyAt(part as never, "text", "sm").color).toBe("#112233");
    expect((part as { radius?: number }).radius).toBe(6);
  });

  it("lets the part's own setting win at the size it sets it and the sizes below, until one of them sets its own", () => {
    const own = { id: "h", typography: { text: { size: { value: 1.25, unit: "rem" } } }, at: { md: { typography: { text: { size: { value: 1.5, unit: "rem" } } } } } };
    const part = layerUnder(own as never, element as never);
    expect(typographyAt(part as never, "text", "xl").size).toEqual({ value: 1.25, unit: "rem" });
    expect(typographyAt(part as never, "text", "lg").size).toEqual({ value: 1.25, unit: "rem" });
    expect(typographyAt(part as never, "text", "md").size).toEqual({ value: 1.5, unit: "rem" });
    // On Small the part's own chain (its Medium) still wins over the theme's Small.
    expect(typographyAt(part as never, "text", "sm").size).toEqual({ value: 1.5, unit: "rem" });
    // What the part does not set comes from the theme.
    expect(typographyAt(part as never, "text", "xl").color).toBe("#112233");
    expect(typographyAt(part as never, "text", "xl").weight).toBe(800);
  });

  it("leaves the part's other settings and other kinds of text as they are", () => {
    const own = { id: "b", gap: 10, typography: { title: { weight: 700 } }, at: { sm: { stack: true, typography: { title: { weight: 500 } } } } };
    const part = layerUnder(own as never, element as never) as typeof own & { at: { sm: { stack: boolean } } };
    expect(part.gap).toBe(10);
    expect(part.at.sm.stack).toBe(true);
    expect(typographyAt(part as never, "title", "xl").weight).toBe(700);
    expect(typographyAt(part as never, "title", "sm").weight).toBe(500);
  });

  it("keeps a part's own border cleared at a size ('none here') over the theme's", () => {
    const themed = { border: { width: { top: 1, right: 1, bottom: 1, left: 1 }, color: "#000000", style: "solid" } };
    const own = { id: "x", at: { sm: { border: null } } };
    const part = layerUnder(own as never, themed as never) as { border?: unknown; at?: { sm?: { border?: unknown } } };
    expect(part.border).toEqual(themed.border);
    expect(part.at?.sm?.border).toBeNull();
  });

  it("returns the part itself where the theme has nothing", () => {
    const part = { id: "x" };
    expect(layerUnder(part, undefined)).toBe(part);
  });
});

describe("the theme under a page's rows", () => {
  const elements: ThemeElements = {
    h1: { typography: { text: { size: { value: 4, unit: "rem" }, color: "#aa0000" } } },
    h2: { typography: { text: { size: { value: 2, unit: "rem" } } } },
    row: { style: { padding: { top: 40, right: 20, bottom: 40, left: 20 } }, background: { type: "color", color: "#eeeeee" } },
    button: { radius: 12, typography: { text: { weight: 700 } } },
  };

  it("draws a heading at its level's size, over the level's default", () => {
    const row = themedRows([rowOf([heading({ level: 1 })])], elements)[0];
    const block = row.columns[0].blocks[0];
    const style = partStyleAt(sheet([row]), classesOf(block), WIDTHS.xl, (s) => s === `:where(& :is(h1, h2, h3, h4, h5, h6))`.replace("&", `.${classesOf(block)[0]}`));
    expect(style["font-size"]).toBe("4rem");
    expect(style.color).toBe("#aa0000");
    // The level without an element keeps the size its level has always had.
    const h3 = themedRows([rowOf([heading({ level: 3 })])], elements)[0].columns[0].blocks[0];
    const own = partStyleAt(sheet([rowOf([h3])]), classesOf(h3), WIDTHS.xl, (s) => s === `:where(.${classesOf(h3)[0]} :is(h1, h2, h3, h4, h5, h6))`);
    expect(own["font-size"]).toBe("1.5rem");
  });

  it("lets a heading's own size win, and a row's own colour beat the theme's heading colour", () => {
    const own = themedRows([rowOf([heading({ level: 1, typography: { text: { size: { value: 1, unit: "rem" } } } })])], elements)[0];
    expect(typographyAt(own.columns[0].blocks[0] as never, "text", "xl").size).toEqual({ value: 1, unit: "rem" });
    const rowColour = themedRows([rowOf([heading({ level: 1 })], { typography: { text: { color: "#ffffff" } } })], elements)[0];
    const text = typographyAt(rowColour.columns[0].blocks[0] as never, "text", "xl");
    expect(text.color).toBeUndefined();
    // Not the size: the row did not set one.
    expect(text.size).toEqual({ value: 4, unit: "rem" });
  });

  it("gives rows the theme's spacing and colour, but a row's own padding and colour win", () => {
    const themed = themedRows([rowOf([])], elements)[0];
    const style = partStyleAt(sheet([themed]), rowStyle(themed).className.split(" "), WIDTHS.xl);
    expect(style["padding-top"]).toBe("40px");
    expect(style["background-color"]).toBe("#eeeeee");
    const own = themedRows([rowOf([], { style: { padding: { top: 5, right: 5, bottom: 5, left: 5 } }, background: { type: "color", color: "#00ff00" } })], elements)[0];
    const ownStyle = partStyleAt(sheet([own]), rowStyle(own).className.split(" "), WIDTHS.xl);
    expect(ownStyle["padding-top"]).toBe("5px");
    expect(ownStyle["background-color"]).toBe("#00ff00");
  });

  it("keeps a row's picture over the theme's colour", () => {
    const image = { type: "image", image: { url: "https://x.test/a.jpg", width: 10, height: 10, alt: "" } } as never;
    const row = themedRows([rowOf([], { background: image })], elements)[0];
    expect(row.background).toBe(image);
  });

  it("styles a button's frame and text, and only the text of a dual button", () => {
    const button = { id: "b", type: "button", label: "Go", href: "/x" } as PageBlock;
    const dual = { id: "d", type: "dualButton" } as unknown as PageBlock;
    const [row] = themedRows([rowOf([button, dual])], elements);
    const [themedButton, themedDual] = row.columns[0].blocks;
    expect((themedButton as { radius?: number }).radius).toBe(12);
    expect(typographyAt(themedButton as never, "text", "xl").weight).toBe(700);
    expect((themedDual as { radius?: number }).radius).toBeUndefined();
    expect(typographyAt(themedDual as never, "text", "xl").weight).toBe(700);
  });

  it("changes nothing where the theme says nothing, and never changes the rows given", () => {
    const rows = [rowOf([heading()])];
    expect(themedRows(rows, undefined)).toBe(rows);
    expect(themedRows(rows, {})).toBe(rows);
    const before = JSON.stringify(rows);
    themedRows(rows, elements);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("a rich text's own paragraphs, headings and lists", () => {
  const elements: ThemeElements = {
    p: { typography: { text: { size: { value: 1.125, unit: "rem" }, color: "#333333" } }, style: { margin: { top: 0, right: 0, bottom: 12, left: 0 } } },
    h2: { typography: { text: { weight: 800 } } },
    list: { style: { padding: { top: 0, right: 0, bottom: 0, left: 32 } } },
  };

  it("takes the theme's rules for what it holds, written with the rich text's own class", () => {
    const [row] = themedRows([rowOf([richText()])], elements);
    const block = row.columns[0].blocks[0] as ThemedBlock;
    expect(Object.keys(block.themeInner ?? {}).sort()).toEqual(["h2", "list", "p"]);
    const classes = classesOf(block);
    const css = sheet([row]);
    const at = (selector: string) => partStyleAt(css, classes, WIDTHS.xl, (s) => s === selector.replaceAll("&", `.${classes[0]}`));
    expect(at("& .rich-text p")["font-size"]).toBe("1.125rem");
    expect(at("& .rich-text p").color).toBe("#333333");
    // Spacing is written whole, zero included, over the site's own.
    expect(at("& .rich-text p")["margin-top"]).toBe("0px");
    expect(at("& .rich-text p")["margin-bottom"]).toBe("12px");
    expect(at("& .rich-text h2")["font-weight"]).toBe("800");
    expect(at("& .rich-text :is(ul, ol)")["padding-left"]).toBe("32px");
  });

  it("leaves out what the block, its column and its row set themselves", () => {
    const [row] = themedRows(
      [rowOf([richText({ typography: { text: { size: { value: 2, unit: "rem" } } } })], { typography: { text: { color: "#ffffff" } } })],
      elements,
    );
    const text = typographyAt((row.columns[0].blocks[0] as ThemedBlock).themeInner!.p as never, "text", "xl");
    expect(text.size).toBeUndefined();
    expect(text.color).toBeUndefined();
    const [withColumn] = themedRows([rowOf([richText()], {}, { typography: { text: { weight: 300 } } })], { p: { typography: { text: { weight: 700, color: "#111111" } } } });
    const inner = (withColumn.columns[0].blocks[0] as ThemedBlock).themeInner!.p!;
    expect(typographyAt(inner as never, "text", "xl").weight).toBeUndefined();
    expect(typographyAt(inner as never, "text", "xl").color).toBe("#111111");
  });

  it("names the families it uses, so they are loaded", () => {
    const [row] = themedRows([rowOf([richText()])], { p: { typography: { text: { family: "Lora" } } } });
    expect(partFonts(row.columns[0].blocks[0])).toEqual(["Lora"]);
  });
});

describe("a row's content width", () => {
  it("is a custom property on the row's width element, per screen size, nothing where the row sets none", () => {
    const row = rowOf([], { contentMax: 900, at: { md: { contentMax: 700 }, sm: { contentMax: null } } });
    const style = rowWidthStyle(row);
    expect(style.className).toMatch(/^kzr-.*-w$/);
    const css = sheet([row]);
    const classes = style.className.split(" ");
    expect(partStyleAt(css, classes, WIDTHS.xl)["--content-width"]).toBe("900px");
    expect(partStyleAt(css, classes, WIDTHS.lg)["--content-width"]).toBe("900px");
    expect(partStyleAt(css, classes, WIDTHS.md)["--content-width"]).toBe("700px");
    // None on Small: the theme's width applies again.
    expect(partStyleAt(css, classes, WIDTHS.sm)["--content-width"]).toBeUndefined();
    expect(rowWidthStyle(rowOf([])).className).toBe("");
  });

  it("is checked when a page is saved", () => {
    const base = { title: "T", slug: "t", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [] };
    const page = (contentMax: unknown) => pageInput.safeParse({ ...base, rows: [{ id: "r", type: "row", layout: "1", contentMax, columns: [{ id: "c", blocks: [] }] }] });
    expect(page(960).success).toBe(true);
    expect(page(100).success).toBe(false);
    expect(page(5000).success).toBe(false);
    expect(page(960.5).success).toBe(false);
  });

  it("is the theme's custom property when the theme sets one", () => {
    const settings = structuredClone(THEME_TEMPLATES.minimal.settings) as ThemeSettings;
    expect(themeCss(settings, "x")).toContain("--content-width: 64rem");
    settings.layout.maxWidth = 1180;
    expect(themeCss(settings, "x")).toContain("--content-width: 1180px");
  });
});

describe("the theme's settings", () => {
  const settings = (): ThemeSettings => structuredClone(THEME_TEMPLATES.minimal.settings) as ThemeSettings;

  it("holds the elements, and an old theme without them reads as before", () => {
    expect(themeSettingsSchema.safeParse(settings()).success).toBe(true);
    const withElements = { ...settings(), elements: { h1: { typography: { text: { size: { value: 3, unit: "rem" } } } }, p: {} } };
    const parsed = themeSettingsSchema.safeParse(withElements);
    expect(parsed.success).toBe(true);
    // An element with nothing set is left out.
    expect(parsed.success && Object.keys(parsed.data.elements ?? {})).toEqual(["h1"]);
    expect(parseStoreTheme({ base: "minimal", savedId: null, settings: withElements }).settings.elements?.h1).toBeDefined();
  });

  it("refuses an element that cannot be drawn", () => {
    expect(themeElementsSchema.safeParse({ h1: { typography: { text: { size: { value: 9000, unit: "px" } } } } }).success).toBe(false);
    expect(themeElementsSchema.safeParse({ h1: { radius: -1 } }).success).toBe(false);
    expect(themeElementsSchema.safeParse({ h1: { typography: { text: { color: "red" } } } }).success).toBe(false);
  });

  it("is the tab's value and back, changing nothing else", () => {
    const base = settings();
    const value = themeTabValue(base);
    expect(value).toEqual({ elements: {}, maxWidth: null, background: { light: base.light.background, dark: base.dark.background } });
    const next = withThemeTab(base, { elements: { h2: { radius: 4 } }, maxWidth: 1200, background: { light: "#fafafa", dark: "#101010" } });
    expect(next.layout.maxWidth).toBe(1200);
    expect(next.light.background).toBe("#fafafa");
    expect(next.dark.background).toBe("#101010");
    expect(next.elements).toEqual({ h2: { radius: 4 } });
    // Taking everything away again leaves the theme as it was.
    expect(withThemeTab(next, themeTabValue(base))).toEqual(base);
  });

  it("names the families of the elements beside the fonts", () => {
    const families = themeFontFamilies({
      fonts: { heading: "Lora" },
      elements: { h1: { typography: { text: { family: "Inter" } }, at: { sm: { typography: { text: { family: "Lora" } } } } } },
    });
    expect([...families].sort()).toEqual(["Inter", "Lora"]);
  });
});

describe("editing an element as a part", () => {
  it("makes a part of the kind the element stands for, and keeps only what an element holds", () => {
    expect(elementAsPart("row", undefined)).toMatchObject({ type: "row" });
    expect(elementAsPart("h3", undefined)).toMatchObject({ type: "heading", level: 3 });
    expect(elementAsPart("p", undefined)).toMatchObject({ type: "richText" });
    expect(elementAsPart("button", undefined)).toMatchObject({ type: "button" });
    const part = elementAsPart("h1", { radius: 4 });
    expect(elementFromPart({ ...part, shadow: "md" })).toEqual({ radius: 4, shadow: "md" });
    expect(elementFromPart({ ...elementAsPart("h1", undefined) })).toBeUndefined();
    expect(THEME_ELEMENT_KEYS).toHaveLength(10);
  });
});

describe("columns", () => {
  it("are not styled by the theme's row, which their text only inherits", () => {
    const [row] = themedRows([rowOf([], {}, {})], { row: { typography: { text: { color: "#abcdef" } } } });
    expect(columnStyle(row.columns[0]).className).toBe("");
    expect(typographyAt(row as never, "text", "xl").color).toBe("#abcdef");
  });
});
