import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { heatmapsEn as words } from "@/lib/admin-messages/heatmaps.en";
import type { MapLayout } from "@/lib/heat-read";
import type { HeatPageRow, PageHeat } from "@/server/page-heat-read";

import { HeatmapsHub, mapHref, pageName, PageMapView, partLabel, type MapShotView } from "./heatmaps-view";

/** Heatmaps' screens (D656 step 7): the hub off, collecting and ranked, and a page's map in its states. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const BASE = "/admin/shop";
const row = (page: string, views: number, frustratedViews: number): HeatPageRow => ({ page, views, frustratedViews, deadViews: frustratedViews, rageViews: 0, clicks: views * 2, reachedHalf: 0.5 });

describe("the hub", () => {
  it("off with nothing measured: says so, and offers the switch to an owner only", () => {
    const owner = html(h(HeatmapsHub, { base: BASE, on: false, owner: true, pages: [], words }));
    expect(owner).toContain(words.hub.off);
    expect(owner).toContain(`${BASE}/analytics/settings#signals`);
    expect(html(h(HeatmapsHub, { base: BASE, on: false, owner: false, pages: [], words }))).not.toContain("#signals");
  });

  it("collecting: no page has enough views for a map", () => {
    const markup = html(h(HeatmapsHub, { base: BASE, on: true, owner: true, pages: [row("/no", 12, 3)], words }));
    expect(markup).toContain("Collecting. A page's map appears after 30 page views.");
    expect(markup).toContain(words.hub.noneStuck);
    expect(markup).not.toContain(words.hub.seeMap);
  });

  it("ranks pages by how often visitors got stuck, and gives the first one the green button", () => {
    const pages = [row("/no", 400, 20), row("/no/p/mug", 100, 30), row("/no/side", 50, 0), row("/no/few", 10, 9)];
    const markup = html(h(HeatmapsHub, { base: BASE, on: true, owner: true, pages, words }));
    const stuck = markup.slice(markup.indexOf(words.hub.stuckTitle), markup.indexOf(words.hub.mostTitle));
    // 30 % before 5 %; a page without a stuck visitor and one under 30 views are not in the list.
    expect(stuck.indexOf("/p/mug")).toBeLessThan(stuck.indexOf(words.hub.frontPage));
    expect(stuck).not.toContain("/side");
    expect(stuck).not.toContain("/few");
    expect(stuck.split(words.hub.seeMap)).toHaveLength(2);
    expect(stuck).toContain(mapHref(BASE, "/no/p/mug"));
  });

  it("names the front page and other pages by their path under the market", () => {
    expect(pageName("/no", words)).toBe(words.hub.frontPage);
    expect(pageName("/se-en/p/mug", words)).toBe("/p/mug");
  });
});

const LAYOUT: MapLayout = { v: 1, w: 390, h: 2000, fold: 844, anchors: { "@main": [0, 80, 390, 1800], "11111111-1111-4111-8111-111111111111": [0, 1000, 390, 200] } };
const heat = (views: number): PageHeat => ({
  views,
  reach: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, views / 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, views / 2],
  foldSum: views * 400,
  attention: new Array(20).fill(0).map((_, i) => (i === 0 ? views * 3000 : 0)),
  attHeightSum: views * 2000,
  clicks: 10,
  deadClicks: 2,
  rageClicks: 1,
  deadViews: 2,
  rageViews: 1,
  frustratedViews: 3,
  cells: [
    { anchor: "11111111-1111-4111-8111-111111111111", cx: 5, cy: 5, clicks: 8, dead: 2, rage: 1 },
    { anchor: "gone-part", cx: 0, cy: 0, clicks: 2, dead: 0, rage: 0 },
  ],
});
const shot = (over: Partial<MapShotView> = {}): MapShotView => ({ status: "done", picture: "https://files.example/p.jpg", width: 390, height: 2000, layout: LAYOUT, problem: null, shotAt: "2026-11-16T10:00:00Z", ...over });
const map = (over: Partial<Parameters<typeof PageMapView>[0]> = {}) =>
  html(
    h(PageMapView, {
      base: BASE,
      page: "/no",
      view: "click",
      device: "mobile",
      days: 30,
      devices: { mobile: 100, tablet: 0, desktop: 20 },
      heat: heat(100),
      shot: shot(),
      period: { from: "2026-10-18", to: "2026-11-17" },
      newPicture: null,
      refresher: null,
      words,
      locale: "en-GB",
      ...over,
    }),
  );

describe("a page's map", () => {
  it("draws the picture and the parts clicked most, with what is not on the picture in the fold", () => {
    const markup = map();
    expect(markup).toContain('src="https://files.example/p.jpg"');
    expect(markup).toContain(words.map.partsTitle);
    expect(markup).toContain("A part 50 % down the page");
    expect(markup).toContain("2 clicks were on parts that are not in this picture.");
    expect(markup).toContain('aria-current="true"');
  });

  it("says when there are too few views, when the picture is being taken and when it failed", () => {
    expect(map({ heat: heat(12) })).toContain("This page has 12 page views on this device in this period. Its map appears at 30.");
    expect(map({ shot: shot({ status: "taking", picture: null }) })).toContain(words.map.taking);
    expect(map({ shot: shot({ status: "failed", picture: null, problem: "The store is private, so its pages cannot be photographed." }) })).toContain("The store is private");
  });

  it("shows scroll depth and attention as tables too, and offers 365 days only for them", () => {
    const scroll = map({ view: "scroll" });
    expect(scroll).toContain(words.map.reachTitle);
    expect(scroll).toContain("50 % of the page");
    expect(scroll).toContain("365 days");
    expect(map({ view: "click" })).not.toContain("365 days");
    expect(map({ view: "look" })).toContain("3.0 s");
  });

  it("labels landmarks and cards in words", () => {
    expect(partLabel("@header", null, words)).toBe("Header");
    expect(partLabel("@main", null, words)).toBe(words.map.parts.elsewhere);
    expect(partLabel("@card:0:2", null, words)).toBe("Product card 3");
  });
});
