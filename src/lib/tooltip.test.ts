import { describe, expect, it } from "vitest";

import { TIP_GAP, TIP_MARGIN, hasOwnName, placeTip, tipText } from "./tooltip";

const view = { width: 1000, height: 800 };
const tip = { width: 200, height: 30 };

describe("the admin's tooltips (PSI UX-10)", () => {
  it("go under the element, centred, and above it when there is no room below", () => {
    expect(placeTip({ top: 100, left: 400, width: 40, height: 20 }, tip, view)).toEqual({ top: 120 + TIP_GAP, left: 320, side: "below" });
    expect(placeTip({ top: 760, left: 400, width: 40, height: 20 }, tip, view)).toEqual({ top: 760 - TIP_GAP - 30, left: 320, side: "above" });
  });

  it("never pass the window's edges", () => {
    expect(placeTip({ top: 100, left: 0, width: 20, height: 20 }, tip, view).left).toBe(TIP_MARGIN);
    expect(placeTip({ top: 100, left: 990, width: 10, height: 20 }, tip, view).left).toBe(view.width - TIP_MARGIN - tip.width);
  });

  it("know when the title was the element's only name", () => {
    const el = (attrs: Record<string, string>, text = "") => ({ getAttribute: (n: string) => attrs[n] ?? null, textContent: text });
    expect(hasOwnName(el({}))).toBe(false);
    expect(hasOwnName(el({}, "  "))).toBe(false);
    expect(hasOwnName(el({ "aria-label": "Remove row 2" }))).toBe(true);
    expect(hasOwnName(el({ "aria-labelledby": "x" }))).toBe(true);
    expect(hasOwnName(el({}, "Save"))).toBe(true);
  });

  it("show a title's words on one line, and nothing for an empty one", () => {
    expect(tipText("  Drag to\n  move  ")).toBe("Drag to move");
    expect(tipText("")).toBeNull();
    expect(tipText(null)).toBeNull();
  });
});
