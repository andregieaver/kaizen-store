import { describe, expect, it } from "vitest";

import { composite, gradientStart, hex, opaque } from "./header-color";

const white = { r: 255, g: 255, b: 255, a: 1 };

describe("the browser's colour from the header", () => {
  it("is an opaque header's own colour", () => {
    expect(hex(composite([{ r: 17, g: 34, b: 51, a: 1 }, { r: 200, g: 0, b: 0, a: 1 }], white))).toBe("#112233");
  });

  it("mixes a see-through header with what lies under it", () => {
    // bg-background/95 over a black hero row.
    expect(composite([{ r: 255, g: 255, b: 255, a: 0.95 }, { r: 0, g: 0, b: 0, a: 1 }], white)).toEqual({ r: 242, g: 242, b: 242, a: 1 });
  });

  it("falls back to the page's colour under a header with none", () => {
    expect(hex(composite([], { r: 16, g: 16, b: 16, a: 1 }))).toBe("#101010");
    expect(hex(composite([{ r: 0, g: 0, b: 0, a: 0 }], white))).toBe("#ffffff");
  });

  it("knows an opaque layer", () => {
    expect(opaque({ r: 0, g: 0, b: 0, a: 1 })).toBe(true);
    expect(opaque({ r: 0, g: 0, b: 0, a: 0.95 })).toBe(false);
  });

  it("takes a gradient's first colour, never a picture's", () => {
    expect(gradientStart("linear-gradient(rgb(10, 20, 30), rgba(0, 0, 0, 0.5))")).toBe("rgb(10, 20, 30)");
    expect(gradientStart("linear-gradient(to right, oklch(0.5 0.1 200) 0%, #fff 100%)")).toBe("oklch(0.5 0.1 200)");
    expect(gradientStart('url("https://example.com/a.jpg")')).toBeNull();
    expect(gradientStart("none")).toBeNull();
  });
});
