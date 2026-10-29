/**
 * The speed report's rules (wave 7 unit B, D336, `docs/analytics.md` "Speed"), pure: what the speed beacon sends, which page kinds are
 * measured, the 75th percentile, Google's ratings and what to fix. No zod and no server module: the beacon imports it.
 */

/** Where the beacon sends a page load's figures. */
export const SPEED_ENDPOINT = "/api/visit/speed";
/** The figures kept of a page load: milliseconds, and the layout shift in thousandths. */
export const SPEED_METRICS = ["lcp", "inp", "cls", "ttfb"] as const;
export type SpeedMetric = (typeof SPEED_METRICS)[number];
/** The kinds of page measured: the address's shape only, never the address. */
export const SPEED_KINDS = ["home", "product", "category", "list", "page"] as const;
export type SpeedKind = (typeof SPEED_KINDS)[number];
export const SPEED_SCREENS = ["phone", "computer"] as const;
export type SpeedScreen = (typeof SPEED_SCREENS)[number];

/** A screen narrower than this (CSS pixels) is a phone's (the store's Medium screen size starts here by default). */
export const PHONE_BELOW = 768;
/** A figure needs this many page loads before the report gives it. */
export const MIN_SPEED_SAMPLES = 20;
/** The days a figure is worked out over (Google's field data uses 28). */
export const SPEED_DAYS = 28;
/** The page loads a store keeps a store day; the rest of the day's are not kept. */
export const SPEED_SAMPLES_PER_STORE_DAY = 10_000;
/** Samples older than this are deleted by the daily job. */
export const SPEED_KEEP_DAYS = 90;

/** The largest value a browser reports that is kept; anything above or below is not a measurement. */
const LIMITS: Record<SpeedMetric, number> = { lcp: 120_000, inp: 60_000, cls: 50_000, ttfb: 120_000 };

/** One page load's figures as kept: whole milliseconds, layout shift in thousandths; a figure the browser did not report is null. */
export type SpeedFigures = Record<SpeedMetric, number | null>;

/** What the beacon sends. */
export type SpeedBody = { store: string; path: string; screen: SpeedScreen; figures: SpeedFigures };

/** A figure as the browser reports it (the layout shift unitless), as kept: a whole number in range, or null. */
export function keptFigure(metric: SpeedMetric, value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const kept = Math.round(metric === "cls" ? value * 1000 : value);
  return kept <= LIMITS[metric] ? kept : null;
}

/** The body for a page load, or null when nothing was measured. The path is the address as the browser has it, without its query. */
export function speedBody(input: { store: string; path: string; width: number; values: Partial<Record<SpeedMetric, number>> }): string | null {
  const path = input.path.split(/[?#]/, 1)[0].slice(0, 300);
  if (!input.store || !path.startsWith("/")) return null;
  const figures = Object.fromEntries(SPEED_METRICS.map((m) => [m, keptFigure(m, input.values[m])])) as SpeedFigures;
  if (SPEED_METRICS.every((m) => figures[m] === null)) return null;
  const screen: SpeedScreen = input.width > 0 && input.width < PHONE_BELOW ? "phone" : "computer";
  return JSON.stringify({ store: input.store, path, screen, figures } satisfies SpeedBody);
}

/** Why a sent body's figures cannot be kept, or null: each a whole number within what a browser reports, at least one there. */
export function speedProblem(figures: Record<string, unknown>): string | null {
  let any = false;
  for (const m of SPEED_METRICS) {
    const v = figures[m];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > LIMITS[m]) return `${m} is not a measurement`;
    any = true;
  }
  return any ? null : "nothing was measured";
}

/**
 * The kind of page a visit's landing path is (`placeOfPath().landing`: `/no`, `/no/p/{handle}`, `/no/category/{slug}`, …), or null for
 * one that is not measured (the country chooser, the pay routes, working pages, anything else).
 */
export function speedKind(landing: string): SpeedKind | null {
  const segments = landing.split("/").filter(Boolean);
  if (segments.length === 0 || landing === "(other)") return null;
  if (segments.length === 1) return "home";
  const [, first] = segments;
  if (first === "p" && segments.length === 3) return "product";
  if ((first === "category" || first === "tag") && segments.length === 3) return "category";
  if (segments.length === 2 && (first === "products" || first === "search" || first === "blog")) return "list";
  if (first === "cart" || first === "checkout") return null;
  if (segments.length === 2 || (first === "blog" && segments.length === 3)) return "page";
  return null;
}

/** The 75th percentile by nearest rank (the value three in four page loads were at or under), or null for none. */
export function percentile75(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.75 * sorted.length) - 1)];
}

export type SpeedRating = "good" | "improve" | "poor";

/** Google's thresholds, as kept (milliseconds; layout shift in thousandths): up to the first is good, above the second poor. */
export const SPEED_THRESHOLDS: Record<SpeedMetric, readonly [number, number]> = { lcp: [2500, 4000], inp: [200, 500], cls: [100, 250], ttfb: [800, 1800] };

export function rateMetric(metric: SpeedMetric, value: number): SpeedRating {
  const [good, poor] = SPEED_THRESHOLDS[metric];
  return value <= good ? "good" : value > poor ? "poor" : "improve";
}

