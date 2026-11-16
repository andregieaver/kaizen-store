/**
 * The AI manager's heatmap tools, their pure parts (D656 step 14, `docs/heatmaps-and-recordings.md`): the figures the Heatmaps pages
 * show, written out in words by code, so the model repeats them and never makes one. A figure below its minimum volume is named as such.
 * No tool reads recordings: they never go to a model (section 4 of the plan).
 */

import { fillWords } from "./admin-fill";
import { heatmapsEn, type HeatmapsMessages } from "./admin-messages/heatmaps.en";
import { formatCount, formatNumber, formatPercent } from "./analytics-core";
import { attentionSeconds, foldPercent, frustrationRank, reachedShares, type CellTotal, type MapLayout } from "./heat-read";
import { MIN_MAP_VIEWS, MIN_VERSION_VIEWS } from "./page-heat";

/** A part's words: a landmark, a product card, or where on the page it sits (the map's table and the tools say the same). */
export function partLabel(anchor: string, layout: MapLayout | null, words: HeatmapsMessages = heatmapsEn): string {
  const p = words.map.parts;
  if (anchor === "@header") return p.header;
  if (anchor === "@footer") return p.footer;
  if (anchor === "@main" || anchor === "@body") return p.elsewhere;
  const card = /(?:\/c|@card:\d:)(\d+)$/.exec(anchor);
  if (card) return fillWords(p.card, { n: Number(card[1]) + 1 });
  const box = layout?.anchors[anchor];
  return fillWords(p.part, { p: box && layout && layout.h > 0 ? Math.round((box[1] / layout.h) * 100) : "?" });
}

export type PartTotal = { anchor: string; clicks: number; dead: number; rage: number };

/** Clicks per part of the page, most clicked first, at most `limit`. */
export function partTotals(cells: readonly (CellTotal & { dead: number; rage: number })[], limit: number): PartTotal[] {
  const byPart = new Map<string, PartTotal>();
  for (const c of cells) {
    const t = byPart.get(c.anchor) ?? { anchor: c.anchor, clicks: 0, dead: 0, rage: 0 };
    byPart.set(c.anchor, { anchor: c.anchor, clicks: t.clicks + c.clicks, dead: t.dead + c.dead, rage: t.rage + c.rage });
  }
  return [...byPart.values()].sort((a, b) => b.clicks - a.clicks || a.anchor.localeCompare(b.anchor)).slice(0, limit);
}

export type PageFiguresInput = {
  views: number;
  reach: readonly number[];
  foldSum: number;
  attention: readonly number[];
  cells: readonly (CellTotal & { dead: number; rage: number })[];
  layout: MapLayout | null;
};

/** One page's map in words: how far people got, where they looked, and the parts clicked most; nothing below `MIN_MAP_VIEWS` page views. */
export function pageFigures(heat: PageFiguresInput, words: HeatmapsMessages = heatmapsEn) {
  if (heat.views < MIN_MAP_VIEWS) {
    return { page_views: heat.views, figures: `not enough page views yet (${formatCount(heat.views)} of ${MIN_MAP_VIEWS}): no figure is given` };
  }
  const shares = reachedShares(heat.reach);
  const fold = foldPercent(heat.foldSum, heat.views);
  const seconds = attentionSeconds(heat.attention, heat.views) ?? [];
  return {
    page_views: heat.views,
    reached: Object.fromEntries([25, 50, 75, 100].map((p) => [`${p} % of the page`, `${formatPercent(shares[p / 5] ?? 0)} of page views`])),
    fold: fold === null ? null : `the first screen shows ${formatNumber(fold, 0)} % of the page`,
    attention: seconds
      .map((s, i) => ({ part: fillWords(words.map.band, { from: i * 5, to: i * 5 + 5 }), seconds: s }))
      .filter((b) => b.seconds > 0)
      .map((b) => ({ part: b.part, seconds_per_page_view: formatNumber(b.seconds, 1) })),
    parts_clicked_most: partTotals(heat.cells, 8).map((p) => ({
      part: partLabel(p.anchor, heat.layout, words),
      clicks: formatCount(p.clicks),
      dead_clicks: formatCount(p.dead),
      rage_clicks: formatCount(p.rage),
    })),
  };
}

export type VersionFigure = { name: string; views: number; reachedHalf: number; rageShare: number; deadShare: number };

/** An A/B test's behaviour per version in words; a version below `MIN_VERSION_VIEWS` page views says so instead. */
export function versionFigures(rows: readonly VersionFigure[]) {
  return rows.map((r) =>
    r.views < MIN_VERSION_VIEWS
      ? { version: r.name, page_views: formatCount(r.views), figures: `too few page views yet (${formatCount(r.views)} of ${MIN_VERSION_VIEWS})` }
      : {
          version: r.name,
          page_views: formatCount(r.views),
          reached_half_the_page: formatPercent(r.reachedHalf),
          page_views_with_rage_clicks: formatPercent(r.rageShare),
          page_views_with_dead_clicks: formatPercent(r.deadShare),
        },
  );
}

export type PageRowInput = { page: string; views: number; frustratedViews: number; reachedHalf: number };

/** The hub in words: the pages where visitors get stuck (from `MIN_MAP_VIEWS` page views), then the most viewed. */
export function hubFigures(rows: readonly PageRowInput[], words: HeatmapsMessages = heatmapsEn) {
  const name = (page: string) => {
    const rest = page.replace(/^\/[a-z0-9-]+/, "");
    return rest === "" ? words.hub.frontPage : rest;
  };
  const line = (r: PageRowInput) => ({
    page: r.page,
    name: name(r.page),
    page_views: formatCount(r.views),
    page_views_with_dead_or_rage_clicks: formatPercent(r.views > 0 ? r.frustratedViews / r.views : 0),
    reached_half_the_page: formatPercent(r.reachedHalf),
  });
  const measured = rows.filter((r) => r.views >= MIN_MAP_VIEWS);
  return {
    where_visitors_get_stuck: frustrationRank(measured, MIN_MAP_VIEWS)
      .filter((r) => r.frustratedViews > 0)
      .slice(0, 5)
      .map(line),
    most_viewed: measured.slice(0, 10).map(line),
    not_enough_yet: rows.length - measured.length,
  };
}
