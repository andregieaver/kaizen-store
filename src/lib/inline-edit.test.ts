import { describe, expect, it } from "vitest";

import { applyBlockEdit, barPosition, blockWords, cleanHeadingText, inlineKindOf, inlineMarkOf, inlineProblem, isSharedBlock, locateBlock } from "./inline-edit";
import { HEADING_MAX, newPageContent, type PageBlock, type PageContent, type PageRow } from "./page-content";

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

// ---------------------------------------------------------------------------
// On the live site
// ---------------------------------------------------------------------------

const para = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] });
const heading = (extra: Record<string, unknown> = {}) => ({ id: "h", type: "heading", text: "Hello", level: 2, ...extra }) as PageBlock;
const text = (extra: Record<string, unknown> = {}) => ({ id: "t", type: "richText", doc: para("Words"), ...extra }) as PageBlock;
const button = { id: "b", type: "button", label: "Buy", href: "/buy" } as PageBlock;
const rowOf = (blocks: PageBlock[], extra: Record<string, unknown> = {}, column: Record<string, unknown> = {}): PageRow =>
  ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks, ...column }], ...extra }) as PageRow;
const pageOf = (...rows: PageRow[]): PageContent => ({ ...newPageContent(), title: "Page", slug: "page", rows });

describe("finding a block", () => {
  it("gives it with its row and column, or nothing", () => {
    const rows = [rowOf([heading()]), { ...rowOf([text()]), id: "r2" }];
    const found = locateBlock(rows, "t");
    expect(found?.row.id).toBe("r2");
    expect(found?.column.id).toBe("c");
    expect(found?.block.id).toBe("t");
    expect(locateBlock(rows, "nope")).toBeNull();
  });
});

describe("words shared with other pages", () => {
  const place = (row: Record<string, unknown>, column: Record<string, unknown>, block: Record<string, unknown>) => {
    const r = rowOf([heading(block)], row, column);
    return { row: r, column: r.columns[0], block: r.columns[0].blocks[0] };
  };

  it("are those inside the use of a global part, at any level", () => {
    expect(isSharedBlock(place({}, {}, {}))).toBe(false);
    expect(isSharedBlock(place({ global: "g1" }, {}, {}))).toBe(true);
    expect(isSharedBlock(place({}, { global: "g1" }, {}))).toBe(true);
    expect(isSharedBlock(place({}, {}, { global: "g1" }))).toBe(true);
  });

  it("are not those the page marks as its own inside a use", () => {
    expect(isSharedBlock(place({ global: "g1" }, {}, { local: true }))).toBe(false);
    expect(isSharedBlock(place({ global: "g1" }, { local: true }, {}))).toBe(false);
    // A global of its own again inside a part that is the page's.
    expect(isSharedBlock(place({ global: "g1" }, { local: true }, { global: "g2" }))).toBe(true);
  });
});

describe("what the live site marks as editable", () => {
  const placeOf = (block: PageBlock, row: Record<string, unknown> = {}) => {
    const r = rowOf([block], row);
    return { row: r, column: r.columns[0], block };
  };

  it("is a heading or a text of the page's own", () => {
    expect(inlineMarkOf(placeOf(heading()), false)).toBe("heading");
    expect(inlineMarkOf(placeOf(text()), false)).toBe("richText");
  });

  it("is nothing in a modal, nothing shared, nothing that is not words", () => {
    expect(inlineMarkOf(placeOf(heading()), true)).toBeNull();
    expect(inlineMarkOf(placeOf(heading(), { global: "g1" }), false)).toBeNull();
    expect(inlineMarkOf(placeOf(button), false)).toBeNull();
  });

  it("says why a block cannot be edited there, in the words of the page builder", () => {
    const rows = [rowOf([heading(), button]), { ...rowOf([text()], { global: "g1" }), id: "r2", columns: [{ id: "c2", blocks: [text({ id: "t2" })] }] }];
    expect(inlineProblem(rows, "h")).toBeNull();
    expect(inlineProblem(rows, "b")).toMatch(/page builder/);
    expect(inlineProblem(rows, "t2")).toMatch(/shared with other pages/);
    expect(inlineProblem(rows, "gone")).toMatch(/no longer on the page/);
  });
});

describe("changing a block's words", () => {
  it("replaces a heading's text or a text's document, leaving the rest of the page as it was", () => {
    const page = pageOf(rowOf([heading(), text()]));
    const edited = applyBlockEdit(page, "h", { kind: "heading", text: "Goodbye" });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(blockWords(locateBlock(edited.content.rows, "h")!.block)).toBe("Goodbye");
    expect(blockWords(locateBlock(edited.content.rows, "t")!.block)).toBe(JSON.stringify(para("Words")));
    // The page given is not changed.
    expect(blockWords(locateBlock(page.rows, "h")!.block)).toBe("Hello");

    const again = applyBlockEdit(page, "t", { kind: "richText", doc: para("New words") });
    expect(again.ok && blockWords(locateBlock(again.content.rows, "t")!.block)).toBe(JSON.stringify(para("New words")));
  });

  it("refuses what is not that kind of block, a shared one, a missing one and an emptied one", () => {
    const page = pageOf(rowOf([heading(), text()]), { ...rowOf([text()], { global: "g1" }), id: "r2", columns: [{ id: "c2", blocks: [text({ id: "t2" })] }] });
    expect(applyBlockEdit(page, "h", { kind: "richText", doc: para("x") })).toEqual({ ok: false, problem: expect.stringMatching(/not the kind/) });
    expect(applyBlockEdit(page, "t2", { kind: "richText", doc: para("x") })).toEqual({ ok: false, problem: expect.stringMatching(/shared/) });
    expect(applyBlockEdit(page, "gone", { kind: "heading", text: "x" })).toEqual({ ok: false, problem: expect.stringMatching(/no longer/) });
    expect(applyBlockEdit(page, "h", { kind: "heading", text: "   " })).toEqual({ ok: false, problem: expect.stringMatching(/heading cannot be empty/) });
    expect(applyBlockEdit(page, "t", { kind: "richText", doc: { type: "doc", content: [] } })).toEqual({ ok: false, problem: expect.stringMatching(/text cannot be empty/) });
  });
});