/** One figure of the report: the 75th percentile and its rating, or how many page loads there are when too few. */
export type SpeedCell = { metric: SpeedMetric; samples: number } & ({ value: number; rating: SpeedRating } | { value: null; rating: null });

export type SpeedRow = { kind: SpeedKind; screen: SpeedScreen; loads: number; cells: SpeedCell[] };

/** A kind's and screen's figures from its samples (each a page load's figures). */
export function speedRow(kind: SpeedKind, screen: SpeedScreen, samples: readonly SpeedFigures[]): SpeedRow {
  const cells = SPEED_METRICS.map((metric): SpeedCell => {
    const values = samples.map((s) => s[metric]).filter((v): v is number => v !== null);
    const value = values.length >= MIN_SPEED_SAMPLES ? percentile75(values) : null;
    return value === null ? { metric, samples: values.length, value: null, rating: null } : { metric, samples: values.length, value, rating: rateMetric(metric, value) };
  });
  return { kind, screen, loads: samples.length, cells };
}

/** The report's rows from a store's samples: every kind and screen with at least one page load, phones first. */
export function speedRows(samples: readonly (SpeedFigures & { kind: SpeedKind; screen: SpeedScreen })[]): SpeedRow[] {
  const rows: SpeedRow[] = [];
  for (const screen of ["phone", "computer"] as const) {
    for (const kind of SPEED_KINDS) {
      const of = samples.filter((s) => s.kind === kind && s.screen === screen);
      if (of.length > 0) rows.push(speedRow(kind, screen, of));
    }
  }
  return rows;
}

/** The metrics to look at first: those rated poor anywhere, then those that need improvement, each once, in the metrics' order. */
export function metricsToFix(rows: readonly SpeedRow[]): { metric: SpeedMetric; rating: Exclude<SpeedRating, "good"> }[] {
  const worst = new Map<SpeedMetric, Exclude<SpeedRating, "good">>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.rating === "poor") worst.set(cell.metric, "poor");
      else if (cell.rating === "improve" && !worst.has(cell.metric)) worst.set(cell.metric, "improve");
    }
  }
  return SPEED_METRICS.filter((m) => worst.has(m)).map((metric) => ({ metric, rating: worst.get(metric)! })).sort((a, b) => (a.rating === b.rating ? 0 : a.rating === "poor" ? -1 : 1));
}

/** A figure as a person reads it: seconds with two decimals for times above a second, else milliseconds; the layout shift unitless. */
export function speedValueText(metric: SpeedMetric, value: number, locale: string): string {
  if (metric === "cls") return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 1000);
  if (value >= 1000) return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 1000)} s`;
  return `${new Intl.NumberFormat(locale).format(value)} ms`;
}

// ---------------------------------------------------------------------------
// Kaizena Flow's own site and the admin (wave 11 unit K, D390)
// ---------------------------------------------------------------------------

/** Where the beacon sends a page load of Kaizena Flow's own site or of the admin. */
export const OWN_SPEED_ENDPOINT = "/api/visit/speed/own";
/** The two sites of Kaizena Flow's own measured: its public pages and the admin. */
export const OWN_SPEED_SITES = ["platform", "admin"] as const;
export type OwnSpeedSite = (typeof OWN_SPEED_SITES)[number];

const LANGUAGE_PREFIX = /^\/no(?=\/|$)/;
/** Admin lists of records, at `/admin/{store}/{list}` or `/admin/platform/{list}`. */
const ADMIN_LISTS = new Set(["orders", "products", "customers", "stores", "requests", "pages", "articles", "media", "invoices", "returns", "support"]);

/**
 * The kind of a page of Kaizena Flow's own site or of the admin, by the address's shape only (never kept): for the site, its front page,
 * a theme's page (`product`), the theme store and the blog (`list`) and any other page; for the admin, an overview (`/admin`,
 * `/admin/{store}`, `/admin/platform`: `home`), a list of records (`list`), a product's or page's editor (`product`) and any other page.
 * Sign-in and the API are not measured.
 */
export function ownSpeedKind(site: OwnSpeedSite, path: string): SpeedKind | null {
  const clean = path.split(/[?#]/, 1)[0];
  if (!clean.startsWith("/")) return null;
  if (site === "platform") {
    if (clean.startsWith("/admin") || clean.startsWith("/api") || clean.startsWith("/s/")) return null;
    const segments = clean.replace(LANGUAGE_PREFIX, "").split("/").filter(Boolean);
    if (segments.length === 0) return "home";
    if (segments[0] === "themes" && segments.length === 2) return "product";
    if ((segments[0] === "themes" || segments[0] === "blog") && segments.length === 1) return "list";
    return "page";
  }
  const segments = clean.split("/").filter(Boolean);
  if (segments[0] !== "admin") return null;
  if (segments[1] === "sign-in" || segments[1] === "forgot-password" || segments[1] === "oauth") return null;
  if (segments.length <= 2) return "home";
  if (segments.length === 3 && ADMIN_LISTS.has(segments[2])) return "list";
  if (segments.length === 4 && (segments[2] === "products" || segments[2] === "pages" || segments[2] === "articles")) return "product";
  return "page";
}
