import { describe, expect, it } from "vitest";

import { fontAxes, trimRange, type FontAxis } from "./font-axes";
import { installedWeightRange } from "./fonts";

/** A font with only a table directory and an `fvar` table holding `axes`, as a font file lays them out. */
function fontWith(axes: FontAxis[], { otherTables = 0 } = {}): Uint8Array {
  const tables = otherTables + 1;
  const fvarAt = 12 + tables * 16;
  const bytes = new Uint8Array(fvarAt + 16 + axes.length * 20);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, name: string) => [...name].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables);
  for (let i = 0; i < otherTables; i++) tag(12 + i * 16, "glyf");
  const record = 12 + otherTables * 16;
  tag(record, "fvar");
  view.setUint32(record + 8, fvarAt);
  view.setUint32(record + 12, 16 + axes.length * 20);
  view.setUint16(fvarAt, 1);
  view.setUint16(fvarAt + 4, 16);
  view.setUint16(fvarAt + 8, axes.length);
  view.setUint16(fvarAt + 10, 20);
  axes.forEach((axis, a) => {
    const at = fvarAt + 16 + a * 20;
    tag(at, axis.tag);
    view.setInt32(at + 4, axis.min * 65536);
    view.setInt32(at + 8, axis.default * 65536);
    view.setInt32(at + 12, axis.max * 65536);
  });
  return bytes;
}

const wght = (min: number, def: number, max: number): FontAxis => ({ tag: "wght", min, default: def, max });

describe("a font's variation axes (D59)", () => {
  it("reads every axis from the fvar table, wherever it is in the directory", () => {
    const axes = [wght(100, 400, 900), { tag: "opsz", min: 14, default: 14, max: 32.5 }];
    expect(fontAxes(fontWith(axes))).toEqual(axes);
    expect(fontAxes(fontWith(axes, { otherTables: 3 }))).toEqual(axes);
  });

  it("finds none in a static font, nor in bytes that are not a font or are cut short", () => {
    expect(fontAxes(fontWith([]))).toEqual([]);
    expect(fontAxes(new TextEncoder().encode("woff2 of something"))).toEqual([]);
    expect(fontAxes(new Uint8Array(0))).toEqual([]);
    const whole = fontWith([wght(100, 400, 900)]);
    expect(fontAxes(whole.subarray(0, whole.length - 4))).toEqual([]);
  });
});

describe("what a variable family is cut to", () => {
  const builder = { min: 400, max: 700 };

  it("keeps the weights it is installed in, and every other axis whole", () => {
    expect(trimRange([wght(100, 100, 900), { tag: "wdth", min: 75, default: 100, max: 125 }], builder)).toEqual(builder);
    // Only the side that reaches past them is cut.
    expect(trimRange([wght(300, 400, 700)], builder)).toEqual(builder);
    expect(trimRange([wght(400, 400, 900)], builder)).toEqual(builder);
    // One installed weight makes a file of that weight alone.
    expect(trimRange([wght(100, 400, 900)], { min: 300, max: 300 })).toEqual({ min: 300, max: 300 });
  });

  it("leaves a file with nothing to cut as it is", () => {
    expect(trimRange([], builder)).toBeNull();
    expect(trimRange([{ tag: "wdth", min: 75, default: 100, max: 125 }], builder)).toBeNull();
    expect(trimRange([wght(400, 400, 700)], builder)).toBeNull();
    expect(trimRange([wght(500, 500, 600)], builder)).toBeNull();
    // An axis that misses the installed weights is not the file the stylesheet asks for at them: left whole.
    expect(trimRange([wght(800, 800, 900)], builder)).toBeNull();
  });

  it("is the lightest to the heaviest of the family's installed styles, italics included", () => {
    expect(installedWeightRange({ family: "Inter", category: "sans-serif", weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], italics: [100, 400, 700, 900] })).toEqual(builder);
    expect(installedWeightRange({ family: "A", category: "serif", weights: [500, 600], italics: [400] })).toEqual({ min: 400, max: 600 });
    expect(installedWeightRange({ family: "B", category: "display", weights: [100, 900], italics: [] })).toEqual({ min: 100, max: 100 });
  });
});
