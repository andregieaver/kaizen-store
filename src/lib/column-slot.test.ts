import { describe, expect, it } from "vitest";

import { columnSlotAt, isStacked, slotAnchor, type Box, type SlotLine } from "./column-slot";

/** Where a dropped column goes among a row's columns, from where the pointer is (D189). */

const box = (left: number, right: number, top = 0, bottom = 50): Box => ({ left, right, top, bottom });

/** Three columns of 300 px with 32 px between them, from x = 100. */
const three: SlotLine = { ids: ["a", "b", "c"], boxes: [box(100, 400), box(432, 732), box(764, 1064)] };

describe("the slot a pointer points at", () => {
  it("counts the columns whose middle is before the pointer, so the gap between two is a place of its own", () => {
    const at = (x: number) => columnSlotAt([three], { x, y: 25 });
    expect(at(50)).toEqual({ line: 0, index: 0 });
    // Over a column: before it in its left half, after it in its right.
    expect(at(200)).toEqual({ line: 0, index: 0 });
    expect(at(300)).toEqual({ line: 0, index: 1 });
    // In the gaps between the columns, which belong to none of them.
    expect(at(416)).toEqual({ line: 0, index: 1 });
    expect(at(748)).toEqual({ line: 0, index: 2 });
    expect(at(1200)).toEqual({ line: 0, index: 3 });
  });

  it("does not care how far above or below the columns the pointer is, as the room around a row counts too", () => {
    expect(columnSlotAt([three], { x: 416, y: -30 })).toEqual({ line: 0, index: 1 });
    expect(columnSlotAt([three], { x: 748, y: 400 })).toEqual({ line: 0, index: 2 });
  });

  it("takes the line the pointer is in, the nearest where it is between two", () => {
    const lines: SlotLine[] = [
      { ids: ["a", "b"], boxes: [box(100, 400, 0, 50), box(432, 732, 0, 50)] },
      { ids: ["c", "d", "e"], boxes: [box(100, 300, 82, 132), box(332, 532, 82, 132), box(564, 764, 82, 132)] },
    ];
    expect(columnSlotAt(lines, { x: 416, y: 25 })).toEqual({ line: 0, index: 1 });
    expect(columnSlotAt(lines, { x: 316, y: 100 })).toEqual({ line: 1, index: 1 });
    // The room between the lines goes to the nearer; exactly between, to the first.
    expect(columnSlotAt(lines, { x: 316, y: 60 })).toEqual({ line: 0, index: 1 });
    expect(columnSlotAt(lines, { x: 316, y: 70 })).toEqual({ line: 1, index: 1 });
    expect(columnSlotAt(lines, { x: 316, y: 66 })).toEqual({ line: 0, index: 1 });
    // Above the first and below the last.
    expect(columnSlotAt(lines, { x: 800, y: -40 })).toEqual({ line: 0, index: 2 });
    expect(columnSlotAt(lines, { x: 800, y: 300 })).toEqual({ line: 1, index: 3 });
  });

  it("counts from above where the columns are one under another, as in a row that stacks", () => {
    const stacked: SlotLine = { ids: ["a", "b", "c"], boxes: [box(100, 400, 0, 50), box(100, 400, 82, 132), box(100, 400, 164, 214)] };
    expect(isStacked(stacked.boxes)).toBe(true);
    expect(columnSlotAt([stacked], { x: 250, y: 10 })).toEqual({ line: 0, index: 0 });
    expect(columnSlotAt([stacked], { x: 250, y: 66 })).toEqual({ line: 0, index: 1 });
    expect(columnSlotAt([stacked], { x: 250, y: 148 })).toEqual({ line: 0, index: 2 });
    expect(columnSlotAt([stacked], { x: 250, y: 400 })).toEqual({ line: 0, index: 3 });
  });

  it("knows columns side by side, also where they are not as tall as each other", () => {
    expect(isStacked(three.boxes)).toBe(false);
    expect(isStacked([box(100, 400, 40, 50), box(432, 732, 0, 50)])).toBe(false);
    expect(isStacked([box(100, 400)])).toBe(false);
  });

  it("has no slot where there is nothing to point among", () => {
    expect(columnSlotAt([], { x: 0, y: 0 })).toBeNull();
    expect(columnSlotAt([{ ids: [], boxes: [] }], { x: 0, y: 0 })).toBeNull();
  });
});

describe("the column an indicator is drawn on", () => {
  it("is the one the slot is before, or the last, after it, for the end of the line", () => {
    expect(slotAnchor(three, 0)).toEqual({ id: "a", after: false });
    expect(slotAnchor(three, 2)).toEqual({ id: "c", after: false });
    expect(slotAnchor(three, 3)).toEqual({ id: "c", after: true });
    expect(slotAnchor(undefined, 0)).toBeNull();
    expect(slotAnchor({ ids: [], boxes: [] }, 0)).toBeNull();
  });
});
