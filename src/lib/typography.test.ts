import { describe, expect, it } from "vitest";

import { DEFAULT_BREAKPOINTS, type Size } from "./breakpoints";
import { pageBlockSchema, pageBlockUnion, pageFonts, pageInput, newPageContent, type PageBlock, type PageRow, type TextAlign, type TextAlignments } from "./page-content";
import { blockStyle, partCss, rowStyle } from "./part-css";
import { partStyleAt, WIDTHS } from "./part-css.testing";
import { newBlock } from "./page-rows";
import { mapBlockTexts } from "./page-translation";
import { boxFamilies, clearTypographyAt, HEADING_PRESETS, TEXT_FIELDS, textRoles, typographyAt, typographyPatch, typographySource, UNDRAWN_TEXTS, type HeadingPreset } from "./typography";

/**
 * Typography (D179 phase 3, `docs/responsive-editing.md` 11): every text of every component has a kind of text with a size
 * of its own; the settings saved before the panel draw as they did once folded into it (property tests against the old
 * Tailwind classes, at 375, 800, 1100 and 1400 px); and the panel's helpers write a size's own and give it back.
 */

const TEST_WIDTHS = Object.values(WIDTHS);
const SIZE_OF_WIDTH = (width: number): Size => (width < 768 ? "sm" : width < 1024 ? "md" : width < 1280 ? "lg" : "xl");
const rowOf = (blocks: PageBlock[]): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }] });
const css = (block: PageBlock) => partCss([rowOf([block])], "site", DEFAULT_BREAKPOINTS);
const cls = (block: PageBlock) => blockStyle(block, "site").className;
/** What an element a role's selector names gets at a width (`& …`, written `:where(.kzr-… …)`). */
function roleStyle(block: PageBlock, selector: string, width: number): Record<string, string> {
  const name = cls(block);
  const wanted = `:where(${selector.replaceAll("&", `.${name}`)})`;
  return partStyleAt(css(block), [], width, (s) => s === wanted);
}
const boxStyle = (block: PageBlock, width: number) => partStyleAt(css(block), cls(block).split(" "), width);

// ---------------------------------------------------------------------------
// Every text has a size
// ---------------------------------------------------------------------------

const BLOCK_TYPES = pageBlockUnion.options.map((option) => option.shape.type.value);

/** A block of a kind with every text it can hold written (items, fields, details), so `mapBlockTexts()` lists them all. */
function filled(type: PageBlock["type"]): PageBlock {
  let n = 0;
  const id = () => `x${++n}`;
  const block = newBlock(type, id) as Record<string, unknown>;
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Words" }] }] };
  const panel = { id: "p1", title: "T", body: doc };
  switch (type) {
    case "contentGrid":
      return {
        ...block,
        source: { type: "custom" },
        items: [{ id: "i1", title: "T", text: "X", badge: "B", priceText: "P", buttonLabel: "Go", picture: { url: "/a.webp", width: 1, height: 1, alt: "A" }, link: null, date: null, details: [{ id: "d1", label: "L", text: "D" }] }],
      } as PageBlock;
    case "accordion":
    case "tabs":
    case "faq":
      return { ...block, items: [panel] } as PageBlock;
    case "testimonials":
      return { ...block, items: [{ id: "t1", quote: "Q", name: "N", role: "R", picture: null }] } as PageBlock;
    case "iconList":
      return { ...block, items: [{ id: "l1", icon: "check", text: "L", href: "" }] } as PageBlock;
    case "emailForm":
      return { ...block, consent: "C", fields: [{ id: "f1", kind: "select", label: "L", placeholder: "H", options: ["A", "B"] }] } as PageBlock;
    case "product":
    case "customField":
    case "fieldLoop":
      return { ...block, heading: "H" } as PageBlock;
    default:
      return block as PageBlock;
  }
}

/** A text's key without the block and with every id as `*` (`block.b.items.i1.title` → `*.title`). */
const pattern = (key: string, block: PageBlock) =>
  key
    .replace(`block.${block.id}.`, "")
    .replace(/^(i1|p1|t1|l1|f1)\./, "*.")
    .replace(/detail-d1\./, "detail-*.")
    .replace(/option\d+$/, "option*");

