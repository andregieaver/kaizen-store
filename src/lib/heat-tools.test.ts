import { describe, expect, it } from "vitest";

import { hubFigures, pageFigures, partLabel, partTotals, versionFigures } from "./heat-tools";
import { HEAT_TOOL_WORDS } from "./heat-labels";
import type { MapLayout } from "./heat-read";

/** The AI manager's heatmap figures in words (D656 step 14): what the pages show, nothing below its minimum, nothing made up. */

const layout: MapLayout = { v: 1, w: 390, h: 2000, fold: 844, anchors: { "kz-hero": [0, 0, 390, 600], "kz-faq": [0, 1000, 390, 400] } };

describe("the heatmap tools' figures (D656)", () => {
  it("names parts by where they sit, and sums a part's cells", () => {
    expect(partLabel("@header", null, HEAT_TOOL_WORDS)).toBe("Header");
    expect(partLabel("kz-faq", layout, HEAT_TOOL_WORDS)).toBe("A part 50 % down the page");
    expect(partLabel("@card:0:4", null, HEAT_TOOL_WORDS)).toBe("Product card 5");
    const cells = [
      { anchor: "kz-faq", cx: 1, cy: 1, clicks: 4, dead: 2, rage: 0 },
      { anchor: "kz-faq", cx: 2, cy: 1, clicks: 3, dead: 0, rage: 1 },
      { anchor: "kz-hero", cx: 5, cy: 5, clicks: 5, dead: 0, rage: 0 },
    ];
    expect(partTotals(cells, 1)).toEqual([{ anchor: "kz-faq", clicks: 7, dead: 2, rage: 1 }]);
  });

  it("gives a page no figure below 30 page views", () => {
    const out = pageFigures({ views: 29, reach: [], foldSum: 0, attention: [], cells: [], layout: null }, HEAT_TOOL_WORDS);
    expect(out).toEqual({ page_views: 29, figures: "not enough page views yet (29 of 30): no figure is given" });
  });

  it("writes a page's reach, fold, attention and parts", () => {
    const reach = new Array<number>(21).fill(0);
    reach[20] = 20;
    reach[10] = 20;
    reach[2] = 60;
    const attention = new Array<number>(20).fill(0);
    attention[0] = 100 * 4500;
    const out = pageFigures({ views: 100, reach, foldSum: 100 * 420, attention, cells: [{ anchor: "kz-hero", cx: 1, cy: 1, clicks: 12, dead: 3, rage: 1 }], layout }, HEAT_TOOL_WORDS) as {
      reached: Record<string, string>;
      fold: string;
      attention: { part: string; seconds_per_page_view: string }[];
      parts_clicked_most: { part: string; dead_clicks: string }[];
    };
    expect(out.reached["50 % of the page"]).toMatch(/^40(\.0)? % of page views$/);
    expect(out.reached["100 % of the page"]).toMatch(/^20(\.0)? % of page views$/);
    expect(out.fold).toBe("the first screen shows 42 % of the page");
    expect(out.attention).toEqual([{ part: "0–5 % down", seconds_per_page_view: "4.5" }]);
    expect(out.parts_clicked_most).toEqual([{ part: "A part 0 % down the page", clicks: "12", dead_clicks: "3", rage_clicks: "1" }]);
  });

  it("ranks the pages where visitors get stuck from 30 page views, and counts those not there yet", () => {
    const out = hubFigures([
      { page: "/no", views: 500, frustratedViews: 25, reachedHalf: 0.5 },
      { page: "/no/p/mug", views: 40, frustratedViews: 20, reachedHalf: 0.3 },
      { page: "/no/p/new", views: 10, frustratedViews: 9, reachedHalf: 0.1 },
      { page: "/no/om-oss", views: 60, frustratedViews: 0, reachedHalf: 0.9 },
    ], HEAT_TOOL_WORDS);
    expect(out.where_visitors_get_stuck.map((p) => p.name)).toEqual(["/p/mug", "Front page"]);
    expect(out.most_viewed).toHaveLength(3);
    expect(out.not_enough_yet).toBe(1);
  });

  it("gives a version no figure below 100 page views", () => {
    expect(versionFigures([{ name: "Version B", views: 99, reachedHalf: 0.5, rageShare: 0.1, deadShare: 0.1 }])).toEqual([
      { version: "Version B", page_views: "99", figures: "too few page views yet (99 of 100)" },
    ]);
    expect(versionFigures([{ name: "Original", views: 2000, reachedHalf: 0.5, rageShare: 0.02, deadShare: 0.05 }])[0]).toMatchObject({ version: "Original", page_views: expect.stringMatching(/^2\D?000$/) });
  });
});
