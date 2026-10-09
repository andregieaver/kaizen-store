import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PartBackground } from "@/components/page-parts";

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import { pageInput, type PageRow } from "./page-content";
import { partCss, rowStyle } from "./part-css";
import { WIDTHS, partStyleAt } from "./part-css.testing";

/** A row as a window onto a fixed background, and a footer revealed on scroll (D184). */

const rowOf = (extra: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [] }], ...extra });
const base = { title: "T", slug: "t", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [] };

describe("a row's height in per cent of the screen's", () => {
  it("is a least height in vh, by screen size, and nothing where it sets none", () => {
    const row = rowOf({ height: 60, at: { sm: { height: 80 }, md: { height: null } } });
    const css = partCss([row], "site", DEFAULT_BREAKPOINTS);
    const classes = rowStyle(row).className.split(" ");
    expect(partStyleAt(css, classes, WIDTHS.xl)["min-height"]).toBe("60vh");
    expect(partStyleAt(css, classes, WIDTHS.sm)["min-height"]).toBe("80vh");
    expect(partStyleAt(css, classes, WIDTHS.md)["min-height"]).toBeUndefined();
    const plain = rowOf();
    expect(partStyleAt(partCss([plain], "site", DEFAULT_BREAKPOINTS), rowStyle(plain).className.split(" "), WIDTHS.xl)["min-height"]).toBeUndefined();
  });

  it("is checked when a page is saved, with the fixed background", () => {
    const page = (extra: object) => pageInput.safeParse({ ...base, rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [] }], ...extra }] });
    expect(page({ height: 50, backgroundFixed: true }).success).toBe(true);
    expect(page({ height: 2 }).success).toBe(false);
    expect(page({ height: 500 }).success).toBe(false);
    expect(page({ height: 50.5 }).success).toBe(false);
  });
});

describe("a fixed background", () => {
  const gradient = { type: "gradient", style: "shift", colors: ["#6366f1", "#ec4899"] } as const;
  const picture = { type: "image", image: { url: "https://x.test/a.jpg", width: 100, height: 100 }, overlay: null } as const;
  const html = (background: object, fixed: boolean, motion?: object) =>
    renderToString(createElement(PartBackground, { background: background as never, fixed, motion: motion as never }));

  it("keeps its picture on the screen, clipped to the row's window, and drops effects that would hold it in the row", () => {
    const fixed = html(picture, true, { effect: "parallax" });
    expect(fixed).toContain("fixed");
    expect(fixed).toContain("clip-path:inset(0)");
    expect(fixed).not.toContain("data-fx-layer");
    expect(html(picture, false)).not.toContain("clip-path");
  });

  it("shows the top, middle or bottom of a fixed picture", () => {
    expect(renderToString(createElement(PartBackground, { background: picture as never, fixed: true, align: "top" }))).toContain("object-top");
    expect(renderToString(createElement(PartBackground, { background: picture as never, fixed: true, align: "bottom" }))).toContain("object-bottom");
    const middle = renderToString(createElement(PartBackground, { background: picture as never, fixed: true, align: "middle" }));
    expect(middle).not.toContain("object-top");
    expect(middle).not.toContain("object-bottom");
  });

  it("keeps its gradient's layer fixed in a frame that is no container", () => {
    const fixed = html(gradient, true);
    expect(fixed).toContain("fixed inset-0");
    expect(fixed).toContain("container-type:normal");
    expect(html(gradient, false)).not.toContain("clip-path");
  });
});

describe("a footer revealed on scroll", () => {
  const rows = [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [] }] }];
  it("is kept on a footer and checked when a page is saved", () => {
    const parsed = pageInput.safeParse({ ...base, rows, footerReveal: true });
    expect(parsed.success && parsed.data.footerReveal).toBe(true);
    expect(pageInput.safeParse({ ...base, rows, footerReveal: "yes" }).success).toBe(false);
  });
});
