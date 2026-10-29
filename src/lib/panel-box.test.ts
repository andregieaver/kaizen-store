import { describe, expect, it } from "vitest";

import { BUILDER_PANEL, SITE_PANEL, builderPanelWidth, fitBox, movedBox, readBox, resizedBox, usualSiteBox } from "./panel-box";

const screen = { width: 1440, height: 900 };

describe("the builder's CSS panel width", () => {
  it("starts at its usual width and keeps a dragged one within its limits", () => {
    expect(builderPanelWidth(null, 1440)).toBe(BUILDER_PANEL.usual);
    expect(builderPanelWidth("", 1440)).toBe(BUILDER_PANEL.usual);
    expect(builderPanelWidth("wide", 1440)).toBe(BUILDER_PANEL.usual);
    expect(builderPanelWidth(700.4, 1440)).toBe(700);
    expect(builderPanelWidth("100", 1440)).toBe(BUILDER_PANEL.min);
    expect(builderPanelWidth(5000, 1440)).toBe(BUILDER_PANEL.max);
    // The page keeps its room beside it.
    expect(builderPanelWidth(1000, 1000)).toBe(1000 - BUILDER_PANEL.leave);
  });
});

describe("the live site's CSS panel", () => {
  it("starts at the window's right, top to bottom", () => {
    const box = usualSiteBox(screen);
    expect(box.width).toBe(SITE_PANEL.usualWidth);
    expect(box.x + box.width).toBe(screen.width - 2 * SITE_PANEL.margin);
    expect(box.y).toBe(2 * SITE_PANEL.margin);
  });

  it("moves with the pointer and stays in the window", () => {
    const start = { x: 100, y: 100, width: 400, height: 300 };
    expect(movedBox(start, 50, -20, screen)).toEqual({ x: 150, y: 80, width: 400, height: 300 });
    expect(movedBox(start, -500, -500, screen)).toMatchObject({ x: SITE_PANEL.margin, y: SITE_PANEL.margin });
    expect(movedBox(start, 5000, 5000, screen)).toMatchObject({ x: screen.width - SITE_PANEL.margin - 400, y: screen.height - SITE_PANEL.margin - 300 });
  });

  it("resizes from every edge and corner, keeping the opposite edges still", () => {
    const start = { x: 200, y: 200, width: 400, height: 300 };
    expect(resizedBox(start, "e", 100, 0, screen)).toEqual({ x: 200, y: 200, width: 500, height: 300 });
    expect(resizedBox(start, "s", 0, 50, screen)).toEqual({ x: 200, y: 200, width: 400, height: 350 });
    expect(resizedBox(start, "w", -100, 0, screen)).toEqual({ x: 100, y: 200, width: 500, height: 300 });
    expect(resizedBox(start, "n", 0, -100, screen)).toEqual({ x: 200, y: 100, width: 400, height: 400 });
    expect(resizedBox(start, "nw", 50, 40, screen)).toEqual({ x: 250, y: 240, width: 350, height: 260 });
    expect(resizedBox(start, "se", 20, 30, screen)).toEqual({ x: 200, y: 200, width: 420, height: 330 });
    expect(resizedBox(start, "ne", 10, -10, screen)).toEqual({ x: 200, y: 190, width: 410, height: 310 });
    expect(resizedBox(start, "sw", -10, 10, screen)).toEqual({ x: 190, y: 200, width: 410, height: 310 });
  });

  it("never shrinks below its smallest size nor grows past the window", () => {
    const start = { x: 200, y: 200, width: 400, height: 300 };
    const small = resizedBox(start, "nw", 1000, 1000, screen);
    expect(small).toEqual({ x: 600 - SITE_PANEL.minWidth, y: 500 - SITE_PANEL.minHeight, width: SITE_PANEL.minWidth, height: SITE_PANEL.minHeight });
    const big = resizedBox(start, "se", 5000, 5000, screen);
    expect(big.x + big.width).toBe(screen.width - SITE_PANEL.margin);
    expect(big.y + big.height).toBe(screen.height - SITE_PANEL.margin);
  });

  it("comes back inside a window that got smaller", () => {
    const kept = { x: 1200, y: 600, width: 600, height: 500 };
    const fitted = fitBox(kept, { width: 1024, height: 700 });
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(1024 - SITE_PANEL.margin);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(700 - SITE_PANEL.margin);
    expect(fitted.width).toBe(600);
  });

  it("reads back only a box it kept", () => {
    expect(readBox(JSON.stringify({ x: 1, y: 2, width: 300, height: 400 }))).toEqual({ x: 1, y: 2, width: 300, height: 400 });
    expect(readBox(null)).toBeNull();
    expect(readBox("not json")).toBeNull();
    expect(readBox(JSON.stringify({ x: 1, y: 2, width: "wide", height: 400 }))).toBeNull();
    expect(readBox("null")).toBeNull();
  });
});
