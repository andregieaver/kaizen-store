import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buttonLook } from "@/components/page-block";

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import { PLATFORM_PALETTE, blend, colourCss, platformSwatches, themeSwatches } from "./colour";
import { cleanRichText, pageBlockSchema, pageBlockUnion, pageInput, newPageContent, type PageBlock, type PageRow } from "./page-content";
import { blockStyle, columnStyle, partCss, rowStyle } from "./part-css";
import { WIDTHS, partStyleAt } from "./part-css.testing";
import { newBlock } from "./page-rows";
import { upgradeResponsive } from "./responsive";
import { contrastRatio, THEME_TEMPLATES } from "./theme";
import { TEXT_FIELDS, textRoles } from "./typography";

/**
 * Text colour and opacity (D180, `docs/text-colour.md`): one helper writes a colour with an opacity; every kind of text of
 * every component, row and column takes a colour per screen size from the part stylesheet; the text colours kept on their
 * own before (a heading's, a button's, a dual button's two, a grid's and a form's button's) draw exactly as they did once
 * folded into typography; and rich text's colour mark is kept only as `#rrggbb` and 0–100.
 */

const rowOf = (blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }], ...extra });
const css = (block: PageBlock) => partCss([rowOf([block])], "site", DEFAULT_BREAKPOINTS);
const cls = (block: PageBlock) => blockStyle(block, "site").className;
/** What an element a role's selector names gets at a width. */
function roleStyle(block: PageBlock, selector: string, width: number): Record<string, string> {
  const wanted = `:where(${selector.replaceAll("&", `.${cls(block)}`)})`;
  return partStyleAt(css(block), [], width, (s) => s === wanted);
}
const TEST_WIDTHS = Object.values(WIDTHS);
let n = 0;
const ids = () => `x${++n}`;

