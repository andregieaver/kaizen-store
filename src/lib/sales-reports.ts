/**
 * Sales reports (S6 of `docs/own-books-and-sales.md`, D520): the pure parts, worked out in code from the deals' own rows (D464). The forecast
 * (open value by the month a deal is expected to close, and weighted by its stage's chance, Lisa's), how deals move from stage to stage, what
 * each person won and lost, and how long a deal takes to win. Nothing here reads the database.
 */

/** Months the forecast shows ahead, this one first. */
export const FORECAST_MONTHS = 6;

export type OpenDeal = { estimateMinor: number | null; currency: string; expectedCloseOn: string | null; probability: number | null };

export type ForecastBucket = {
  /** `overdue` (expected before this month), `YYYY-MM` for one of the months ahead, `later`, or `none` (no date). */
  key: string;
  deals: number;
  valueMinor: number;
  /** The value weighted by each deal's stage's chance; deals in a stage without one are left out of it. */
  weightedMinor: number;
  /** Deals left out of the weighted value: no estimate, or a stage without a chance. */
  unweighted: number;
};

const monthKey = (day: string) => day.slice(0, 7);

/** The next `n` months' keys from a day's month, that month first. */
export function monthsFrom(today: string, n = FORECAST_MONTHS): string[] {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const m = month - 1 + i;
    return `${year + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  });
}

/** The forecast for one currency: overdue, each month ahead, later and no date, in that order (empty ones kept, so the table is steady). */
export function forecast(deals: readonly OpenDeal[], currency: string, today: string): ForecastBucket[] {
  const months = monthsFrom(today);
  const keys = ["overdue", ...months, "later", "none"];
  const buckets = new Map(keys.map((key) => [key, { key, deals: 0, valueMinor: 0, weightedMinor: 0, unweighted: 0 }]));
  for (const deal of deals) {
    if (deal.currency !== currency) continue;
    const key = deal.expectedCloseOn === null ? "none" : monthKey(deal.expectedCloseOn) < months[0] ? "overdue" : months.includes(monthKey(deal.expectedCloseOn)) ? monthKey(deal.expectedCloseOn) : "later";
    const bucket = buckets.get(key)!;
    bucket.deals += 1;
    bucket.valueMinor += deal.estimateMinor ?? 0;
    if (deal.estimateMinor === null || deal.probability === null) bucket.unweighted += 1;
    else bucket.weightedMinor += Math.round((deal.estimateMinor * deal.probability) / 100);
  }
  return keys.map((key) => buckets.get(key)!);
}

/** The currencies open deals are in, the store's main one first, then by value. */
export function forecastCurrencies(deals: readonly OpenDeal[], main: string): string[] {
  const value = new Map<string, number>();
  for (const d of deals) value.set(d.currency, (value.get(d.currency) ?? 0) + (d.estimateMinor ?? 0));
  return [...value.keys()].sort((a, b) => (a === main ? -1 : b === main ? 1 : (value.get(b) ?? 0) - (value.get(a) ?? 0)));
}

export type Journey = { stages: readonly string[]; status: "open" | "won" | "lost" };
export type StageStep = { stageId: string; reached: number; /** Of those who reached this stage, the share that went on (to a later stage or won); null when none reached it. */ onward: number | null };

/**
 * How deals moved through a pipeline's stages, in order: how many reached each stage (entered it, a later one, or were won from it), and the
 * share that went on. A deal that skipped a stage counts as having passed it; one won counts as having passed every stage.
 */
export function stageConversion(stageIds: readonly string[], journeys: readonly Journey[]): { steps: StageStep[]; won: number; lost: number; open: number } {
  const position = new Map(stageIds.map((id, i) => [id, i]));
  const furthest = journeys.map((j) => (j.status === "won" ? stageIds.length : Math.max(-1, ...j.stages.map((s) => position.get(s) ?? -1))));
  const reached = stageIds.map((_, i) => furthest.filter((f) => f >= i).length);
  const steps = stageIds.map((stageId, i) => {
    const onward = i + 1 < stageIds.length ? reached[i + 1] : journeys.filter((j) => j.status === "won").length;
    return { stageId, reached: reached[i], onward: reached[i] === 0 ? null : onward / reached[i] };
  });
  return {
    steps,
    won: journeys.filter((j) => j.status === "won").length,
    lost: journeys.filter((j) => j.status === "lost").length,
    open: journeys.filter((j) => j.status === "open").length,
  };
}

export type ClosedDeal = { ownerId: string | null; status: "won" | "lost"; estimateMinor: number | null; currency: string; createdAt: string; closedAt: string };
export type PersonRow = { ownerId: string | null; won: number; lost: number; wonMinor: number; winRate: number | null };

/** What each person won and lost (a deal with no owner is its own row), the most won first; the value only in the currency given. */
export function byPerson(closed: readonly ClosedDeal[], currency: string): PersonRow[] {
  const rows = new Map<string | null, PersonRow>();
  for (const deal of closed) {
    const row = rows.get(deal.ownerId) ?? { ownerId: deal.ownerId, won: 0, lost: 0, wonMinor: 0, winRate: null };
    if (deal.status === "won") {
      row.won += 1;
      if (deal.currency === currency) row.wonMinor += deal.estimateMinor ?? 0;
    } else row.lost += 1;
    rows.set(deal.ownerId, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, winRate: row.won + row.lost === 0 ? null : row.won / (row.won + row.lost) }))
    .sort((a, b) => b.won - a.won || b.wonMinor - a.wonMinor || a.lost - b.lost);
}

/** Days from a deal's making to its win: the median and the mean, whole days; null when none was won. */
export function timeToWin(closed: readonly ClosedDeal[]): { median: number | null; mean: number | null; deals: number } {
  const days = closed
    .filter((d) => d.status === "won")
    .map((d) => Math.max(0, (Date.parse(d.closedAt) - Date.parse(d.createdAt)) / 86_400_000))
    .sort((a, b) => a - b);
  if (days.length === 0) return { median: null, mean: null, deals: 0 };
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 === 1 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return { median: Math.round(median), mean: Math.round(days.reduce((s, d) => s + d, 0) / days.length), deals: days.length };
}
