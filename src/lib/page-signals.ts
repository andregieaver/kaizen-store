import type { TargetKind } from "./ab-site";
import { fillWords } from "./admin-fill";
import type { HeatmapsMessages } from "./admin-messages/heatmaps.en";
import { formatCount, formatPercent } from "./analytics-core";
import { blogPath } from "./blogs";
import { findPart, testablePart } from "./experiment-parts";
import { PART_ID } from "./heat-anchor";
import type { PageContent } from "./page-content";
import { HEAT_DEVICES, MIN_MAP_VIEWS, type HeatDevice } from "./page-heat";
import { MIN_SPEED_SAMPLES, rateMetric, SPEED_METRICS, speedKind, type SpeedKind, type SpeedMetric, type SpeedRating, type SpeedRow, type SpeedScreen } from "./speed";
import { placeOfPath } from "./visit-record";

/**
 * The *how it performs* strip in the page and product editors (ecosystem plan E2.3, D713), its pure parts: which heat page keys a page,
 * an article or a product has, and the strip's words. Heat totals (D656) keep a page by its address as `placeOfPath().landing` gives it,
 * `/{country}/…` once per market; nothing else mapped a page or a product to those keys. The keys are made by running the storefront's own
 * addresses through `placeOfPath()`, so they are exactly what the heat and recording beacons keep, and only for the pages they measure
 * (`speedKind()`). A store that sells in one country has no country in its addresses (D181), but its keys still carry it: `placeOfPath()`
 * reads `/p/mug` there as `/no/p/mug`, so the keys are the same shape for every store.
 */

/** The strip's period: the last 30 store days, today included (the analytics' default, and the heatmap's). */
export const SIGNAL_DAYS = 30;

/** Places a page can have whose address is fixed (D112): the blog and search pages. The category and tag pages draw many addresses. */
const ROLE_PATHS: Readonly<Record<string, string>> = { blog: "/blog", search: "/search" };
const MANY_ADDRESS_ROLES = new Set(["category", "tag"]);

/** A store's page or article as the storefront addresses it. */
export type SignalPage = {
  type: "page" | "article";
  /** The live address under the market (`om-oss`, `projects/project-a`; an article's slug). */
  slug: string;
  /** It is the store's front page (`stores.front_page_id`), at the market's own address. */
  front?: boolean;
  /** It is the All products page (`stores.products_page_id`), at `/products`. */
  products?: boolean;
  /** The places it is chosen for (`stores.page_roles`). */
  roles?: readonly string[];
  /** An article's blog's address under the market (`blogPath()`, D341): `/blog` for the first (left out), `/blogs/{handle}` for the others. */
  blog?: string | null;
};

/** The paths inside a market a page or article is drawn at, its places first (`""` is the market's front page). */
export function pagePaths(page: SignalPage): string[] {
  if (page.type === "article") return [`${page.blog ?? blogPath({ main: true, handle: "" })}/${page.slug}`];
  const places = [
    ...(page.front ? [""] : []),
    ...(page.products ? ["/products"] : []),
    ...(page.roles ?? []).flatMap((role) => (Object.hasOwn(ROLE_PATHS, role) ? [ROLE_PATHS[role]] : [])),
  ];
  return [...places, `/${page.slug}`];
}

/** A product's path inside a market, as a browser writes it. */
export const productPath = (handle: string): string => `/p/${encodeURIComponent(handle)}`;

/**
 * The heat page keys of `paths` in each of the store's countries (`Market.code`, `NO`), as the beacons keep them, in the order given and
 * each once: only those the heatmaps and speed measure (a nested page, an article of a second blog and the working pages are not).
 */
export function heatKeys(paths: readonly string[], countries: readonly string[]): string[] {
  const codes = [...new Set(countries.map((c) => c.toUpperCase()))];
  const keys = new Set<string>();
  for (const code of codes) {
    for (const path of paths) {
      const place = placeOfPath(`/${code.toLowerCase()}${path}`, "", codes);
      if (place && speedKind(place.landing)) keys.add(place.landing);
    }
  }
  return [...keys];
}

/** The keys and kind of page of what is edited: a page or article, or a product by its handle. */
export function signalPlan(what: SignalPage | { type: "product"; handle: string }, countries: readonly string[]): { keys: string[]; kind: SpeedKind | null } {
  if (what.type === "product") {
    const keys = heatKeys([productPath(what.handle)], countries);
    return { keys, kind: keys.length > 0 ? "product" : null };
  }
  const keys = heatKeys(pagePaths(what), countries);
  // A page chosen for the category or tag pages draws every one of them: no key of its own, but their speed is its.
  if (what.type === "page" && !what.front && !what.products && what.roles?.some((role) => MANY_ADDRESS_ROLES.has(role))) return { keys: [], kind: "category" };
  return { keys, kind: keys.length > 0 ? speedKind(keys[0]) : null };
}

