import { describe, expect, it } from "vitest";

import { barPosition, cleanHeadingText, inlineKindOf } from "./inline-edit";
import { HEADING_MAX, type PageBlock } from "./page-content";

/** Editing a page's words where they are (D191, D192): which components, what a heading's text may hold, where the bar goes. */

const doc = { type: "doc" as const, content: [] };

describe("what is edited in place", () => {
  it("is a heading or a rich text, whose words are the block's own", () => {
    expect(inlineKindOf({ id: "h", type: "heading", text: "Hello", level: 2 } as PageBlock)).toBe("heading");
    expect(inlineKindOf({ id: "t", type: "richText", doc } as PageBlock)).toBe("richText");
  });

  it("is nothing else, and not words taken from a custom field", () => {
    expect(inlineKindOf({ id: "b", type: "button", label: "Buy", href: "/buy" } as PageBlock)).toBeNull();
    expect(inlineKindOf({ id: "i", type: "image", image: null } as PageBlock)).toBeNull();
    const bound = { id: "h", type: "heading", text: "", level: 2, bind: { source: "page", field: "f" } } as unknown as PageBlock;
    expect(inlineKindOf(bound)).toBeNull();
  });
});

describe("a heading's text as typed in place", () => {
  it("is one line: a line break is a space, so a paste cannot split it", () => {
    expect(cleanHeadingText("One\nTwo")).toBe("One Two");
    expect(cleanHeadingText("One\r\n\r\nTwo Three")).toBe("One Two Three");
  });

  it("keeps its inline markup and loses control characters", () => {
    expect(cleanHeadingText("A <strong>big</strong> day")).toBe("A <strong>big</strong> day");
    expect(cleanHeadingText("a\u0000b\u0007c\u007fd")).toBe("abcd");
  });

  it("is held to the heading's limit", () => {
    expect(cleanHeadingText("x".repeat(HEADING_MAX + 40))).toHaveLength(HEADING_MAX);
    expect(cleanHeadingText("x".repeat(HEADING_MAX))).toHaveLength(HEADING_MAX);
  });
});

describe("where the floating bar goes", () => {
  const viewport = { width: 1000, height: 700 };
  const bar = { width: 400, height: 44 };
  const at = (left: number, top: number, width = 300, height = 30) => ({ left, top, right: left + width, bottom: top + height });

  it("is above the text where there is room, in line with its left edge", () => {
    expect(barPosition(at(120, 300), bar, viewport)).toEqual({ left: 120, top: 300 - 44 - 8 });
  });

  it("is under the text where there is no room above", () => {
    expect(barPosition(at(120, 20), bar, viewport)).toEqual({ left: 120, top: 20 + 30 + 8 });
  });

  it("is kept on the screen at the sides and under the text near the bottom", () => {
    expect(barPosition(at(900, 300), bar, viewport).left).toBe(1000 - 400 - 8);
    expect(barPosition(at(-50, 300), bar, viewport).left).toBe(8);
    // No room above and none under: as low as it fits.
    expect(barPosition(at(120, 10, 300, 690), bar, viewport).top).toBe(700 - 44 - 8);
  });
});