describe("one colour helper", () => {
  it("writes a solid colour as itself and a see-through one mixed with transparent, as backgrounds always were", () => {
    expect(colourCss("#112233")).toBe("#112233");
    expect(colourCss("#112233", 100)).toBe("#112233");
    expect(colourCss("#112233", 40)).toBe("color-mix(in srgb, #112233 40%, transparent)");
    expect(colourCss("#112233", 0)).toBe("color-mix(in srgb, #112233 0%, transparent)");
    // A row's see-through background goes through it too.
    const row = rowOf([], { background: { type: "color", color: "#ffffff", opacity: 80 } });
    expect(partStyleAt(partCss([row], "site", DEFAULT_BREAKPOINTS), rowStyle(row).className.split(" "), 1400)["background-color"]).toBe(
      "color-mix(in srgb, #ffffff 80%, transparent)",
    );
  });

  it("blends a colour with its opacity over a solid background, channel by channel", () => {
    expect(blend("#000000", 50, "#ffffff")).toBe("#808080");
    expect(blend("#333333", 40, "#ffffff")).toBe("#adadad");
    expect(blend("#ff0000", 0, "#0000ff")).toBe("#0000ff");
    expect(blend("#AABBCC", undefined, "#000000")).toBe("#aabbcc");
    // Fading towards the background lowers the contrast, never raises it.
    for (const opacity of [100, 80, 60, 40, 20, 0]) {
      const lower = contrastRatio(blend("#1f2937", opacity, "#ffffff"), "#ffffff");
      if (opacity < 100) expect(lower).toBeLessThan(contrastRatio(blend("#1f2937", opacity + 20, "#ffffff"), "#ffffff"));
    }
  });

  it("offers the theme's colours as swatches, both looks where the site shows both, each colour once", () => {
    const minimal = THEME_TEMPLATES.minimal.settings;
    const swatches = themeSwatches(minimal);
    expect(swatches.length).toBeGreaterThan(0);
    expect(new Set(swatches.map((s) => s.colour)).size).toBe(swatches.length);
    for (const swatch of swatches) expect(swatch.colour).toMatch(/^#[0-9a-f]{6}$/);
    const light = themeSwatches({ ...minimal, mode: "light", visitorSwitch: false });
    expect(light.every((s) => !s.name.includes("("))).toBe(true);
    expect(light.map((s) => s.colour)).toContain(minimal.light.text.toLowerCase());
    expect(platformSwatches().map((s) => s.colour)).toEqual(expect.arrayContaining([PLATFORM_PALETTE.light.text, PLATFORM_PALETTE.dark.text]));
  });
});

// ---------------------------------------------------------------------------
// Every text has a colour
// ---------------------------------------------------------------------------

const BLOCK_TYPES = pageBlockUnion.options.map((option) => option.shape.type.value);

describe("every text a component draws has a colour (D180)", () => {
  it("gives every kind of text of every component a colour and an opacity, written by the part stylesheet as important", () => {
    for (const type of BLOCK_TYPES) {
      const parts = type === "product" ? ["title", "price", "description", "related"] : type === "site" ? ["logo", "business"] : [undefined];
      for (const part of parts) {
        const roles = new Set(Object.values(TEXT_FIELDS[type] ?? {}));
        for (const def of textRoles({ type, part })) roles.add(def.role);
        for (const role of roles) {
          if (type === "product" && part === "title" && role === "heading") continue;
          const block = { ...(newBlock(type, () => "x1") as PageBlock), ...(part ? { part } : {}), typography: { [role]: { color: "#123456", opacity: 70 } } } as PageBlock;
          expect(css(block), `${type}${part ? ` (${part})` : ""}: ${role}`).toContain("color:color-mix(in srgb, #123456 70%, transparent)!important");
        }
      }
    }
  });

  it("gives rows and columns a colour their text inherits, per screen size", () => {
    const row = rowOf([], { typography: { text: { color: "#aa0000" } }, at: { sm: { typography: { text: { opacity: 50 } } } } } as Partial<PageRow>);
    const sheet = partCss([row], "site", DEFAULT_BREAKPOINTS);
    const classes = rowStyle(row).className.split(" ");
    expect(partStyleAt(sheet, classes, WIDTHS.xl).color).toBe("#aa0000");
    expect(partStyleAt(sheet, classes, WIDTHS.sm).color).toBe("color-mix(in srgb, #aa0000 50%, transparent)");
    const column = { id: "c", blocks: [], typography: { text: { color: "#00aa00" } } };
    expect(partStyleAt(partCss([rowOf([], { columns: [column] })], "site", DEFAULT_BREAKPOINTS), columnStyle(column).className.split(" "), WIDTHS.md).color).toBe("#00aa00");
  });

  it("walks a colour and its opacity apart by size, and takes a dual button's shared colour where a button has none", () => {
    const heading = { id: "h", type: "heading", text: "x", level: 2, typography: { text: { color: "#111111" } }, at: { md: { typography: { text: { color: "#222222", opacity: 40 } } } } } as PageBlock;
    const sel = "& :is(h1, h2, h3, h4, h5, h6)";
    expect(roleStyle(heading, sel, WIDTHS.xl).color).toBe("#111111");
    expect(roleStyle(heading, sel, WIDTHS.lg).color).toBe("#111111");
    expect(roleStyle(heading, sel, WIDTHS.md).color).toBe("color-mix(in srgb, #222222 40%, transparent)");
    expect(roleStyle(heading, sel, WIDTHS.sm).color).toBe("color-mix(in srgb, #222222 40%, transparent)");
    const dual = {
      id: "d",
      type: "dualButton",
      first: { label: "A", href: "/" },
      second: { label: "B", href: "/" },
      typography: { text: { color: "#333333" }, second: { color: "#444444" } },
      at: { sm: { typography: { first: { color: "#555555" } } } },
    } as PageBlock;
    expect(roleStyle(dual, "& [data-kz-text=first]", WIDTHS.xl).color).toBe("#333333");
    expect(roleStyle(dual, "& [data-kz-text=first]", WIDTHS.sm).color).toBe("#555555");
    expect(roleStyle(dual, "& [data-kz-text=second]", WIDTHS.sm).color).toBe("#444444");
    // The shared group's own selector carries no colour: the two do, so a size's own colour of one always wins.
    expect(roleStyle(dual, "& [data-dual-buttons] > a", WIDTHS.xl).color).toBeUndefined();
  });

  it("makes a menu's, a site part's and a product part's colour the colour of all they draw but their buttons", () => {
    const menu = { id: "m", type: "menu", menuId: "x", typography: { text: { color: "#0a0a0a" } } } as unknown as PageBlock;
    expect(css(menu)).toMatch(/:where\(\.kzr-[\w-]+ :not\(button, button \*, \.button-primary, \.button-primary \*, \[data-button-frame\], \[data-button-frame\] \*\)\)\{color:inherit!important\}/);
  });

  it("accepts colours as #rrggbb and opacities as whole numbers from 0 to 100, and refuses the rest", () => {
    const parse = (typography: unknown) => pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, typography });
    expect(parse({ text: { color: "#1f2937", opacity: 0 } }).success).toBe(true);
    expect(parse({ text: { color: "#1F2937", opacity: 100 } }).success).toBe(true);
    for (const bad of [{ color: "#fff" }, { color: "red" }, { color: "#12345g" }, { opacity: 101 }, { opacity: -1 }, { opacity: 50.5 }, { opacity: "50" }]) {
      expect(parse({ text: bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, at: { sm: { typography: { text: { opacity: 30 } } } } }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Text colours kept on their own before draw as they did (property)
// ---------------------------------------------------------------------------

const FILLS = [undefined, "#1d4ed8"] as const;
const COLOURS = [undefined, "#ffffff", "#a84a26"] as const;
const VARIANTS = [undefined, "filled", "outline", "text"] as const;

/** The colour the old inline style gave a button, or null where it set none (its class's colour). */
function oldButtonColour(look: { variant?: string; fill?: string; textColor?: string }): string | null {
  const variant = look.variant ?? "filled";
  if (variant === "filled") return look.textColor ?? null;
  return look.textColor ?? look.fill ?? null;
}

/** The colour a button gets now: the part stylesheet's (important, beating its inline style), else its inline style's, else null. */
function newButtonColour(block: PageBlock, selector: string, look: { variant?: (typeof VARIANTS)[number]; fill?: string }, width: number): string | null {
  const rule = roleStyle(block, selector, width).color;
  if (rule) return rule;
  const inline = buttonLook(look).style.color;
  return typeof inline === "string" ? inline : null;
}

describe("text colours saved before D180 draw as they did once folded into typography (property)", () => {
  it("gives a heading's own colour to its heading at every width", () => {
    for (const textColor of COLOURS) {
      const old = { id: "h", type: "heading", text: "x", level: 3, ...(textColor && { textColor }) };
      const block = pageBlockSchema.parse(old) as PageBlock;
      expect(block).not.toHaveProperty("textColor");
      for (const width of TEST_WIDTHS) expect(roleStyle(block, "& :is(h1, h2, h3, h4, h5, h6)", width).color ?? null, `${textColor} at ${width}`).toBe(textColor ?? null);
    }
  });

  it("gives every button, dual button side, grid button and form button the colour its old inline style gave it", () => {
    for (const variant of VARIANTS) {
      for (const fill of FILLS) {
        for (const textColor of COLOURS) {
          const look = { ...(variant && { variant }), ...(fill && { fill }) };
          const old = { ...look, ...(textColor && { textColor }) };
          const want = oldButtonColour(old);
          const cases: { raw: Record<string, unknown>; selector: string }[] = [
            { raw: { id: "b", type: "button", label: "Go", href: "/", ...old }, selector: "& [data-button-frame]" },
            { raw: { id: "d", type: "dualButton", first: { label: "A", href: "/", ...old }, second: { label: "B", href: "/", ...old } }, selector: "& [data-kz-text=first]" },
            { raw: { id: "d", type: "dualButton", first: { label: "A", href: "/" }, second: { label: "B", href: "/", ...old } }, selector: "& [data-kz-text=second]" },
            { raw: { ...(newBlock("contentGrid", ids) as object), id: "g", button: old }, selector: "& [data-kz-text=button]" },
            { raw: { ...(newBlock("emailForm", ids) as object), id: "f", button: old }, selector: "& button[type=submit]" },
            { raw: { ...(newBlock("newsletter", ids) as object), id: "n", button: old }, selector: "& button[type=submit]" },
          ];
          for (const { raw, selector } of cases) {
            const block = pageBlockSchema.parse(raw) as PageBlock;
            expect(JSON.stringify(block)).not.toContain("textColor");
            for (const width of TEST_WIDTHS) {
              expect(newButtonColour(block, selector, look, width), `${raw.type} ${JSON.stringify(old)} at ${width}`).toBe(want);
            }
          }
        }
      }
    }
  });

  it("folds the same through upgradeResponsive(), and a page saved again keeps it", () => {
    const rows = [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "h", type: "heading", text: "x", level: 2, textColor: "#a84a26" }] }] }];
    expect(JSON.stringify(upgradeResponsive(rows))).toContain('"typography":{"text":{"color":"#a84a26"}}');
    const parsed = pageInput.parse({ ...newPageContent(), title: "T", slug: "t", rows });
    const again = pageInput.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again.rows[0].columns[0].blocks[0]).toEqual(parsed.rows[0].columns[0].blocks[0]);
  });

  it("refuses an old colour it could not hold, as before", () => {
    expect(pageBlockSchema.safeParse({ id: "h", type: "heading", text: "x", level: 2, textColor: "red" }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ id: "b", type: "button", label: "x", href: "/", textColor: "#12" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rich text's colour mark
// ---------------------------------------------------------------------------

describe("rich text's colour mark", () => {
  const docWith = (attrs: unknown) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi", marks: [{ type: "textStyle", attrs }] }] }] });
  const marksOf = (result: ReturnType<typeof cleanRichText>) => (result.ok ? (result.doc.content[0] as { content: { marks?: unknown[] }[] }).content[0].marks : null);

  it("keeps a colour as #rrggbb (lower case) and an opacity from 0 to 99, and drops what else Tiptap may carry", () => {
    expect(marksOf(cleanRichText(docWith({ color: "#1D4ED8", fontFamily: "Comic Sans" })))).toEqual([{ type: "textStyle", attrs: { color: "#1d4ed8" } }]);
    expect(marksOf(cleanRichText(docWith({ color: "#1d4ed8", opacity: 40 })))).toEqual([{ type: "textStyle", attrs: { color: "#1d4ed8", opacity: 40 } }]);
    // Solid is no opacity; a text style without a colour is no mark.
    expect(marksOf(cleanRichText(docWith({ color: "#1d4ed8", opacity: 100 })))).toEqual([{ type: "textStyle", attrs: { color: "#1d4ed8" } }]);
    expect(marksOf(cleanRichText(docWith({ color: null, opacity: null })))).toBeUndefined();
  });

  it("refuses any other colour or opacity", () => {
    for (const attrs of [{ color: "red" }, { color: "#fff" }, { color: "url(x)" }, { color: "#1d4ed8;background:red" }, { color: "#1d4ed8", opacity: 101 }, { color: "#1d4ed8", opacity: 2.5 }, { color: "#1d4ed8", opacity: "40" }]) {
      expect(cleanRichText(docWith(attrs)).ok, JSON.stringify(attrs)).toBe(false);
    }
  });
});

describe("<RichText> draws the colour mark as a style, never as HTML", () => {
  it("colours the words inside a link, with the opacity mixed in, and draws nothing for a colour it would not keep", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { RichText } = await import("@/components/rich-text");
    const html = (marks: unknown[]) =>
      renderToString(createElement(RichText, { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi <b>", marks }] }] } as never }));
    expect(html([{ type: "textStyle", attrs: { color: "#1d4ed8" } }])).toContain('<span style="color:#1d4ed8">Hi &lt;b&gt;</span>');
    const linked = html([{ type: "link", attrs: { href: "https://example.com" } }, { type: "textStyle", attrs: { color: "#1d4ed8", opacity: 40 } }]);
    expect(linked).toMatch(/<a href="https:\/\/example.com"[^>]*><span style="color:color-mix\(in srgb, #1d4ed8 40%, transparent\)">Hi &lt;b&gt;<\/span><\/a>/);
    // Only what `cleanRichText()` keeps reaches a page; anything else is not drawn as a style.
    expect(html([{ type: "textStyle", attrs: { color: "red;background:url(x)" } }])).not.toContain("style=");
  });
});