// ---------------------------------------------------------------------------
// Back from a heat key to what draws it: the heatmap's "Edit this part" and "A/B test this part"
// ---------------------------------------------------------------------------

/** What a heat key's address is drawn by: the front page, All products, a page chosen for a place, a page, an article or a product. */
export type KeyPlace =
  | { place: "front" }
  | { place: "products" }
  | { place: "role"; role: "blog" | "search" | "category" | "tag" }
  | { place: "page"; slug: string }
  | { place: "article"; slug: string }
  | { place: "product"; handle: string };

/** The place of a heat key (`/no`, `/no/om-oss`, `/no/p/mug`, as `placeOfPath().landing` keeps them), or null for a key that is none. */
export function placeOfKey(key: string): KeyPlace | null {
  const match = /^\/[a-z]{2}((?:\/[^/]+){0,2})$/u.exec(key);
  if (!match) return null;
  const [first, second] = match[1].split("/").filter(Boolean);
  if (first === undefined) return { place: "front" };
  if (second === undefined) {
    if (first === "products") return { place: "products" };
    if (first === "blog" || first === "search") return { place: "role", role: first };
    return { place: "page", slug: first };
  }
  if (first === "p") return { place: "product", handle: second };
  if (first === "blog") return { place: "article", slug: second };
  if (first === "category" || first === "tag") return { place: "role", role: first };
  return null;
}

/** The page-builder part a click's anchor fell in (D656: its id, or a card inside it, `{id}/c{n}`); null for a landmark or a card in no part. */
export function partOfAnchor(anchor: string): string | null {
  if (anchor.startsWith("@")) return null;
  const id = anchor.replace(/\/c\d{1,2}$/, "");
  return PART_ID.test(id) ? id : null;
}

/** The kind of page an A/B test of a part names (`TargetKind`), when the page can be tested at all. */
export type PartLinkPage = { id: string; editHref: string; content: Pick<PageContent, "rows">; testKind: TargetKind | null };

/**
 * For the parts of a heatmap's table, by anchor: the builder opened on the part (`?part=`), and the "A/B test this" form for it (D148), where
 * the part is one the page's builder has and a test may take (`testablePart()`). `base` is the store's admin address.
 */
