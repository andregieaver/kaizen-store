import { describe, expect, it } from "vitest";

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import { blockHasContent, blockText, isDualHeading, pageBlockSchema, type HeadingBlock, type PageBlock, type PageRow } from "./page-content";
import { blockStyle, partCss } from "./part-css";
import { partStyleAt, WIDTHS } from "./part-css.testing";
import { mapBlockTexts } from "./page-translation";
import { textRoles } from "./typography";

/**
 * A dual heading (D425): a heading's second part after its first, in the same heading, each part with its own look
 * (typography `first` and `second`), side by side or one under the other by screen size.
 */

const dual = (extra: Partial<HeadingBlock> = {}): HeadingBlock => ({ id: "h", type: "heading", text: "We are", second: "Kaizena Flow", level: 2, ...extra });
const rowOf = (block: PageBlock): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [block] }] });
const css = (block: PageBlock) => partCss([rowOf(block)], "site", DEFAULT_BREAKPOINTS);
function partStyle(block: PageBlock, selector: string, width: number): Record<string, string> {
  const wanted = `:where(${selector.replaceAll("&", `.${blockStyle(block, "site").className}`)})`;
  return partStyleAt(css(block), [], width, (s) => s === wanted);
}

describe("a dual heading", () => {
  it("is a heading with a second part that has words; its words are both parts'", () => {
    expect(isDualHeading(dual())).toBe(true);
    expect(isDualHeading(dual({ second: "  " }))).toBe(false);
    expect(isDualHeading(dual({ second: undefined }))).toBe(false);
    expect(blockText(dual())).toBe("We are Kaizena Flow");
    expect(blockHasContent(dual({ text: "" }))).toBe(true);
    expect(pageBlockSchema.safeParse(dual({ stack: true })).success).toBe(true);
    expect(pageBlockSchema.safeParse(dual({ second: "x".repeat(301) })).success).toBe(false);
  });

  it("gives each part a kind of text of its own in the Typography panel, only once it has a second part", () => {
    expect(textRoles(dual()).map((def) => def.role)).toEqual(["text", "first", "second"]);
    expect(textRoles(dual({ second: undefined })).map((def) => def.role)).toEqual(["text"]);
  });

  it("draws each part's own look on its own element", () => {
    const block = dual({ typography: { first: { color: "#111111" }, second: { color: "#aa0000", weight: 300 } } });
    expect(partStyle(block, "& [data-kz-text=first]", WIDTHS.xl).color).toBe("#111111");
    expect(partStyle(block, "& [data-kz-text=second]", WIDTHS.xl)).toMatchObject({ color: "#aa0000", "font-weight": "300" });
  });

  it("puts its parts one under the other at the sizes it stacks, and side by side at the others", () => {
    const block = dual({ at: { sm: { stack: true } } });
    expect(partStyle(block, "& [data-kz-text]", WIDTHS.sm).display).toBe("block");
    expect(partStyle(block, "& [data-kz-text]", WIDTHS.xl).display).toBeUndefined();
    expect(partStyle(dual({ stack: true }), "& [data-kz-text]", WIDTHS.xl).display).toBe("block");
    // A plain heading has no parts to stack.
    expect(css(dual({ second: undefined, stack: true }))).not.toContain("data-kz-text");
  });

  it("is translated part by part", () => {
    const seen: string[] = [];
    const out = mapBlockTexts(dual(), (key, value) => {
      seen.push(key);
      return typeof value === "string" ? value.toUpperCase() : value;
    }) as HeadingBlock;
    expect(seen).toEqual(["block.h.text", "block.h.second"]);
    expect(out).toMatchObject({ text: "WE ARE", second: "KAIZENA FLOW" });
  });
});
