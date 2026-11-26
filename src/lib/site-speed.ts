/**
 * How fast a site is for its visitors (D905, market check M5c, `docs/market-check.md` 7.4), the pure parts: the Chrome UX Report's
 * request and the reading of its answer, Google's thresholds for the three Core Web Vitals, and the finding. The figures are Chrome
 * users' own (field data): the 75th percentile over 28 days. Fetched and kept by `src/server/site-speed.ts`; every rating here, by code.
 */

/** The Chrome UX Report's one address: a request elsewhere is refused. */
export const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
/** A store's sites are measured again once they were tried longer ago than this; one that failed is tried again a day later. */
export const SPEED_CHECK_DAYS = 30;
/** Stores measured in one run of the five-minute dispatcher, and the most sites (its own and its rivals') one store has measured. */
export const SPEED_STORES_PER_RUN = 1;
export const SPEED_SITES_MAX = 25;
/** A measurement older than this makes no finding. */
export const SPEED_FRESH_DAYS = 45;

export const SPEED_METRICS = ["lcp", "inp", "cls"] as const;
export type SpeedMetric = (typeof SPEED_METRICS)[number];
export type SpeedRating = "good" | "needs" | "poor";

/** The three figures as kept: milliseconds for LCP and INP, CLS in thousandths. */
export type SpeedFigures = { lcp: number | null; inp: number | null; cls: number | null };

/** Google's thresholds (web.dev/vitals): good at or under the first, poor over the second. CLS in thousandths. */
export const SPEED_THRESHOLDS: Record<SpeedMetric, readonly [number, number]> = { lcp: [2500, 4000], inp: [200, 500], cls: [100, 250] };

export function speedRating(metric: SpeedMetric, value: number): SpeedRating {
  const [good, poor] = SPEED_THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "needs" : "poor";
}

/** What to ask the Chrome UX Report for one site: a whole origin, or one page (a store at a path of another site). */
export type CruxTarget = { origin: string } | { url: string };

export function cruxRequest(target: CruxTarget, key: string): { url: string; body: string } {
  return {
    url: `${CRUX_ENDPOINT}?key=${encodeURIComponent(key)}`,
    body: JSON.stringify({ ...target, metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"] }),
  };
}

const p75 = (metrics: Record<string, unknown>, name: string): number | null => {
  const raw = (metrics[name] as { percentiles?: { p75?: unknown } } | undefined)?.percentiles?.p75;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * The three figures and the last day they cover from a Chrome UX Report answer, or null when it holds none (a site with too few Chrome
 * visitors is answered 404, never read here).
 */
export function readCrux(body: unknown): (SpeedFigures & { periodEnd: string | null }) | null {
  const record = (body as { record?: { metrics?: unknown; collectionPeriod?: { lastDate?: { year?: number; month?: number; day?: number } } } } | null)?.record;
  if (!record || !record.metrics || typeof record.metrics !== "object") return null;
  const metrics = record.metrics as Record<string, unknown>;
  const lcp = p75(metrics, "largest_contentful_paint");
  const inp = p75(metrics, "interaction_to_next_paint");
  const cls = p75(metrics, "cumulative_layout_shift");
  if (lcp === null && inp === null && cls === null) return null;
  const last = record.collectionPeriod?.lastDate;
  const periodEnd =
    last && last.year && last.month && last.day ? `${last.year}-${String(last.month).padStart(2, "0")}-${String(last.day).padStart(2, "0")}` : null;
  return { lcp: lcp === null ? null : Math.round(lcp), inp: inp === null ? null : Math.round(inp), cls: cls === null ? null : Math.round(cls * 1000), periodEnd };
}

/** A site as measured (`listSiteSpeeds()`): the store's own or a rival's. */
export type SiteSpeedFacts = SpeedFigures & {
  host: string;
  /** The rival's name; null for the store's own site. */
  rivalName: string | null;
  checkedAt: string | null;
  periodEnd: string | null;
  /** Why it has no figures: `none` too few Chrome visitors, `failed` the report could not be asked. */
  problem: "none" | "failed" | null;
};

/** Whether a measurement is recent enough to make a finding. */
export function speedFresh(checkedAt: string | null, now: Date): boolean {
  if (!checkedAt) return false;
  const at = Date.parse(checkedAt);
  return Number.isFinite(at) && now.getTime() - at <= SPEED_FRESH_DAYS * 86_400_000;
}

/**
 * Where a rival is good and the store poor (D905 M5c): for each of the three, the rival with the best figure among those rated good,
 * when the store's own is rated poor. Only from fresh measurements.
 */
export function speedBehind(sites: readonly SiteSpeedFacts[], now: Date): { metric: SpeedMetric; rivalName: string; theirs: number; yours: number }[] {
  const own = sites.find((s) => s.rivalName === null && speedFresh(s.checkedAt, now));
  if (!own) return [];
  const out: { metric: SpeedMetric; rivalName: string; theirs: number; yours: number }[] = [];
  for (const metric of SPEED_METRICS) {
    const yours = own[metric];
    if (yours === null || speedRating(metric, yours) !== "poor") continue;
    const best = sites
      .filter((s): s is SiteSpeedFacts & { rivalName: string } => s.rivalName !== null && speedFresh(s.checkedAt, now) && s[metric] !== null)
      .filter((s) => speedRating(metric, s[metric]!) === "good")
      .sort((a, b) => a[metric]! - b[metric]! || a.rivalName.localeCompare(b.rivalName))[0];
    if (best) out.push({ metric, rivalName: best.rivalName, theirs: best[metric]!, yours });
  }
  return out;
}

/** A figure as a person reads it: seconds for LCP (`2.4 s`), milliseconds for INP (`180 ms`), the score for CLS (`0.05`). */
export function speedText(metric: SpeedMetric, value: number, locale = "en-GB"): string {
  if (metric === "lcp") return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1000)} s`;
  if (metric === "inp") return `${new Intl.NumberFormat(locale).format(value)} ms`;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 1000);
}