describe("every text a component draws has a size (owner's addition to phase 3) and a colour (D180)", () => {
  it("names a kind of text for every text of every kind of component", () => {
    for (const type of BLOCK_TYPES) {
      const block = filled(type);
      const keys: string[] = [];
      mapBlockTexts(block, (key, value) => {
        keys.push(pattern(key, block));
        return value;
      });
      const fields = TEXT_FIELDS[type] ?? {};
      const undrawn = UNDRAWN_TEXTS[type] ?? [];
      for (const key of keys) {
        expect(key in fields || undrawn.includes(key), `${type}: the text "${key}" has no kind of text in TEXT_FIELDS`).toBe(true);
      }
    }
  });

  it("gives every kind of text named a group in the Typography panel, which writes its size", () => {
    for (const type of BLOCK_TYPES) {
      const parts = type === "product" ? ["title", "price", "description", "related"] : type === "site" ? ["logo", "business"] : [undefined];
      for (const part of parts) {
        const roles = textRoles({ type, part }).map((def) => def.role);
        for (const [field, role] of Object.entries(TEXT_FIELDS[type] ?? {})) {
          // A product title's heading is the title itself.
          if (type === "product" && part === "title" && role === "heading") continue;
          expect(roles, `${type}${part ? ` (${part})` : ""}: ${field} → ${role}`).toContain(role);
        }
        for (const def of textRoles({ type, part })) {
          const block = { ...filled(type), ...(part ? { part } : {}), typography: { [def.role]: { size: { value: 21, unit: "px" }, color: "#123456" } } } as PageBlock;
          expect(css(block), `${type}: ${def.role}`).toContain("font-size:21px");
          // And a colour (D180, `docs/text-colour.md`): every text has one too.
          expect(css(block), `${type}: ${def.role} colour`).toContain("color:#123456!important");
        }
      }
    }
  });

  it("knows every kind of component that draws text (none is forgotten in TEXT_FIELDS)", () => {
    const silent = ["separator", "video", "html"];
    for (const type of BLOCK_TYPES) {
      if (silent.includes(type)) expect(textRoles({ type })).toEqual([]);
      else expect(Object.keys(TEXT_FIELDS[type] ?? {}).length, type).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The upgrade draws as the old classes did
// ---------------------------------------------------------------------------

const PRESETS: (HeadingPreset | undefined)[] = [undefined, "sm", "md", "lg", "xl", "2xl"];
const LEVEL_PRESET: Record<number, HeadingPreset> = { 1: "xl", 2: "lg", 3: "md", 4: "sm", 5: "sm", 6: "sm" };
/** The rem a preset's old classes gave at a width (`text-xl md:text-2xl`: the window from 768 px). */
const OLD_SIZE: Record<HeadingPreset, [string, string]> = { sm: ["1.125rem", "1.125rem"], md: ["1.25rem", "1.5rem"], lg: ["1.5rem", "1.875rem"], xl: ["1.875rem", "3rem"], "2xl": ["2.25rem", "3.75rem"] };
const OLD_LINE: Record<HeadingPreset, [string, string]> = { sm: ["28px", "28px"], md: ["28px", "32px"], lg: ["32px", "36px"], xl: ["36px", "48px"], "2xl": ["40px", "60px"] };
const oldSize = (preset: HeadingPreset, width: number) => OLD_SIZE[preset][width >= 768 ? 1 : 0];
const WEIGHTS = { normal: "400", medium: "500", semibold: "600", bold: "700" } as const;
const ALIGNS: (TextAlign | undefined)[] = [undefined, "left", "center", "right"];
const everyAlignment = (): TextAlignments[] =>
  ALIGNS.flatMap((mobile) => ALIGNS.flatMap((tablet) => ALIGNS.map((desktop) => ({ ...(mobile && { mobile }), ...(tablet && { tablet }), ...(desktop && { desktop }) }))));
function oldAlignAt(view: TextAlignments, width: number): TextAlign | undefined {
  let value = view.mobile;
  if (width >= 768 && view.tablet) value = view.tablet;
  if (width >= 1024 && view.desktop) value = view.desktop;
  return value;
}
const H = "& :is(h1, h2, h3, h4, h5, h6)";

describe("settings saved before the panel draw as they did (property)", () => {
  it("gives every heading's size, weight and alignment by screen the same value at every width", () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      for (const size of PRESETS) {
        for (const weight of [undefined, ...Object.keys(WEIGHTS)] as (keyof typeof WEIGHTS | undefined)[]) {
          for (const align of everyAlignment().filter((_, i) => (i + level) % 7 === 0)) {
            const old = { id: "h", type: "heading", text: "Words", level, ...(size && { size }), ...(weight && { weight }), align };
            const block = pageBlockSchema.parse(old) as PageBlock;
            expect(block).not.toHaveProperty("size");
            expect(block).not.toHaveProperty("weight");
            expect(block).not.toHaveProperty("align");
            for (const width of TEST_WIDTHS) {
              const heading = roleStyle(block, H, width);
              const label = JSON.stringify([old, width]);
              expect(heading["font-size"], label).toBe(oldSize(size ?? LEVEL_PRESET[level], width));
              // Without a weight the theme's (`font-heading`) stands, as before.
              expect(heading["font-weight"], label).toBe(weight ? WEIGHTS[weight] : undefined);
              const oldAlign = oldAlignAt(align, width);
              expect(boxStyle(block, width)["text-align"] ?? "none", label).toBe(oldAlign ?? (Object.keys(align).length > 0 ? "left" : "none"));
            }
          }
        }
      }
    }
  });

  it("gives an accordion's and FAQ's titles, a grid's titles and a product's title their old size (and line height where the class set it)", () => {
    for (const preset of PRESETS) {
      const accordion = pageBlockSchema.parse({ ...newBlock("faq", () => "f"), ...(preset && { titleSize: preset }) }) as PageBlock;
      const grid = pageBlockSchema.parse({ ...newBlock("contentGrid", () => "g"), ...(preset && { headingSize: preset }) }) as PageBlock;
      const title = pageBlockSchema.parse({ ...newBlock("product", () => "p", "title"), ...(preset && { size: preset }) }) as PageBlock;
      for (const width of TEST_WIDTHS) {
        const summary = roleStyle(accordion, "& summary", width);
        const tile = roleStyle(grid, "& [data-kz-text=title]", width);
        const h1 = roleStyle(title, "& :is(h1, [data-kz-stand-in=title])", width);
        if (!preset) {
          // The class the component keeps (`text-lg`, `text-3xl`) draws it, as it did.
          for (const style of [summary, tile, h1]) expect(style["font-size"]).toBeUndefined();
          continue;
        }
        const at = width >= 768 ? 1 : 0;
        expect([preset, width, summary["font-size"], summary["line-height"]]).toEqual([preset, width, OLD_SIZE[preset][at], OLD_LINE[preset][at]]);
        // A grid's title has its own line height (`leading-snug`), so only its size moved.
        expect([preset, width, tile["font-size"], tile["line-height"]]).toEqual([preset, width, OLD_SIZE[preset][at], undefined]);
        expect([preset, width, h1["font-size"], h1["line-height"]]).toEqual([preset, width, OLD_SIZE[preset][at], OLD_LINE[preset][at]]);
      }
    }
    // The presets are Tailwind's sizes and line heights.
    expect(HEADING_PRESETS.md).toEqual({ from: [1.5, 32], small: [1.25, 28] });
  });

  it("gives a button's and a dual button's weight, and every font, the same element as before", () => {
    for (const [weight, value] of Object.entries(WEIGHTS)) {
      const button = pageBlockSchema.parse({ id: "b", type: "button", label: "Go", href: "/", weight }) as PageBlock;
      for (const width of TEST_WIDTHS) expect(roleStyle(button, "& [data-button-frame]", width)["font-weight"]).toBe(value);
      const dual = pageBlockSchema.parse({ ...newBlock("dualButton", () => "d"), weight }) as PageBlock;
      expect(roleStyle(dual, "& [data-dual-buttons] > a", 1400)["font-weight"]).toBe(value);
    }
    const fonted = (block: Record<string, unknown>) => pageBlockSchema.parse({ ...block, font: "Lora" }) as PageBlock;
    // A block's font is its family's class on the block, as it was (and so its headings' too, by the font's stylesheet).
    for (const type of ["richText", "heading", "button", "image", "accordion", "menu", "site", "testimonials", "emailForm"] as const) {
      let n = 0;
      const block = fonted(newBlock(type, () => `b${++n}`) as Record<string, unknown>);
      expect(boxFamilies(block), type).toEqual(["Lora"]);
      expect(css(block), type).not.toContain("font-family");
    }
    // A grid's title font is its titles' class (`familyClassOf`), drawn by the grid.
    const grid = pageBlockSchema.parse({ ...newBlock("contentGrid", () => "g"), headingFont: "Lora" }) as PageBlock;
    expect(boxFamilies(grid)).toEqual([]);
    expect(grid.typography?.title?.family).toBe("Lora");
  });

  it("refuses an old value it could not hold, as before", () => {
    expect(pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, size: "giant" }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, weight: "heavy" }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ id: "t", type: "richText", doc: { type: "doc", content: [] }, align: "justify" }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ id: "t", type: "richText", doc: { type: "doc", content: [] }, font: "<b>" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drawing and editing
// ---------------------------------------------------------------------------

describe("the Typography panel's settings", () => {
  it("are drawn per size by the part stylesheet, never inline, each key walked on its own", () => {
    const block = pageBlockSchema.parse({
      id: "t",
      type: "richText",
      doc: { type: "doc", content: [] },
      typography: { text: { size: { value: 20, unit: "px" }, lineHeight: { value: 1.4, unit: "" }, letterSpacing: { value: 0.05, unit: "em" }, transform: "uppercase", decoration: "underline", style: "italic", variant: "small-caps", weight: 300, textShadow: { color: "#112233", x: 1, y: 2, blur: 3 } } },
      at: { md: { typography: { text: { size: { value: 2, unit: "rem" } } } }, sm: { typography: { text: { textShadow: null, transform: "none" } } } },
    }) as PageBlock;
    const at = (width: number) => partStyleAt(css(block), [], width, (s) => s === `.${cls(block)} .rich-text`);
    expect(at(1400)).toMatchObject({ "font-size": "20px", "line-height": "1.4", "letter-spacing": "0.05em", "text-transform": "uppercase", "text-decoration-line": "underline", "font-style": "italic", "font-variant-caps": "small-caps", "font-weight": "300", "text-shadow": "1px 2px 3px #112233" });
    expect(at(800)).toMatchObject({ "font-size": "2rem", "line-height": "1.4", "text-shadow": "1px 2px 3px #112233" });
    expect(at(375)).toMatchObject({ "font-size": "2rem", "text-shadow": "none", "text-transform": "none", "font-weight": "300" });
  });

  it("draws a family by size as a rule that wins over the family's class, and a row's text for what it holds", () => {
    const block = pageBlockSchema.parse({ id: "t", type: "richText", doc: { type: "doc", content: [] }, typography: { text: { family: "Lora" } }, at: { sm: { typography: { text: { family: "Inter" } } } } }) as PageBlock;
    expect(boxFamilies(block)).toEqual([]);
    expect(css(block)).toContain('font-family:"Lora"');
    expect(css(block)).toContain('font-family:"Inter"');
    const row = { ...rowOf([]), typography: { text: { size: { value: 18, unit: "px" as const }, align: "center" as const } } };
    expect(partStyleAt(partCss([row], "site", DEFAULT_BREAKPOINTS), rowStyle(row).className.split(" "), 1400)).toMatchObject({ "font-size": "18px", "text-align": "center" });
  });

  it("writes a size's own, takes it away when it equals what the size inherits, and gives it back", () => {
    const block = { typography: { text: { size: { value: 20, unit: "px" as const } } } };
    const md = typographyPatch(block, "md", "text", "size", { value: 16, unit: "px" });
    expect(md).toEqual({ at: { md: { typography: { text: { size: { value: 16, unit: "px" } } } } } });
    const after = { ...block, ...md };
    expect(typographyAt(after, "text", "sm").size).toEqual({ value: 16, unit: "px" });
    expect(typographySource(after, "text", "size", "sm")).toEqual({ own: false, from: "md" });
    expect(typographySource(after, "text", "size", "md")).toEqual({ own: true, from: "md" });
    expect(typographyPatch(after, "md", "text", "size", { value: 20, unit: "px" })).toEqual({ at: undefined });
    expect(clearTypographyAt(after, "md", "text", "size")).toEqual({ at: undefined });
    expect(typographyPatch(block, "xl", "text", "size", undefined)).toEqual({ typography: undefined });
    // A shadow taken away under a larger size's is none there.
    const shadowed = { typography: { text: { textShadow: { color: "#000000", x: 1, y: 1, blur: 1 } } } };
    expect(typographyPatch(shadowed, "sm", "text", "textShadow", undefined)).toEqual({ at: { sm: { typography: { text: { textShadow: null } } } } });
  });

  it("lists every family a page's rows, columns and blocks use at any size, for its stylesheets and their install", () => {
    const content = pageInput.parse({
      ...newPageContent(),
      title: "F",
      slug: "f",
      rows: [
        {
          ...rowOf([{ id: "t", type: "richText", doc: { type: "doc", content: [] }, typography: { body: { family: "Inter" } }, at: { sm: { typography: { text: { family: "Lora" } } } } } as unknown as PageBlock]),
          typography: { text: { family: "Playfair Display" } },
        },
      ],
    });
    expect(pageFonts(content).sort()).toEqual(["Inter", "Lora", "Playfair Display"]);
  });
});