export function partLinks(base: string, page: PartLinkPage, anchors: readonly string[], may: { edit: boolean; test: boolean }): Record<string, { edit?: string; test?: string }> {
  const out: Record<string, { edit?: string; test?: string }> = {};
  for (const anchor of anchors) {
    const id = partOfAnchor(anchor);
    const found = id ? findPart(page.content.rows, id) : null;
    if (!id || !found) continue;
    const links: { edit?: string; test?: string } = {};
    if (may.edit) links.edit = `${page.editHref}?${new URLSearchParams({ part: id }).toString()}`;
    if (may.test && page.testKind && testablePart(page.content, { id, kind: found.kind }, page.testKind)) {
      links.test = `${base}/experiments/new?${new URLSearchParams({ page: page.id, kind: found.kind, part: id }).toString()}`;
    }
    if (links.edit || links.test) out[anchor] = links;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The facts the server reads, and the strip's words
// ---------------------------------------------------------------------------

/** Heat totals of a page (D656): page views, those with a dead or rage click, and those that reached half the page. */
export type HeatFigures = { views: number; frustrated: number; reachedHalf: number };

export type SignalFacts = {
  /** What the store measures now (D152, D656). */
  measuring: { visits: boolean; heatmaps: boolean };
  /** A product's page views counted with visit counting; null when nothing was counted in the period (unknown, not 0). */
  productViews: number | null;
  /** Orders from the shop's checkout with the product, from the first counted day; null without counted views. */
  orders: number | null;
  /** Heat totals over every key, per device, and the key seen most; null while heatmaps are off and none were kept. */
  heat: { total: HeatFigures; devices: Record<HeatDevice, HeatFigures>; topKey: string | null } | null;
  /** The speed of its kind of page (D336), per screen; null for a kind that is not measured. */
  speed: { kind: SpeedKind; rows: SpeedRow[] } | null;
  /** The A/B test running on it (D148), if any. */
  test: { id: string; name: string } | null;
  /**
   * For the owner (D656: recordings are theirs alone), the recordings of the period that visited its most viewed key (the list filters by
   * one page), and that key; null for anyone else, or a page with no key.
   */
  recordings: { page: string; count: number } | null;
};

/** One screen's speed row from the 75th percentiles the database worked out (`percentile_disc(0.75)`, the nearest rank) and their counts. */
export function speedRowOf(
  kind: SpeedKind,
  screen: SpeedScreen,
  loads: number,
  figures: Record<SpeedMetric, { n: number; p75: number | null }>,
): SpeedRow {
  return {
    kind,
    screen,
    loads,
    cells: SPEED_METRICS.map((metric) => {
      const { n, p75 } = figures[metric];
      return n >= MIN_SPEED_SAMPLES && p75 !== null ? { metric, samples: n, value: p75, rating: rateMetric(metric, p75) } : { metric, samples: n, value: null, rating: null };
    }),
  };
}

/** How the rows load, at their worst rated figure: poor anywhere is poor, then needs improvement; null while no figure has enough loads. */
export function speedVerdict(rows: readonly SpeedRow[]): SpeedRating | null {
  const ratings = rows.flatMap((row) => row.cells.flatMap((cell) => (cell.rating ? [cell.rating] : [])));
  if (ratings.length === 0) return null;
  return ratings.includes("poor") ? "poor" : ratings.includes("improve") ? "improve" : "good";
}

/** The page views the strip names: a product's counted views first, else its heat totals'. */
export const viewsOf = (facts: SignalFacts): number | null => facts.productViews ?? facts.heat?.total.views ?? null;

const share = (part: number, whole: number) => formatPercent(whole > 0 ? part / whole : 0, 0);

export type StripWords = HeatmapsMessages["strip"];

export type StripText = {
  /** Homer's one line (`Last 30 days: 1 240 views · 8 % met a dead or rage click · loads well`); null when nothing is measured. */
  line: string | null;
  /** What to switch on to measure more, for the owner's link to Analytics settings. */
  switchOn: "both" | "visits" | "heatmaps" | null;
};

/** The strip's words for Homer: one line of what is measured, or what to switch on when nothing is. */
export function stripText(facts: SignalFacts, words: StripWords): StripText {
  const parts: string[] = [];
  const views = viewsOf(facts);
  if (views !== null) parts.push(fillWords(views === 1 ? words.views.one : words.views.many, { n: formatCount(views) }));
  if (facts.productViews && facts.orders !== null) parts.push(fillWords(words.ordered, { p: formatPercent(facts.orders / facts.productViews, 1) }));
  const heat = facts.heat?.total;
  // A share from fewer page views than a map needs says nothing (the heatmaps' own minimum).
  if (heat && heat.views >= MIN_MAP_VIEWS) {
    parts.push(fillWords(words.stuck, { p: share(heat.frustrated, heat.views) }));
    parts.push(fillWords(words.half, { p: share(heat.reachedHalf, heat.views) }));
  }
  const verdict = facts.speed ? speedVerdict(facts.speed.rows) : null;
  if (verdict) parts.push(words.speed[verdict]);
  if (facts.test) parts.push(words.test);
  const visitsOff = !facts.measuring.visits;
  const heatOff = !facts.measuring.heatmaps && facts.heat === null;
  const switchOn = visitsOff && heatOff ? "both" : visitsOff ? "visits" : heatOff ? "heatmaps" : null;
  return { line: parts.length > 0 ? `${words.lead} ${parts.join(" · ")}` : null, switchOn };
}

/** Lisa's figures per device: views and both shares (none below the heatmaps' minimum of page views), for the devices with views. */
export function deviceRows(facts: SignalFacts): { device: HeatDevice; views: string; stuck: string | null; half: string | null }[] {
  const heat = facts.heat;
  if (!heat) return [];
  return HEAT_DEVICES.filter((d) => heat.devices[d].views > 0).map((device) => {
    const f = heat.devices[device];
    const enough = f.views >= MIN_MAP_VIEWS;
    return { device, views: formatCount(f.views), stuck: enough ? share(f.frustrated, f.views) : null, half: enough ? share(f.reachedHalf, f.views) : null };
  });
}

/** The AI manager's first message (written by code from the strip's own words, never a model's), naming the heat key for its tools. */
export function askText(what: "page" | "product", name: string, facts: SignalFacts, words: StripWords): string {
  const line = stripText(facts, words).line ?? words.nothing;
  const key = facts.heat?.topKey;
  return fillWords(words.askMessage, { what: words.what[what], name, line, key: key ? fillWords(words.askKey, { page: key }) : "" });
}
