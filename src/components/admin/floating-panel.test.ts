import { describe, expect, it } from "vitest";

import { PANEL_MIN, clampRect, defaultRect, resizeRect } from "./floating-panel";

/** The settings panel (D182) is moved and resized by the editor, and kept where it can be reached. */

const view = { w: 1280, h: 800 };

describe("where the panel is", () => {
  it("opens centred, as wide as a dialog was, and narrower than a small window", () => {
    expect(defaultRect(view, false)).toMatchObject({ w: 512, h: null, x: 384 });
    expect(defaultRect(view, true).w).toBe(768);
    expect(defaultRect({ w: 400, h: 700 }, true).w).toBe(368);
    expect(defaultRect({ w: 340, h: 700 }, true).w).toBe(PANEL_MIN.w);
    expect(defaultRect({ w: 360, h: 700 }, true).x).toBe(0);
  });

  it("is kept in the window with its title bar reachable", () => {
    expect(clampRect({ x: -2000, y: -50, w: 500, h: 400 }, view)).toEqual({ x: 96 - 500, y: 0, w: 500, h: 400 });
    expect(clampRect({ x: 5000, y: 5000, w: 500, h: 400 }, view)).toEqual({ x: 1280 - 96, y: 800 - 48, w: 500, h: 400 });
    expect(clampRect({ x: 10, y: 10, w: 9999, h: 9999 }, view)).toMatchObject({ w: 1280, h: 800 });
    expect(clampRect({ x: 10, y: 10, w: 10, h: 10 }, view)).toMatchObject({ w: PANEL_MIN.w, h: PANEL_MIN.h });
    // A height of its own is only there once the editor gave it one.
    expect(clampRect({ x: 10, y: 10, w: 500, h: null }, view).h).toBeNull();
  });
});

describe("resizing from an edge or a corner", () => {
  const start = { x: 200, y: 100, w: 500, h: 400 };

  it("moves the edge dragged and keeps the opposite one where it is", () => {
    expect(resizeRect(start, "e", 100, 0, view)).toEqual({ x: 200, y: 100, w: 600, h: 400 });
    expect(resizeRect(start, "s", 0, 50, view)).toEqual({ x: 200, y: 100, w: 500, h: 450 });
    expect(resizeRect(start, "w", -80, 0, view)).toEqual({ x: 120, y: 100, w: 580, h: 400 });
    expect(resizeRect(start, "n", 0, -60, view)).toEqual({ x: 200, y: 40, w: 500, h: 460 });
    expect(resizeRect(start, "se", 10, 20, view)).toEqual({ x: 200, y: 100, w: 510, h: 420 });
    expect(resizeRect(start, "nw", -10, -20, view)).toEqual({ x: 190, y: 80, w: 510, h: 420 });
  });

  it("stops at the least size and at the window's edge", () => {
    expect(resizeRect(start, "e", -1000, 0, view).w).toBe(PANEL_MIN.w);
    expect(resizeRect(start, "w", 1000, 0, view)).toMatchObject({ w: PANEL_MIN.w, x: 700 - PANEL_MIN.w });
    expect(resizeRect(start, "e", 5000, 0, view).w).toBe(view.w - start.x);
    expect(resizeRect(start, "s", 0, 5000, view).h).toBe(view.h - start.y);
    expect(resizeRect(start, "n", 0, -5000, view)).toMatchObject({ y: 0, h: 500 });
  });
});
