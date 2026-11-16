import { describe, expect, it } from "vitest";
import { canPaste, copyStyle, hasOwnStyle, pasteStylePatch, readCopiedStyle, styleKindOf } from "./style-copy";
import type { ButtonBlock, PageRow } from "./page-content";

const button = (patch: Partial<ButtonBlock> = {}): ButtonBlock => ({ id: "b1", type: "button", label: "Shop", href: "/shop", ...patch });

describe("copy style (D631)", () => {
  it("names a part's kind by what it is", () => {
    expect(styleKindOf({ kind: "block" }, { type: "button" })).toBe("block:button");
    expect(styleKindOf({ kind: "row" }, {})).toBe("row");
    expect(styleKindOf({ kind: "column" }, {})).toBe("column");
  });

  it("copies a button's look and leaves what it says, where it leads and how it moves", () => {
    const source = button({
      variant: "outline",
      shape: "pill",
      fill: "#ff0000",
      radius: 8,
      style: { padding: { top: 4, right: 8, bottom: 4, left: 8 } },
      className: "cta",
      htmlId: "buy",
      newTab: true,
      motion: { entrance: { effect: "fade" } } as ButtonBlock["motion"],
      at: { sm: { align: "center", order: 2 } },
    });
    const copied = copyStyle("block:button", source);
    expect(copied.values).toEqual({ variant: "outline", shape: "pill", fill: "#ff0000", radius: 8, style: source.style, className: "cta" });
    expect(copied.at).toEqual({ sm: { align: "center" } });
    expect(JSON.stringify(copied)).not.toMatch(/Shop|\/shop|buy|fade|newTab/);
  });

  it("lays the copy on a part: its own design goes, its content and layout at a size stay", () => {
    const copied = copyStyle("block:button", button({ variant: "outline", at: { md: { align: "right" } } }));
    const target = button({ id: "b2", label: "Read", size: "lg", fill: "#00ff00", at: { md: { align: "left", width: 50 }, sm: { radius: 2 } } });
    const patch = pasteStylePatch(target, copied);
    const next = { ...target, ...patch } as ButtonBlock;
    expect(next.variant).toBe("outline");
    expect(next.size).toBeUndefined();
    expect(next.fill).toBeUndefined();
    expect(next.label).toBe("Read");
    expect(next.at).toEqual({ md: { align: "right", width: 50 } });
  });

  it("copies a row's background and section style", () => {
    const row = { id: "r1", type: "row", layout: "1", columns: [], sectionStyle: "dark", background: { type: "color", color: "#000" }, backgroundFixed: true, gap: 40 } as unknown as PageRow;
    const copied = copyStyle("row", row);
    expect(copied.values).toEqual({ sectionStyle: "dark", background: { type: "color", color: "#000" }, backgroundFixed: true });
    expect(hasOwnStyle("row", row)).toBe(true);
    expect(hasOwnStyle("row", { ...row, sectionStyle: undefined, background: undefined, backgroundFixed: undefined } as PageRow)).toBe(false);
  });

  it("pastes only onto the same kind", () => {
    const copied = copyStyle("row", { radius: 4 });
    expect(canPaste(copied, "row")).toBe(true);
    expect(canPaste(copied, "column")).toBe(false);
    expect(canPaste(null, "row")).toBe(false);
  });

  it("does not share the copy's objects with the part", () => {
    const source = button({ style: { margin: { top: 1, right: 1, bottom: 1, left: 1 } } });
    const copied = copyStyle("block:button", source);
    const patch = pasteStylePatch(button(), copied);
    (patch.style as { margin: { top: number } }).margin.top = 99;
    expect(source.style?.margin?.top).toBe(1);
    expect((copied.values.style as { margin: { top: number } }).margin.top).toBe(1);
  });

  it("reads back only a well-formed copy, and only its kind's design settings", () => {
    expect(readCopiedStyle(null)).toBeNull();
    expect(readCopiedStyle({ kind: "other", values: {} })).toBeNull();
    expect(readCopiedStyle({ kind: "row", values: [] })).toBeNull();
    expect(readCopiedStyle({ kind: "block:button", values: { variant: "outline", label: "x", href: "javascript:1" }, at: { sm: { align: "left", width: 10 }, xl: {} } })).toEqual({
      kind: "block:button",
      values: { variant: "outline" },
      at: { sm: { align: "left" } },
    });
  });
});
